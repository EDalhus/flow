import type { CallOrder, CollisionView, GoodsView, PortCallView, SuggestionView, UserRef } from '../../shared/api.ts';
import {
  collisionsFor, describeCollision, findCollisions, suggest,
  type CapacityFor, type Collision, type CollisionCall, type Suggestion,
} from '../../shared/domain/collisions.ts';
import { effectiveFlag } from '../../shared/domain/flags.ts';
import { quayLabel } from '../../shared/domain/quay.ts';
import { deriveStatus, isActive } from '../../shared/domain/status.ts';
import type { CallType, CrewRole, Direction, Flag, Settings } from '../../shared/domain/types.ts';
import { addDays, osloTime, serviceDate } from '../../shared/time.ts';
import { loadCapacity, loadSettings } from '../lib/settings.ts';

type CallRow = {
  id: string; type: CallType; eta: string; etd: string; time_known: number; service_date: string; boat_crane: number; notes: string | null;
  version: number; arrived_at: string | null; departed_at: string | null; completed_at: string | null; cancelled_at: string | null;
  boat_id: string; boat_name: string; flag_auto: Flag; flag_auto_reason: string | null; flag_override: Flag | null;
  flag_override_reason: string | null; avg_total: number | null; rating_count: number;
  quay_id: string; quay_name: string; quay_nickname: string | null; quay_company: string | null;
  seller_id: string | null; seller_name: string | null; seller_short: string | null; seller_initials: string | null; seller_phone: string | null;
  resp_id: string | null; resp_name: string | null; resp_short: string | null; resp_initials: string | null;
  has_log: number; message_count: number;
  ais_fetched_at: string | null; ais_sog: number | null; ais_in_geofence: number | null;
};
type GoodsRow = {
  id: string; port_call_id: string; sales_order_id: string; sku_id: string; product_id: string; product_name: string; unit: 'BB' | 'pall';
  pallet_type: 'europall' | 'srs' | null; bags_per_unit: number | null; kg_per_unit: number; quantity: number; direction: Direction;
};
type OrderRow = { port_call_id: string; sales_order_id: string; so_number: string; customer: string; load_seq: number; split: number };
type CrewRow = { id: string; port_call_id: string; crew_role: CrewRole; user_id: string | null; name: string | null; short_name: string | null; initials: string | null };

/** Filter for hvilke anløp som lastes. Importert historikk vises aldri i planleggingen. */
export type CallFilter = { from: string; to: string } | { ids: string[] };

function where(f: CallFilter): { sql: string; params: unknown[] } {
  if ('ids' in f) return { sql: `pc.id IN (SELECT value FROM json_each(?))`, params: [JSON.stringify(f.ids)] };
  return { sql: `pc.source = 'app' AND pc.service_date BETWEEN ? AND ?`, params: [f.from, f.to] };
}

const ref = (id: string | null, name: string | null, short: string | null, initials: string | null): UserRef | null =>
  id ? { id, name: name ?? '', short_name: short ?? '', initials: initials ?? '' } : null;

export function goodsLabel(g: Pick<GoodsRow, 'quantity' | 'unit' | 'product_name' | 'bags_per_unit' | 'pallet_type'>): string {
  const base = `${g.quantity} ${g.unit} ${g.product_name}`;
  if (g.unit !== 'pall') return base;
  return `${base} · 25 kg × ${g.bags_per_unit} · ${g.pallet_type === 'srs' ? 'SRS-pall' : 'Europall'}`;
}

/** Varelinje fra databasen til visning. */
export const goodsView = (x: GoodsRow): GoodsView => ({
  id: x.id, sku_id: x.sku_id, product_id: x.product_id, product_name: x.product_name, unit: x.unit,
  pallet_type: x.pallet_type, bags_per_unit: x.bags_per_unit, quantity: x.quantity, direction: x.direction,
  tonnes: (x.quantity * x.kg_per_unit) / 1000, label: goodsLabel(x), sales_order_id: x.sales_order_id,
});
export type { GoodsRow };

/** Laster anløp med salgsordre, varer, mannskap og status. Kollisjoner fylles inn av withCollisions(). */
export async function loadCalls(db: D1Database, filter: CallFilter, settings: Settings, now = new Date()): Promise<PortCallView[]> {
  const w = where(filter);
  const [calls, goods, crew, orders] = await db.batch([
    db.prepare(`
      SELECT pc.id, pc.type, pc.eta, pc.etd, pc.time_known, pc.service_date, pc.boat_crane, pc.notes, pc.version,
             pc.arrived_at, pc.departed_at, pc.completed_at, pc.cancelled_at,
             b.id AS boat_id, b.name AS boat_name, b.flag_auto, b.flag_auto_reason, b.flag_override, b.flag_override_reason,
             b.avg_total, b.rating_count,
             q.id AS quay_id, q.name AS quay_name, q.nickname AS quay_nickname, q.company AS quay_company,
             s.id AS seller_id, s.name AS seller_name, s.short_name AS seller_short, s.initials AS seller_initials, s.phone AS seller_phone,
             r.id AS resp_id, r.name AS resp_name, r.short_name AS resp_short, r.initials AS resp_initials,
             EXISTS (SELECT 1 FROM quay_logs ql WHERE ql.port_call_id = pc.id) AS has_log,
             (SELECT count(*) FROM messages m WHERE m.port_call_id = pc.id) AS message_count,
             a.fetched_at AS ais_fetched_at, a.sog AS ais_sog, a.in_geofence AS ais_in_geofence
      FROM port_calls pc
      JOIN boats b ON b.id = pc.boat_id
      JOIN quays q ON q.id = pc.quay_id
      LEFT JOIN users s ON s.id = pc.seller_id
      LEFT JOIN users r ON r.id = pc.responsible_user_id
      LEFT JOIN ais_positions a ON a.boat_id = pc.boat_id
      WHERE ${w.sql}
      ORDER BY pc.eta`).bind(...w.params),
    db.prepare(`
      SELECT g.id, g.port_call_id, g.sales_order_id, g.sku_id, s.product_id, p.name AS product_name, s.unit, s.pallet_type, s.bags_per_unit,
             s.kg_per_unit, g.quantity, g.direction
      FROM order_lines g JOIN skus s ON s.id = g.sku_id JOIN products p ON p.id = s.product_id
      WHERE g.port_call_id IN (SELECT pc.id FROM port_calls pc WHERE ${w.sql})
      ORDER BY g.sort`).bind(...w.params),
    db.prepare(`
      SELECT cs.id, cs.port_call_id, cs.crew_role, u.id AS user_id, u.name, u.short_name, u.initials
      FROM crew_slots cs LEFT JOIN users u ON u.id = cs.user_id
      WHERE cs.port_call_id IN (SELECT pc.id FROM port_calls pc WHERE ${w.sql})
      ORDER BY cs.sort`).bind(...w.params),
    db.prepare(`
      SELECT o.port_call_id, o.sales_order_id, so.so_number, so.customer, o.load_seq,
             EXISTS (SELECT 1 FROM order_lines l WHERE l.sales_order_id = o.sales_order_id AND l.port_call_id IS NOT o.port_call_id) AS split
      FROM port_call_orders o JOIN sales_orders so ON so.id = o.sales_order_id
      WHERE o.port_call_id IN (SELECT pc.id FROM port_calls pc WHERE ${w.sql})
      ORDER BY o.load_seq, so.so_number`).bind(...w.params),
  ]);

  const goodsBy = Map.groupBy(goods.results as GoodsRow[], g => g.port_call_id);
  const crewBy = Map.groupBy(crew.results as CrewRow[], s => s.port_call_id);
  const ordersBy = Map.groupBy(orders.results as OrderRow[], o => o.port_call_id);

  return (calls.results as CallRow[]).map(r => {
    const g: GoodsView[] = (goodsBy.get(r.id) ?? []).map(goodsView);
    // Lasterekkefølge: SO-ene i rekkefølge, nummerert 1, 2, 3 … uansett hull i load_seq.
    const callOrders: CallOrder[] = (ordersBy.get(r.id) ?? []).map((o, i) => {
      const og = g.filter(x => x.sales_order_id === o.sales_order_id);
      return {
        id: o.sales_order_id, so_number: o.so_number, customer: o.customer, load_seq: i + 1,
        tonnes: og.reduce((s, x) => s + x.tonnes, 0), goods: og, split: !!o.split,
      };
    });
    // Goods i lasterekkefølge.
    const seq = new Map(callOrders.map(o => [o.id, o.load_seq]));
    g.sort((a, b) => (seq.get(a.sales_order_id) ?? 99) - (seq.get(b.sales_order_id) ?? 99));
    const dirs = new Set(g.map(x => x.direction));
    const slots = crewBy.get(r.id) ?? [];
    const st = deriveStatus(
      {
        ...r,
        time_known: !!r.time_known,
        completed_at: r.completed_at ?? (r.has_log ? r.etd : null),
        ais: r.ais_fetched_at ? { fetched_at: r.ais_fetched_at, sog: r.ais_sog, in_geofence: !!r.ais_in_geofence } : null,
      },
      now,
      { missingAfterMinutes: settings.quay_log_missing_after_minutes },
    );
    const flag = effectiveFlag(r);
    return {
      id: r.id, type: dirs.size > 1 ? 'begge' : dirs.has('ut') ? 'henting' : dirs.has('inn') ? 'levering' : r.type, eta: r.eta, etd: r.etd, time_known: !!r.time_known, service_date: r.service_date, boat_crane: !!r.boat_crane,
      notes: r.notes, version: r.version,
      boat: {
        id: r.boat_id, name: r.boat_name, flag, flag_reason: r.flag_override ? r.flag_override_reason : r.flag_auto_reason,
        flag_overridden: !!r.flag_override, avg_total: r.avg_total, rating_count: r.rating_count,
      },
      quay: { id: r.quay_id, name: r.quay_name, nickname: r.quay_nickname, company: r.quay_company },
      seller: r.seller_id ? { ...ref(r.seller_id, r.seller_name, r.seller_short, r.seller_initials)!, phone: r.seller_phone } : null,
      responsible: ref(r.resp_id, r.resp_name, r.resp_short, r.resp_initials),
      responsible_auto: slots.length === 1,
      goods: g,
      orders: callOrders,
      tonnes_in: g.filter(x => x.direction === 'inn').reduce((s, x) => s + x.tonnes, 0),
      tonnes_out: g.filter(x => x.direction === 'ut').reduce((s, x) => s + x.tonnes, 0),
      crew: slots.map(s => ({ id: s.id, crew_role: s.crew_role, user: ref(s.user_id, s.name, s.short_name, s.initials) })),
      status: st.status, status_basis: st.basis,
      arrived_at: r.arrived_at, departed_at: r.departed_at, completed_at: r.completed_at, cancelled_at: r.cancelled_at,
      has_quay_log: !!r.has_log, message_count: r.message_count, collisions: [],
    };
  });
}

export const toCollisionCall = (c: Pick<PortCallView, 'id' | 'boat' | 'quay' | 'eta' | 'etd' | 'crew'>): CollisionCall => ({
  id: c.id, boat_name: c.boat.name, quay_id: c.quay.id, eta: c.eta, etd: c.etd,
  crew: c.crew.map(s => ({ crew_role: s.crew_role, user_id: s.user?.id ?? null })),
});

export interface CollisionContext {
  settings: Settings;
  capacityFor: CapacityFor;
  quays: { id: string; name: string; nickname: string | null; company: string | null }[];
  users: Map<string, string>;
  /** Aktive anløp med kjent tid i perioden (pluss en dag på hver side, for anløp over midnatt). */
  active: CollisionCall[];
}

export async function collisionContext(db: D1Database, from: string, to: string, settings?: Settings): Promise<CollisionContext & { calls: PortCallView[] }> {
  settings ??= await loadSettings(db);
  const padFrom = addDays(from, -1), padTo = addDays(to, 1);
  const [calls, capacityFor, quays, users] = await Promise.all([
    loadCalls(db, { from: padFrom, to: padTo }, settings),
    loadCapacity(db, settings, padFrom, padTo),
    db.prepare('SELECT id, name, nickname, company FROM quays WHERE active = 1 ORDER BY company IS NOT NULL, sort, name')
      .all<{ id: string; name: string; nickname: string | null; company: string | null }>(),
    db.prepare('SELECT id, short_name FROM users').all<{ id: string; short_name: string }>(),
  ]);
  return {
    settings, capacityFor, calls, quays: quays.results,
    users: new Map(users.results.map(u => [u.id, u.short_name])),
    active: calls.filter(c => isActive(c.status) && c.time_known).map(toCollisionCall),
  };
}

function suggestionText(s: Suggestion, ctx: CollisionContext, original?: CollisionCall): string {
  if (s.kind === 'move_quay') {
    const q = ctx.quays.find(x => x.id === s.quay_id);
    return `Flytt til ${q ? quayLabel(q) : 'annen kai'}`;
  }
  const sameDay = original && serviceDate(original.eta) === serviceDate(s.eta);
  const day = sameDay ? '' : `${serviceDate(s.eta).slice(8, 10)}.${serviceDate(s.eta).slice(5, 7)} `;
  return `Utsett til ${day}${osloTime(s.eta)}–${osloTime(s.etd)}`;
}

export function viewCollision(c: Collision, self: string | null, calls: CollisionCall[], ctx: CollisionContext, target?: string): CollisionView {
  const byId = new Map(calls.map(x => [x.id, x]));
  const suggestions: SuggestionView[] = suggest(c, calls, {
    quayIds: ctx.quays.map(q => q.id), capacityFor: ctx.capacityFor, bufferMinutes: ctx.settings.postpone_buffer_minutes, target,
  }).map(s => {
    const text = suggestionText(s, ctx, byId.get(s.call_id));
    // Gjelder forslaget et annet anløp enn det vi ser på, sies det hvilket.
    return { ...s, text: s.call_id === self ? text : `${byId.get(s.call_id)?.boat_name ?? 'Det andre anløpet'}: ${text.charAt(0).toLowerCase()}${text.slice(1)}` };
  });
  return {
    ...c,
    text: describeCollision(c, {
      quay: id => { const q = ctx.quays.find(x => x.id === id); return q ? quayLabel(q) : id; },
      user: id => ctx.users.get(id) ?? id,
    }),
    with: c.calls.filter(id => id !== self).map(id => ({ id, boat_name: byId.get(id)?.boat_name ?? '' })),
    suggestions,
  };
}

/** Fyller inn kollisjoner (med forslag) på hvert anløp. */
export function attachCollisions(views: PortCallView[], ctx: CollisionContext): { views: PortCallView[]; all: CollisionView[] } {
  const all = findCollisions(ctx.active, ctx.capacityFor);
  for (const v of views) {
    v.collisions = collisionsFor(v.id, all).map(c => viewCollision(c, v.id, ctx.active, ctx));
  }
  const visible = new Set(views.map(v => v.id));
  return { views, all: all.filter(c => c.calls.some(id => visible.has(id))).map(c => viewCollision(c, null, ctx.active, ctx)) };
}

/** Laster ett anløp med kollisjoner. */
export async function loadCall(db: D1Database, id: string): Promise<PortCallView | null> {
  const settings = await loadSettings(db);
  const [view] = await loadCalls(db, { ids: [id] }, settings);
  if (!view) return null;
  const ctx = await collisionContext(db, view.service_date, view.service_date, settings);
  attachCollisions([view], ctx);
  return view;
}
