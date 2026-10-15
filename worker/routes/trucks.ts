import { Hono } from 'hono';
import { z } from 'zod';
import type { TruckOrderView, UserRef } from '../../shared/api.ts';
import { truckOrderCreate, truckOrderPatch } from '../../shared/schemas.ts';
import { addDays, todayOslo } from '../../shared/time.ts';
import { CAN, requireRole } from '../auth/access.ts';
import { goodsLabel } from '../db/portCalls.ts';
import { body, fail, newId, nowIso, query } from '../lib/http.ts';
import { publish } from '../lib/realtime.ts';
import type { AppEnv } from '../types.ts';

// Biler: kundebiler som henter pall/BB. Planlegges per dag, ikke klokkeslett.
const app = new Hono<AppEnv>();

type Row = {
  id: string; customer: string; carrier: string | null; reg_no: string | null; reference: string | null; expected_date: string;
  notes: string | null; picked_up_at: string | null; cancelled_at: string | null; created_at: string;
  pu_id: string | null; pu_name: string | null; pu_short: string | null; pu_initials: string | null;
};
type GoodsRow = { id: string; order_id: string; sku_id: string; product_name: string; unit: 'BB' | 'pall'; pallet_type: 'europall' | 'srs' | null; bags_per_unit: number | null; kg_per_unit: number; quantity: number };

async function load(db: D1Database, where: string, params: unknown[]): Promise<TruckOrderView[]> {
  const [orders, goods] = await db.batch([
    db.prepare(`SELECT o.*, u.id AS pu_id, u.name AS pu_name, u.short_name AS pu_short, u.initials AS pu_initials
                FROM truck_orders o LEFT JOIN users u ON u.id = o.picked_up_by WHERE ${where} ORDER BY o.expected_date, o.created_at`).bind(...params),
    db.prepare(`SELECT g.id, g.order_id, g.sku_id, p.name AS product_name, s.unit, s.pallet_type, s.bags_per_unit, s.kg_per_unit, g.quantity
                FROM truck_order_goods g JOIN skus s ON s.id = g.sku_id JOIN products p ON p.id = s.product_id
                WHERE g.order_id IN (SELECT o.id FROM truck_orders o WHERE ${where}) ORDER BY g.sort`).bind(...params),
  ]);
  const byOrder = Map.groupBy(goods.results as GoodsRow[], g => g.order_id);
  return (orders.results as Row[]).map(o => {
    const g = (byOrder.get(o.id) ?? []).map(x => ({
      id: x.id, sku_id: x.sku_id, product_name: x.product_name, unit: x.unit, quantity: x.quantity,
      tonnes: (x.quantity * x.kg_per_unit) / 1000, label: goodsLabel(x),
    }));
    const pu: UserRef | null = o.pu_id ? { id: o.pu_id, name: o.pu_name ?? '', short_name: o.pu_short ?? '', initials: o.pu_initials ?? '' } : null;
    return {
      id: o.id, customer: o.customer, carrier: o.carrier, reg_no: o.reg_no, reference: o.reference, expected_date: o.expected_date,
      notes: o.notes, goods: g, tonnes: g.reduce((s, x) => s + x.tonnes, 0), picked_up_at: o.picked_up_at, picked_up_by: pu,
      cancelled_at: o.cancelled_at, created_at: o.created_at,
    };
  });
}
const loadOne = async (db: D1Database, id: string) => (await load(db, 'o.id = ?', [id]))[0];

/** Ordre i perioden, pluss ordre fra før perioden som ennå ikke er hentet (forfalt). */
app.get('/', query(z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() })), async c => {
  const today = todayOslo();
  const { from = addDays(today, -7), to = addDays(today, 21) } = c.req.valid('query');
  const orders = await load(c.env.DB, `(o.expected_date BETWEEN ? AND ?) OR (o.picked_up_at IS NULL AND o.cancelled_at IS NULL AND o.expected_date < ?)`, [from, to, from]);
  return c.json(orders);
});

app.post('/', requireRole(...CAN.plan), body(truckOrderCreate), async c => {
  const i = c.req.valid('json');
  const db = c.env.DB;
  const id = newId('to');
  const skus = await db.prepare('SELECT count(*) AS n FROM skus WHERE active = 1 AND id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify([...new Set(i.goods.map(g => g.sku_id))])).first<{ n: number }>();
  if ((skus?.n ?? 0) !== new Set(i.goods.map(g => g.sku_id)).size) throw fail(400, 'Ukjent vare.', { field: 'goods' });
  await db.batch([
    db.prepare(`INSERT INTO truck_orders (id, customer, carrier, reg_no, reference, expected_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, i.customer, i.carrier, i.reg_no, i.reference, i.expected_date, i.notes, c.get('user').id),
    ...i.goods.map((g, n) => db.prepare('INSERT INTO truck_order_goods (id, order_id, sku_id, quantity, sort) VALUES (?, ?, ?, ?, ?)').bind(newId('tg'), id, g.sku_id, g.quantity, n)),
  ]);
  publish(c, { type: 'trucks.changed' });
  return c.json(await loadOne(db, id), 201);
});

app.patch('/:id', requireRole(...CAN.plan), body(truckOrderPatch), async c => {
  const { goods, ...fields } = c.req.valid('json');
  const db = c.env.DB;
  const id = c.req.param('id');
  const cols = Object.entries(fields).filter(([, v]) => v !== undefined);
  const res = await db.batch([
    db.prepare(`UPDATE truck_orders SET ${[...cols.map(([k]) => `${k} = ?`), 'updated_at = ?'].join(', ')} WHERE id = ?`).bind(...cols.map(([, v]) => v ?? null), nowIso(), id),
    ...(goods ? [
      db.prepare('DELETE FROM truck_order_goods WHERE order_id = ?').bind(id),
      ...goods.map((g, n) => db.prepare('INSERT INTO truck_order_goods (id, order_id, sku_id, quantity, sort) VALUES (?, ?, ?, ?, ?)').bind(newId('tg'), id, g.sku_id, g.quantity, n)),
    ] : []),
  ]);
  if (!res[0].meta.changes) throw fail(404, 'Fant ikke ordren.');
  publish(c, { type: 'trucks.changed' });
  return c.json(await loadOne(db, id));
});

/** Marker som hentet, eller angre (undo: true). */
app.post('/:id/pickup', requireRole(...CAN.plan, ...CAN.quayLog), body(z.object({ undo: z.boolean().optional() })), async c => {
  const { undo } = c.req.valid('json');
  const id = c.req.param('id');
  const res = undo
    ? await c.env.DB.prepare('UPDATE truck_orders SET picked_up_at = NULL, picked_up_by = NULL, updated_at = ? WHERE id = ?').bind(nowIso(), id).run()
    : await c.env.DB.prepare('UPDATE truck_orders SET picked_up_at = ?, picked_up_by = ?, updated_at = ? WHERE id = ? AND cancelled_at IS NULL').bind(nowIso(), c.get('user').id, nowIso(), id).run();
  if (!res.meta.changes) throw fail(404, 'Fant ikke ordren, eller den er avlyst.');
  publish(c, { type: 'trucks.changed' });
  return c.json(await loadOne(c.env.DB, id));
});

app.post('/:id/cancel', requireRole(...CAN.plan), async c => {
  const id = c.req.param('id');
  const res = await c.env.DB.prepare('UPDATE truck_orders SET cancelled_at = ?, updated_at = ? WHERE id = ? AND picked_up_at IS NULL').bind(nowIso(), nowIso(), id).run();
  if (!res.meta.changes) throw fail(409, 'Ordren finnes ikke eller er allerede hentet.');
  publish(c, { type: 'trucks.changed' });
  return c.json(await loadOne(c.env.DB, id));
});

export default app;
