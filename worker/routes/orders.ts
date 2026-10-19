import { Hono } from 'hono';
import type { LogCall } from '../../shared/api.ts';
import { orderAssign, orderCancel, orderCreate, orderPatch, type OrderLineInput, type Placement } from '../../shared/schemas.ts';
import { callSnapshot, loadOrder, loadOrders, logCall, logStatement, syncLink, type CallSnapshot } from '../db/orders.ts';
import { goodsLabel } from '../db/portCalls.ts';
import { body, fail, isConstraintError, newId, nowIso } from '../lib/http.ts';
import { publish } from '../lib/realtime.ts';
import type { AppEnv, AuthUser } from '../types.ts';
import { newCallStatements, validateRefs } from './portCalls.ts';
import { assertFreeSo } from './trucks.ts';

// Salgsordre (SO) fra Dynamics 365. SO-en er sannheten for hva som skal over kaia; anløpet er båten.
// Alle innloggede kan opprette og endre ordre. Alt føres i ordrens endringslogg.
const app = new Hono<AppEnv>();

type LineRow = {
  id: string; sku_id: string; quantity: number; direction: 'inn' | 'ut'; port_call_id: string | null; sort: number;
  product_name: string; unit: 'BB' | 'pall'; bags_per_unit: number | null; pallet_type: 'europall' | 'srs' | null;
  /** Anløpet er avsluttet (kaibok levert) – linjen er låst. */
  locked: number;
};
type OrderRow = { id: string; so_number: string; customer: string; seller_id: string | null; wanted_date: string | null; notes: string | null; version: number; cancelled_at: string | null };

async function current(db: D1Database, id: string) {
  const order = await db.prepare('SELECT id, so_number, customer, seller_id, wanted_date, notes, version, cancelled_at FROM sales_orders WHERE id = ?')
    .bind(id).first<OrderRow>();
  if (!order) throw fail(404, 'Fant ikke salgsordren.');
  const { results: lines } = await db.prepare(`
    SELECT l.id, l.sku_id, l.quantity, l.direction, l.port_call_id, l.sort, p.name AS product_name, s.unit, s.bags_per_unit, s.pallet_type,
           (pc.completed_at IS NOT NULL OR EXISTS (SELECT 1 FROM quay_logs ql WHERE ql.port_call_id = pc.id)) AS locked
    FROM order_lines l JOIN skus s ON s.id = l.sku_id JOIN products p ON p.id = s.product_id LEFT JOIN port_calls pc ON pc.id = l.port_call_id
    WHERE l.sales_order_id = ? ORDER BY l.sort`).bind(id).all<LineRow>();
  return { order, lines };
}

const checkVersion = (o: OrderRow, version: number) => {
  if (o.version !== version) throw fail(409, 'Salgsordren er endret av noen andre. Last inn på nytt og prøv igjen.');
  if (o.cancelled_at) throw fail(409, 'Salgsordren er kansellert.');
};

/** Varetekst for loggen, f.eks. «120 pall Hav salt · 25 kg × 40 · Europall». */
async function skuInfo(db: D1Database, skuIds: string[]) {
  const { results } = await db.prepare(`SELECT s.id, p.name AS product_name, s.unit, s.bags_per_unit, s.pallet_type FROM skus s
                                        JOIN products p ON p.id = s.product_id WHERE s.active = 1 AND s.id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify([...new Set(skuIds)])).all<{ id: string; product_name: string; unit: 'BB' | 'pall'; bags_per_unit: number | null; pallet_type: 'europall' | 'srs' | null }>();
  const map = new Map(results.map(r => [r.id, r]));
  return (sku: string, quantity: number) => { const s = map.get(sku); return s ? goodsLabel({ ...s, quantity }) : sku; };
}

/** Anløpet SO-en skal på må finnes og være åpent (ikke avlyst og uten levert kaibok). */
async function openCall(db: D1Database, id: string): Promise<CallSnapshot> {
  const row = await db.prepare(`SELECT pc.id, pc.cancelled_at, pc.completed_at, pc.source,
                                  EXISTS (SELECT 1 FROM quay_logs ql WHERE ql.port_call_id = pc.id) AS has_log
                                FROM port_calls pc WHERE pc.id = ?`).bind(id)
    .first<{ id: string; cancelled_at: string | null; completed_at: string | null; source: string; has_log: number }>();
  if (!row || row.source !== 'app') throw fail(404, 'Fant ikke anløpet.');
  if (row.cancelled_at) throw fail(409, 'Anløpet er avlyst.');
  if (row.completed_at || row.has_log) throw fail(409, 'Kaibok er levert, og anløpet kan ikke endres.');
  return (await callSnapshot(db, id))!;
}

/** Hvor linjene skal: null (venter på båt), et eksisterende anløp, eller et nytt anløp (setningene som lager det). */
async function resolvePlacement(db: D1Database, user: AuthUser, p: Placement, type: 'levering' | 'henting', seller: string | null) {
  if (p.kind === 'none') return { callId: null, snapshot: null as CallSnapshot | null, statements: [] as D1PreparedStatement[] };
  if (p.kind === 'call') return { callId: p.port_call_id, snapshot: await openCall(db, p.port_call_id), statements: [] as D1PreparedStatement[] };
  const id = newId('pc');
  const created = await newCallStatements(db, user, id, { ...p.call, type, seller_id: seller });
  return { callId: id, snapshot: created.snapshot, statements: created.statements };
}

const typeOf = (lines: { direction: 'inn' | 'ut' }[]) => (lines.every(l => l.direction === 'ut') ? 'henting' : 'levering');

/** Anløp som ikke lenger har noen SO-er etter en endring – klienten spør om de skal avlyses. */
async function emptied(db: D1Database, callIds: string[]) {
  if (!callIds.length) return [];
  const { results } = await db.prepare(`SELECT pc.id, b.name AS boat_name FROM port_calls pc JOIN boats b ON b.id = pc.boat_id
                                        WHERE pc.id IN (SELECT value FROM json_each(?)) AND pc.cancelled_at IS NULL
                                          AND NOT EXISTS (SELECT 1 FROM port_call_orders o WHERE o.port_call_id = pc.id)`)
    .bind(JSON.stringify([...new Set(callIds)])).all<{ id: string; boat_name: string }>();
  return results;
}

// ---------------------------------------------------------------- lesing

/** Åpne SO-er, og de som er ferdige eller kansellert siste 14 dager. */
app.get('/', async c => {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  return c.json(await loadOrders(c.env.DB, { open: true, since }));
});

/** Én SO med logg. Id eller SO-nummer. */
app.get('/:key', async c => {
  const order = await loadOrder(c.env.DB, c.req.param('key'));
  if (!order) throw fail(404, 'Fant ikke salgsordren.');
  return c.json(order);
});

// ---------------------------------------------------------------- endring

app.post('/', body(orderCreate), async c => {
  const i = c.req.valid('json');
  const user = c.get('user');
  const db = c.env.DB;
  const dup = await db.prepare('SELECT id, customer FROM sales_orders WHERE so_number = ?').bind(i.so_number).first<{ id: string; customer: string }>();
  if (dup) throw fail(409, `SO ${i.so_number} finnes allerede (${dup.customer}).`, { field: 'so_number', existing: dup.id });
  await assertFreeSo(db, i.so_number);
  const seller = i.seller_id !== undefined ? i.seller_id : user.roles.includes('salg') ? user.id : null;
  await validateRefs(db, { seller_id: seller, skus: i.lines.map(l => l.sku_id) });

  const id = newId('so');
  const place = await resolvePlacement(db, user, i.placement, typeOf(i.lines), seller);
  const statements = [
    ...place.statements,
    db.prepare(`INSERT INTO sales_orders (id, so_number, customer, seller_id, wanted_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, i.so_number, i.customer, seller, i.wanted_date ?? null, i.notes, user.id),
    ...i.lines.map((l, n) => db.prepare(`INSERT INTO order_lines (id, sales_order_id, port_call_id, sku_id, quantity, direction, sort) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(newId('ol'), id, place.callId, l.sku_id, l.quantity, l.direction, n)),
    logStatement(db, { orderId: id, callId: place.callId, userId: user.id, kind: 'created', data: { so_number: i.so_number } }),
    ...(place.callId
      ? [...syncLink(db, place.callId, id), logStatement(db, { orderId: id, callId: place.callId, userId: user.id, kind: 'assigned', data: { to: logCall(place.snapshot) } })]
      : []),
  ];
  try {
    await db.batch(statements);
  } catch (e) {
    if (isConstraintError(e)) throw fail(409, `SO ${i.so_number} finnes allerede.`, { field: 'so_number' });
    throw e;
  }
  if (place.callId) publish(c, { type: 'port_call.changed', id: place.callId });
  else publish(c, { type: 'orders.changed' });
  return c.json(await loadOrder(db, id), 201);
});

app.patch('/:id', body(orderPatch), async c => {
  const i = c.req.valid('json');
  const user = c.get('user');
  const db = c.env.DB;
  const { order, lines } = await current(db, c.req.param('id'));
  checkVersion(order, i.version);

  const stmts: D1PreparedStatement[] = [];
  const log = (kind: Parameters<typeof logStatement>[1]['kind'], data: unknown, callId: string | null = null) =>
    stmts.push(logStatement(db, { orderId: order.id, callId, userId: user.id, kind, data }));

  if (i.customer !== undefined && i.customer !== order.customer) log('customer', { from: order.customer, to: i.customer });
  if (i.wanted_date !== undefined && i.wanted_date !== order.wanted_date) log('wanted_date', { from: order.wanted_date, to: i.wanted_date });
  if (i.notes !== undefined && i.notes !== order.notes) log('notes', { from: order.notes, to: i.notes });
  if (i.seller_id !== undefined && i.seller_id !== order.seller_id) {
    await validateRefs(db, { seller_id: i.seller_id });
    const names = await db.prepare('SELECT id, short_name FROM users WHERE id IN (?, ?)').bind(order.seller_id ?? '', i.seller_id ?? '').all<{ id: string; short_name: string }>();
    const name = (id: string | null) => names.results.find(u => u.id === id)?.short_name ?? null;
    log('seller', { from: name(order.seller_id), to: name(i.seller_id) });
  }

  const touched = new Set<string>();
  if (i.lines) {
    const label = await skuInfo(db, [...i.lines.map(l => l.sku_id), ...lines.map(l => l.sku_id)]);
    await validateRefs(db, { skus: i.lines.map(l => l.sku_id) });
    const byId = new Map(lines.map(l => [l.id, l]));
    const keep = new Set(i.lines.flatMap(l => (l.id ? [l.id] : [])));
    for (const id of keep) if (!byId.has(id)) throw fail(400, 'Ukjent varelinje.', { field: 'lines' });
    const same = (a: LineRow, b: OrderLineInput) => a.sku_id === b.sku_id && a.quantity === b.quantity && a.direction === b.direction;
    // Levert vare kan ikke endres eller fjernes.
    for (const l of lines) {
      if (!l.locked) continue;
      const next = i.lines.find(x => x.id === l.id);
      if (!next || !same(l, next)) throw fail(409, 'Varer som er levert kan ikke endres.', { field: 'lines' });
    }
    // Nye linjer følger SO-en: ligger den på ett åpent anløp, legges de der.
    const openCalls = [...new Set(lines.filter(l => l.port_call_id && !l.locked).map(l => l.port_call_id!))];
    const target = openCalls.length === 1 && lines.every(l => l.port_call_id) ? openCalls[0] : null;
    for (const l of lines) {
      if (keep.has(l.id)) continue;
      stmts.push(db.prepare('DELETE FROM order_lines WHERE id = ?').bind(l.id));
      log('line_removed', { line: label(l.sku_id, l.quantity) }, l.port_call_id);
      if (l.port_call_id) touched.add(l.port_call_id);
    }
    i.lines.forEach((n, sort) => {
      const old = n.id ? byId.get(n.id) : undefined;
      if (!old) {
        stmts.push(db.prepare('INSERT INTO order_lines (id, sales_order_id, port_call_id, sku_id, quantity, direction, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(newId('ol'), order.id, target, n.sku_id, n.quantity, n.direction, sort));
        log('line_added', { line: label(n.sku_id, n.quantity) }, target);
        if (target) touched.add(target);
        return;
      }
      stmts.push(db.prepare('UPDATE order_lines SET sku_id = ?, quantity = ?, direction = ?, sort = ? WHERE id = ?').bind(n.sku_id, n.quantity, n.direction, sort, old.id));
      if (!same(old, n)) log('line_changed', { from: label(old.sku_id, old.quantity), to: label(n.sku_id, n.quantity) }, old.port_call_id);
    });
  }
  for (const callId of touched) stmts.push(...syncLink(db, callId, order.id));
  stmts.push(db.prepare(`UPDATE sales_orders SET customer = ?, seller_id = ?, wanted_date = ?, notes = ?, version = version + 1, updated_at = ? WHERE id = ?`)
    .bind(i.customer ?? order.customer, i.seller_id !== undefined ? i.seller_id : order.seller_id,
      i.wanted_date !== undefined ? i.wanted_date : order.wanted_date, i.notes !== undefined ? i.notes : order.notes, nowIso(), order.id));
  await db.batch(stmts);
  for (const id of touched) publish(c, { type: 'port_call.changed', id });
  return c.json({ order: await loadOrder(db, order.id), emptied: await emptied(db, [...touched]) });
});

/**
 * Flytt SO-en (eller noen linjer, eventuelt deler av en linje) til et anløp, til et nytt anløp, eller av båten.
 * Typisk: kunden sender en annen båt i siste liten.
 */
app.post('/:id/assign', body(orderAssign), async c => {
  const i = c.req.valid('json');
  const user = c.get('user');
  const db = c.env.DB;
  const { order, lines } = await current(db, c.req.param('id'));
  checkVersion(order, i.version);

  const movable = lines.filter(l => !l.locked);
  const picks = i.lines
    ? i.lines.map(p => {
      const l = lines.find(x => x.id === p.line_id);
      if (!l) throw fail(400, 'Ukjent varelinje.', { field: 'lines' });
      if (l.locked) throw fail(409, 'Varer som er levert kan ikke flyttes.', { field: 'lines' });
      if (p.quantity > l.quantity) throw fail(400, 'Kan ikke flytte mer enn det som står på linjen.', { field: 'lines' });
      return { line: l, quantity: p.quantity };
    })
    : movable.map(l => ({ line: l, quantity: l.quantity }));
  if (!picks.length) throw fail(409, 'Ingen varer å flytte – alt på ordren er levert.');

  const seller = order.seller_id;
  const place = await resolvePlacement(db, user, i.placement, typeOf(picks.map(p => p.line)), seller);
  const moving = picks.filter(p => p.line.port_call_id !== place.callId);
  if (!moving.length) throw fail(409, 'Varene ligger allerede der.');

  const label = await skuInfo(db, moving.map(p => p.line.sku_id));
  const stmts: D1PreparedStatement[] = [...place.statements];
  const sources = new Map<string | null, string[]>();
  moving.forEach(({ line, quantity }) => {
    if (quantity === line.quantity) {
      stmts.push(db.prepare('UPDATE order_lines SET port_call_id = ? WHERE id = ?').bind(place.callId, line.id));
    } else {
      // Delt levering: resten blir liggende, den flyttede delen blir en ny linje.
      stmts.push(
        db.prepare('UPDATE order_lines SET quantity = quantity - ? WHERE id = ?').bind(quantity, line.id),
        db.prepare('INSERT INTO order_lines (id, sales_order_id, port_call_id, sku_id, quantity, direction, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(newId('ol'), order.id, place.callId, line.sku_id, quantity, line.direction, line.sort),
      );
    }
    const list = sources.get(line.port_call_id) ?? [];
    list.push(label(line.sku_id, quantity));
    sources.set(line.port_call_id, list);
  });

  // Hele SO-en flyttes når alle linjene som kan flyttes går samlet; ellers står det hvilke varer.
  const whole = moving.length === movable.length && moving.every(p => p.quantity === p.line.quantity);
  const to = logCall(place.snapshot);
  for (const [from, labels] of sources) {
    const fromSnap: LogCall | null = from ? logCall(await callSnapshot(db, from)) : null;
    const data = { from: fromSnap, to, ...(whole ? {} : { lines: labels }) };
    const kind = !from ? 'assigned' : !place.callId ? 'unassigned' : 'moved';
    stmts.push(logStatement(db, { orderId: order.id, callId: place.callId ?? from, userId: user.id, kind, data }));
    if (from) stmts.push(...syncLink(db, from, order.id));
  }
  if (place.callId) stmts.push(...syncLink(db, place.callId, order.id));
  stmts.push(db.prepare('UPDATE sales_orders SET version = version + 1, updated_at = ? WHERE id = ?').bind(nowIso(), order.id));
  await db.batch(stmts);

  const affected = [...sources.keys()].filter((x): x is string => !!x);
  for (const id of [...affected, place.callId].filter((x): x is string => !!x)) publish(c, { type: 'port_call.changed', id });
  return c.json({ order: await loadOrder(db, order.id), emptied: await emptied(db, affected) });
});

/** Kanseller SO-en (f.eks. feil i ERP). Varer som ikke er levert tas av båten. */
app.post('/:id/cancel', body(orderCancel), async c => {
  const i = c.req.valid('json');
  const user = c.get('user');
  const db = c.env.DB;
  const { order, lines } = await current(db, c.req.param('id'));
  checkVersion(order, i.version);
  const calls = [...new Set(lines.filter(l => l.port_call_id && !l.locked).map(l => l.port_call_id!))];
  await db.batch([
    db.prepare('UPDATE order_lines SET port_call_id = NULL WHERE sales_order_id = ? AND port_call_id IN (SELECT value FROM json_each(?))')
      .bind(order.id, JSON.stringify(calls)),
    ...calls.flatMap(id => syncLink(db, id, order.id)),
    db.prepare('UPDATE sales_orders SET cancelled_at = ?, cancel_reason = ?, version = version + 1, updated_at = ? WHERE id = ?')
      .bind(nowIso(), i.reason, nowIso(), order.id),
    logStatement(db, { orderId: order.id, callId: calls[0] ?? null, userId: user.id, kind: 'cancelled', data: { reason: i.reason } }),
  ]);
  for (const id of calls) publish(c, { type: 'port_call.changed', id });
  return c.json({ order: await loadOrder(db, order.id), emptied: await emptied(db, calls) });
});

export default app;
