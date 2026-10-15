import { Hono } from 'hono';
import type { PackingLineView, ProductionOrderView } from '../../shared/api.ts';
import { packingLinePatch, productionOrderCreate, siloFill } from '../../shared/schemas.ts';
import { osloToUtc, todayOslo } from '../../shared/time.ts';
import { CAN, requireRole } from '../auth/access.ts';
import { body, fail, newId, nowIso } from '../lib/http.ts';
import { publish } from '../lib/realtime.ts';
import type { AppEnv } from '../types.ts';

// Produksjon: pakkelinjer med silo. Siloenes nivå beregnes i shared/domain/production.ts.
const app = new Hono<AppEnv>();

const ORDER_SELECT = `SELECT o.id, o.line_id, o.product_id, p.name AS product_name, o.tonnes, o.status, o.sort, o.notes, o.created_at, o.started_at, o.finished_at
                      FROM production_orders o JOIN products p ON p.id = o.product_id`;

export async function loadLines(db: D1Database): Promise<PackingLineView[]> {
  const since = osloToUtc(todayOslo(), 0);
  const [lines, orders, fills, last] = await db.batch([
    db.prepare('SELECT id, name, silo_capacity_t, rate_tph FROM packing_lines WHERE active = 1 ORDER BY sort'),
    db.prepare(`${ORDER_SELECT} WHERE o.status IN ('planlagt', 'pakker') OR (o.status = 'ferdig' AND o.finished_at >= ?) ORDER BY o.sort, o.created_at`).bind(since),
    db.prepare(`SELECT f.production_order_id AS order_id, sum(f.tonnes) AS t FROM silo_fills f
                WHERE f.production_order_id IN (SELECT id FROM production_orders WHERE status = 'pakker') GROUP BY f.production_order_id`),
    db.prepare(`SELECT f.line_id, f.tonnes, f.filled_at, u.short_name AS by_name FROM silo_fills f LEFT JOIN users u ON u.id = f.filled_by
                WHERE f.id IN (SELECT id FROM silo_fills f2 WHERE f2.line_id = f.line_id ORDER BY f2.filled_at DESC LIMIT 1)`),
  ]);
  const all = orders.results as ProductionOrderView[];
  const filled = new Map((fills.results as { order_id: string; t: number }[]).map(r => [r.order_id, r.t]));
  const lastBy = new Map((last.results as { line_id: string; tonnes: number; filled_at: string; by_name: string | null }[]).map(r => [r.line_id, r]));
  return (lines.results as { id: string; name: string; silo_capacity_t: number; rate_tph: number }[]).map(l => {
    const mine = all.filter(o => o.line_id === l.id);
    const active = mine.find(o => o.status === 'pakker') ?? null;
    const lf = lastBy.get(l.id);
    return {
      ...l, active_order: active, queue: mine.filter(o => o.status === 'planlagt'), done_today: mine.filter(o => o.status === 'ferdig'),
      filled_for_order: active ? filled.get(active.id) ?? 0 : 0,
      last_fill: lf ? { tonnes: lf.tonnes, filled_at: lf.filled_at, by: lf.by_name } : null,
    };
  });
}

app.get('/', async c => c.json(await loadLines(c.env.DB)));

app.post('/orders', requireRole(...CAN.crew), body(productionOrderCreate), async c => {
  const i = c.req.valid('json');
  const db = c.env.DB;
  const ok = await db.batch([
    db.prepare('SELECT 1 FROM packing_lines WHERE id = ? AND active = 1').bind(i.line_id),
    db.prepare('SELECT 1 FROM products WHERE id = ?').bind(i.product_id),
  ]);
  if (!ok[0].results.length) throw fail(400, 'Ukjent pakkelinje.', { field: 'line_id' });
  if (!ok[1].results.length) throw fail(400, 'Ukjent produkt.', { field: 'product_id' });
  const id = newId('po');
  await db.prepare(`INSERT INTO production_orders (id, line_id, product_id, tonnes, notes, created_by, sort)
                    VALUES (?, ?, ?, ?, ?, ?, (SELECT coalesce(max(sort), 0) + 1 FROM production_orders WHERE line_id = ?))`)
    .bind(id, i.line_id, i.product_id, i.tonnes, i.notes, c.get('user').id, i.line_id).run();
  publish(c, { type: 'production.changed' });
  return c.json(await c.env.DB.prepare(`${ORDER_SELECT} WHERE o.id = ?`).bind(id).first<ProductionOrderView>(), 201);
});

/** Start pakking av en ordre. Ordren som pakker på samme linje blir ferdig. */
app.post('/orders/:id/start', requireRole(...CAN.crew, ...CAN.quayLog), async c => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const o = await db.prepare(`SELECT line_id, status FROM production_orders WHERE id = ?`).bind(id).first<{ line_id: string; status: string }>();
  if (!o) throw fail(404, 'Fant ikke ordren.');
  if (o.status !== 'planlagt') throw fail(409, 'Bare planlagte ordre kan startes.');
  const at = nowIso();
  await db.batch([
    db.prepare(`UPDATE production_orders SET status = 'ferdig', finished_at = ? WHERE line_id = ? AND status = 'pakker'`).bind(at, o.line_id),
    db.prepare(`UPDATE production_orders SET status = 'pakker', started_at = ? WHERE id = ?`).bind(at, id),
  ]);
  publish(c, { type: 'production.changed' });
  return c.json(await loadLines(db));
});

app.post('/orders/:id/finish', requireRole(...CAN.crew, ...CAN.quayLog), async c => {
  const res = await c.env.DB.prepare(`UPDATE production_orders SET status = 'ferdig', finished_at = ? WHERE id = ? AND status = 'pakker'`).bind(nowIso(), c.req.param('id')).run();
  if (!res.meta.changes) throw fail(409, 'Ordren pakkes ikke nå.');
  publish(c, { type: 'production.changed' });
  return c.json(await loadLines(c.env.DB));
});

app.post('/orders/:id/cancel', requireRole(...CAN.crew), async c => {
  const res = await c.env.DB.prepare(`UPDATE production_orders SET status = 'avlyst', finished_at = ? WHERE id = ? AND status IN ('planlagt', 'pakker')`).bind(nowIso(), c.req.param('id')).run();
  if (!res.meta.changes) throw fail(409, 'Ordren er allerede ferdig eller avlyst.');
  publish(c, { type: 'production.changed' });
  return c.json(await loadLines(c.env.DB));
});

/** Hjullasteren har fylt siloen. Knyttes til ordren som pakker på linjen. */
app.post('/fills', requireRole(...CAN.crew, ...CAN.quayLog), body(siloFill), async c => {
  const { line_id, tonnes } = c.req.valid('json');
  const db = c.env.DB;
  const active = await db.prepare(`SELECT id, product_id FROM production_orders WHERE line_id = ? AND status = 'pakker'`).bind(line_id).first<{ id: string; product_id: string }>();
  if (!active) throw fail(409, 'Ingen ordre pakkes på denne linjen – start en ordre før påfylling.');
  await db.prepare(`INSERT INTO silo_fills (id, line_id, production_order_id, product_id, tonnes, filled_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(newId('sf'), line_id, active.id, active.product_id, tonnes, c.get('user').id).run();
  publish(c, { type: 'production.changed' });
  return c.json(await loadLines(db), 201);
});

app.patch('/lines/:id', requireRole(...CAN.crew), body(packingLinePatch), async c => {
  const p = c.req.valid('json');
  const cols = Object.entries(p).filter(([, v]) => v !== undefined);
  if (!cols.length) return c.json(await loadLines(c.env.DB));
  const res = await c.env.DB.prepare(`UPDATE packing_lines SET ${cols.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...cols.map(([, v]) => v), c.req.param('id')).run();
  if (!res.meta.changes) throw fail(404, 'Fant ikke pakkelinjen.');
  publish(c, { type: 'production.changed' });
  return c.json(await loadLines(c.env.DB));
});

export default app;
