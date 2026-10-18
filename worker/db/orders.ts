import type { CallRef, LogCall, OrderDetail, OrderLine, OrderLogEntry, OrderStatus, OrderView, UserRef } from '../../shared/api.ts';
import { quayLabel } from '../../shared/domain/quay.ts';
import { loadSettings } from '../lib/settings.ts';
import { goodsView, loadCalls, type GoodsRow } from './portCalls.ts';

// Salgsordre (SO): lesing, status og hjelpere for koblingen mellom ordrelinjer og anløp.
//
//   sales_orders      – SO-nummer, kunde, selger, ønsket dag
//   order_lines       – varene; port_call_id = anløpet linjen skal med (NULL = venter på båt)
//   port_call_orders  – hvilke SO-er et anløp har, og lasterekkefølgen
//   order_log         – endringslogg per SO (og per anløp via port_call_id)

type OrderRow = {
  id: string; so_number: string; customer: string; wanted_date: string | null; notes: string | null; version: number;
  cancelled_at: string | null; created_at: string;
  seller_id: string | null; seller_name: string | null; seller_short: string | null; seller_initials: string | null;
};
type LineRow = GoodsRow & { port_call_id: string | null };

export type OrderFilter = { ids: string[] } | { open: true; since: string } | { calls: string[] };

const ORDER_SELECT = `
  SELECT so.id, so.so_number, so.customer, so.wanted_date, so.notes, so.version, so.cancelled_at, so.created_at,
         u.id AS seller_id, u.name AS seller_name, u.short_name AS seller_short, u.initials AS seller_initials
  FROM sales_orders so LEFT JOIN users u ON u.id = so.seller_id`;

function whereOrders(f: OrderFilter): { sql: string; params: unknown[] } {
  if ('ids' in f) return { sql: 'so.id IN (SELECT value FROM json_each(?))', params: [JSON.stringify(f.ids)] };
  if ('calls' in f) {
    return { sql: 'so.id IN (SELECT sales_order_id FROM port_call_orders WHERE port_call_id IN (SELECT value FROM json_each(?)))', params: [JSON.stringify(f.calls)] };
  }
  // Åpne SO-er (ikke kansellert, med linjer som ikke er levert) og de som er ferdige/kansellert nylig.
  return {
    sql: `so.source = 'app' AND (
            (so.cancelled_at IS NULL AND EXISTS (
               SELECT 1 FROM order_lines l LEFT JOIN port_calls pc ON pc.id = l.port_call_id
               WHERE l.sales_order_id = so.id AND (l.port_call_id IS NULL OR (pc.completed_at IS NULL AND pc.cancelled_at IS NULL
                 AND NOT EXISTS (SELECT 1 FROM quay_logs ql WHERE ql.port_call_id = pc.id)))))
            OR so.updated_at >= ?)`,
    params: [f.since],
  };
}

export function orderStatus(cancelled: boolean, lines: { port_call_id: string | null }[], callStatus: Map<string, string>): OrderStatus {
  if (cancelled) return 'kansellert';
  if (!lines.length) return 'venter';
  const assigned = lines.filter(l => l.port_call_id);
  if (!assigned.length) return 'venter';
  if (assigned.length === lines.length && assigned.every(l => callStatus.get(l.port_call_id!) === 'ferdig')) return 'ferdig';
  return assigned.length < lines.length ? 'delvis' : 'planlagt';
}

export async function loadOrders(db: D1Database, filter: OrderFilter): Promise<OrderView[]> {
  const w = whereOrders(filter);
  const [orders, lines, links] = await db.batch([
    db.prepare(`${ORDER_SELECT} WHERE ${w.sql} ORDER BY coalesce(so.wanted_date, '9999'), so.so_number`).bind(...w.params),
    db.prepare(`
      SELECT g.id, g.port_call_id, g.sales_order_id, g.sku_id, s.product_id, p.name AS product_name, s.unit, s.pallet_type, s.bags_per_unit,
             s.kg_per_unit, g.quantity, g.direction
      FROM order_lines g JOIN skus s ON s.id = g.sku_id JOIN products p ON p.id = s.product_id
      WHERE g.sales_order_id IN (SELECT so.id FROM sales_orders so WHERE ${w.sql})
      ORDER BY g.sort`).bind(...w.params),
    db.prepare(`SELECT port_call_id, sales_order_id, load_seq FROM port_call_orders
                WHERE sales_order_id IN (SELECT so.id FROM sales_orders so WHERE ${w.sql})`).bind(...w.params),
  ]);
  const linkRows = links.results as { port_call_id: string; sales_order_id: string; load_seq: number }[];
  const callIds = [...new Set(linkRows.map(l => l.port_call_id))];
  const settings = await loadSettings(db);
  const calls = callIds.length ? await loadCalls(db, { ids: callIds }, settings) : [];
  const callById = new Map(calls.map(c => [c.id, c]));
  const callStatus = new Map(calls.map(c => [c.id, c.status]));
  const linesBy = Map.groupBy(lines.results as LineRow[], l => l.sales_order_id);
  const linksBy = Map.groupBy(linkRows, l => l.sales_order_id);

  return (orders.results as OrderRow[]).map(o => {
    const ls: OrderLine[] = (linesBy.get(o.id) ?? []).map(l => ({ ...goodsView(l), port_call_id: l.port_call_id }));
    const refs: CallRef[] = (linksBy.get(o.id) ?? []).flatMap(l => {
      const c = callById.get(l.port_call_id);
      if (!c) return [];
      // Plassen i lasterekkefølgen på det anløpet (1, 2, 3 …).
      const seq = c.orders.find(x => x.id === o.id)?.load_seq ?? l.load_seq;
      return [{
        id: c.id, boat_id: c.boat.id, boat_name: c.boat.name, quay: c.quay, eta: c.eta, etd: c.etd, time_known: c.time_known,
        service_date: c.service_date, status: c.status, load_seq: seq,
      }];
    }).sort((a, b) => a.eta.localeCompare(b.eta));
    const seller: UserRef | null = o.seller_id
      ? { id: o.seller_id, name: o.seller_name ?? '', short_name: o.seller_short ?? '', initials: o.seller_initials ?? '' } : null;
    return {
      id: o.id, so_number: o.so_number, customer: o.customer, seller, wanted_date: o.wanted_date, notes: o.notes,
      status: orderStatus(!!o.cancelled_at, ls, callStatus), version: o.version, lines: ls,
      tonnes: ls.reduce((s, l) => s + l.tonnes, 0), calls: refs, cancelled_at: o.cancelled_at, created_at: o.created_at,
    };
  });
}

type LogRow = {
  id: number; at: string; kind: OrderLogEntry['kind']; data: string; port_call_id: string | null; sales_order_id: string | null;
  so_number: string | null; u_id: string | null; u_name: string | null; u_short: string | null; u_initials: string | null;
};

const LOG_SELECT = `
  SELECT g.id, g.at, g.kind, g.data, g.port_call_id, g.sales_order_id, so.so_number,
         u.id AS u_id, u.name AS u_name, u.short_name AS u_short, u.initials AS u_initials
  FROM order_log g LEFT JOIN sales_orders so ON so.id = g.sales_order_id LEFT JOIN users u ON u.id = g.user_id`;

const toLog = (r: LogRow): OrderLogEntry => ({
  id: r.id, at: r.at, kind: r.kind, data: JSON.parse(r.data), port_call_id: r.port_call_id, sales_order_id: r.sales_order_id,
  so_number: r.so_number,
  user: r.u_id ? { id: r.u_id, name: r.u_name ?? '', short_name: r.u_short ?? '', initials: r.u_initials ?? '' } : null,
});

/** Én SO med logg. `key` er id eller SO-nummer. */
export async function loadOrder(db: D1Database, key: string): Promise<OrderDetail | null> {
  const row = await db.prepare('SELECT id FROM sales_orders WHERE id = ? OR so_number = ?').bind(key, key).first<{ id: string }>();
  if (!row) return null;
  const [order] = await loadOrders(db, { ids: [row.id] });
  const { results } = await db.prepare(`${LOG_SELECT} WHERE g.sales_order_id = ? ORDER BY g.at DESC, g.id DESC`).bind(row.id).all<LogRow>();
  return { ...order, log: results.map(toLog) };
}

/** Loggen for et anløp: alt som er ført på SO-ene mens de lå på anløpet, nyeste først. */
export async function loadCallLog(db: D1Database, callId: string): Promise<OrderLogEntry[]> {
  const { results } = await db.prepare(`${LOG_SELECT} WHERE g.port_call_id = ? ORDER BY g.at DESC, g.id DESC LIMIT 300`).bind(callId).all<LogRow>();
  return results.map(toLog);
}

// ---------------------------------------------------------------- skriving

/** Anløpet slik det lagres i loggen (båt, tid og kai da endringen skjedde). */
export type CallSnapshot = LogCall & { id: string };

export async function callSnapshot(db: D1Database, id: string): Promise<CallSnapshot | null> {
  const r = await db.prepare(`SELECT pc.id, b.name AS boat, pc.eta, pc.time_known, q.name, q.nickname, q.company
                              FROM port_calls pc JOIN boats b ON b.id = pc.boat_id JOIN quays q ON q.id = pc.quay_id WHERE pc.id = ?`)
    .bind(id).first<{ id: string; boat: string; eta: string; time_known: number; name: string; nickname: string | null; company: string | null }>();
  return r ? { id: r.id, boat: r.boat, eta: r.eta, time_known: !!r.time_known, quay: quayLabel(r) } : null;
}
export const logCall = (s: CallSnapshot | null): LogCall | null => (s ? { boat: s.boat, eta: s.eta, time_known: s.time_known, quay: s.quay } : null);

export function logStatement(db: D1Database, e: { orderId: string | null; callId?: string | null; userId: string; kind: OrderLogEntry['kind']; data?: unknown; at?: string }) {
  return db.prepare('INSERT INTO order_log (sales_order_id, port_call_id, user_id, kind, data, at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(e.orderId, e.callId ?? null, e.userId, e.kind, JSON.stringify(e.data ?? {}), e.at ?? new Date().toISOString());
}

/**
 * Holder port_call_orders i takt med linjene: SO-en legges sist i lasterekkefølgen når den får sin
 * første linje på anløpet, og fjernes når den ikke har flere linjer der.
 */
export function syncLink(db: D1Database, callId: string, orderId: string) {
  return [
    db.prepare(`INSERT OR IGNORE INTO port_call_orders (port_call_id, sales_order_id, load_seq)
                SELECT ?1, ?2, coalesce((SELECT max(load_seq) FROM port_call_orders WHERE port_call_id = ?1), 0) + 1
                WHERE EXISTS (SELECT 1 FROM order_lines WHERE port_call_id = ?1 AND sales_order_id = ?2)`).bind(callId, orderId),
    db.prepare(`DELETE FROM port_call_orders WHERE port_call_id = ?1 AND sales_order_id = ?2
                AND NOT EXISTS (SELECT 1 FROM order_lines WHERE port_call_id = ?1 AND sales_order_id = ?2)`).bind(callId, orderId),
  ];
}

/** SO-ene som ligger på et anløp (id og selger), til logging av endringer på anløpet. */
export async function ordersOnCall(db: D1Database, callId: string) {
  const { results } = await db.prepare(`SELECT so.id, so.so_number, so.seller_id FROM port_call_orders o JOIN sales_orders so ON so.id = o.sales_order_id
                                        WHERE o.port_call_id = ? ORDER BY o.load_seq`).bind(callId).all<{ id: string; so_number: string; seller_id: string | null }>();
  return results;
}
