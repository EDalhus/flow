import { Hono } from 'hono';
import type { BulkOrderView, BulkQuality } from '../../shared/api.ts';
import { bulkPhase } from '../../shared/domain/bulk.ts';
import { bulkOrderCreate } from '../../shared/schemas.ts';
import { osloToUtc, todayOslo } from '../../shared/time.ts';
import { body, fail, newId, nowIso } from '../lib/http.ts';
import { publish } from '../lib/realtime.ts';
import type { AppEnv } from '../types.ts';

// Bulkbil: egne biler henter salt i bulk. Sjåføren bestiller i steg; hjullasteren ser køen.
// MVP: Flow viser og teller ned. Styring av traktene kan kobles på senere via stegene.
const app = new Hono<AppEnv>();

type OrderRow = Omit<BulkOrderView, 'driver' | 'steps' | 'total_tonnes'> & { d_id: string | null; d_name: string | null; d_short: string | null; d_initials: string | null };
type StepRow = BulkOrderView['steps'][number] & { order_id: string };

async function load(db: D1Database, where: string, params: unknown[]): Promise<BulkOrderView[]> {
  const [orders, steps] = await db.batch([
    db.prepare(`SELECT o.id, o.truck, o.destination, o.status, o.expected_at, o.notes, o.created_at, o.started_at, o.finished_at,
                       u.id AS d_id, u.name AS d_name, u.short_name AS d_short, u.initials AS d_initials
                FROM bulk_orders o LEFT JOIN users u ON u.id = o.driver_id WHERE ${where}
                ORDER BY CASE o.status WHEN 'lastes' THEN 0 WHEN 'bestilt' THEN 1 ELSE 2 END, coalesce(o.expected_at, o.created_at)`).bind(...params),
    db.prepare(`SELECT s.id, s.order_id, s.seq, s.quality_id, q.name AS quality_name, q.color, s.tonnes, s.target, s.pause_after_sec, s.started_at, s.finished_at
                FROM bulk_order_steps s JOIN bulk_qualities q ON q.id = s.quality_id
                WHERE s.order_id IN (SELECT o.id FROM bulk_orders o WHERE ${where}) ORDER BY s.seq`).bind(...params),
  ]);
  const byOrder = Map.groupBy(steps.results as StepRow[], s => s.order_id);
  return (orders.results as OrderRow[]).map(({ d_id, d_name, d_short, d_initials, ...o }) => {
    const st = (byOrder.get(o.id) ?? []).map(({ order_id: _o, ...s }) => s);
    return {
      ...o, steps: st, total_tonnes: st.reduce((t, s) => t + s.tonnes, 0),
      driver: d_id ? { id: d_id, name: d_name ?? '', short_name: d_short ?? '', initials: d_initials ?? '' } : null,
    };
  });
}
const loadOne = async (db: D1Database, id: string) => (await load(db, 'o.id = ?', [id]))[0];

app.get('/qualities', async c => {
  const { results } = await c.env.DB.prepare('SELECT id, name, color FROM bulk_qualities WHERE active = 1 ORDER BY sort').all<BulkQuality>();
  return c.json(results);
});

/** Åpne bestillinger, pluss det som er ferdig eller avlyst i dag. */
app.get('/orders', async c => {
  const since = osloToUtc(todayOslo(), 0);
  return c.json(await load(c.env.DB, `o.status IN ('bestilt', 'lastes') OR o.created_at >= ? OR o.finished_at >= ?`, [since, since]));
});

/** Alle innloggede kan bestille (sjåførene). */
app.post('/orders', body(bulkOrderCreate), async c => {
  const i = c.req.valid('json');
  const db = c.env.DB;
  const q = await db.prepare(`SELECT count(*) AS n FROM bulk_qualities WHERE active = 1 AND id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify([...new Set(i.steps.map(s => s.quality_id))])).first<{ n: number }>();
  if ((q?.n ?? 0) !== new Set(i.steps.map(s => s.quality_id)).size) throw fail(400, 'Ukjent saltkvalitet.', { field: 'steps' });
  const id = newId('bo');
  await db.batch([
    db.prepare(`INSERT INTO bulk_orders (id, truck, destination, driver_id, expected_at, notes) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, i.truck, i.destination, c.get('user').id, i.expected_at ?? null, i.notes),
    ...i.steps.map((s, n) => db.prepare(`INSERT INTO bulk_order_steps (id, order_id, seq, quality_id, tonnes, target, pause_after_sec) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(newId('bs'), id, n + 1, s.quality_id, s.tonnes, s.target, n === i.steps.length - 1 ? 0 : s.pause_after_sec)),
  ]);
  publish(c, { type: 'bulk.changed' });
  return c.json(await loadOne(db, id), 201);
});

/** Bilen står under trakten: start steg 1. */
app.post('/orders/:id/start', async c => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const at = nowIso();
  const [res] = await db.batch([
    db.prepare(`UPDATE bulk_orders SET status = 'lastes', started_at = ?, version = version + 1 WHERE id = ? AND status = 'bestilt'`).bind(at, id),
    db.prepare(`UPDATE bulk_order_steps SET started_at = ? WHERE order_id = ? AND seq = 1 AND (SELECT status FROM bulk_orders WHERE id = ?) = 'lastes'`).bind(at, id, id),
  ]);
  if (!res.meta.changes) throw fail(409, 'Bestillingen er allerede startet, ferdig eller avlyst.');
  publish(c, { type: 'bulk.changed' });
  return c.json(await loadOne(db, id));
});

/**
 * Neste: fullfør aktivt steg og start pausen før neste steg (neste stegs started_at = nå + pause).
 * Trykkes det under pausen, startes neste steg med en gang. Etter siste steg er bestillingen ferdig.
 */
app.post('/orders/:id/next', async c => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const order = await loadOne(db, id);
  if (!order) throw fail(404, 'Fant ikke bestillingen.');
  if (order.status !== 'lastes') throw fail(409, 'Bestillingen lastes ikke nå.');
  const now = Date.now();
  const at = new Date(now).toISOString();
  const phase = bulkPhase(order.status, order.steps, now);
  const stmts: D1PreparedStatement[] = [];
  if (phase.kind === 'pause') {
    stmts.push(db.prepare('UPDATE bulk_order_steps SET started_at = ? WHERE order_id = ? AND seq = ?').bind(at, id, phase.next));
  } else if (phase.kind === 'laster') {
    const cur = order.steps.find(s => s.seq === phase.step)!;
    const next = order.steps.find(s => s.seq === phase.step + 1);
    stmts.push(db.prepare('UPDATE bulk_order_steps SET finished_at = ? WHERE id = ?').bind(at, cur.id));
    if (next) stmts.push(db.prepare('UPDATE bulk_order_steps SET started_at = ? WHERE id = ?').bind(new Date(now + cur.pause_after_sec * 1000).toISOString(), next.id));
    else stmts.push(db.prepare(`UPDATE bulk_orders SET status = 'ferdig', finished_at = ?, version = version + 1 WHERE id = ?`).bind(at, id));
  } else {
    throw fail(409, 'Ingen steg å gå videre fra.');
  }
  await db.batch(stmts);
  publish(c, { type: 'bulk.changed' });
  return c.json(await loadOne(db, id));
});

app.post('/orders/:id/cancel', async c => {
  const id = c.req.param('id');
  const res = await c.env.DB.prepare(`UPDATE bulk_orders SET status = 'avlyst', finished_at = ?, version = version + 1 WHERE id = ? AND status IN ('bestilt', 'lastes')`)
    .bind(nowIso(), id).run();
  if (!res.meta.changes) throw fail(409, 'Bestillingen er allerede ferdig eller avlyst.');
  publish(c, { type: 'bulk.changed' });
  return c.json(await loadOne(c.env.DB, id));
});

export default app;
