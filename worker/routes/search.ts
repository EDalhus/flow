import { Hono } from 'hono';
import { z } from 'zod';
import type { ExternalVessel, SearchResult } from '../../shared/api.ts';
import { effectiveFlag } from '../../shared/domain/flags.ts';
import { shipTypeLabel } from '../../shared/domain/shiptype.ts';
import type { Flag } from '../../shared/domain/types.ts';
import { PROJECT_NO, REG_NO, parseDay, parseScope, type SearchScope } from '../../shared/domain/search.ts';
import { addDays, osloToUtc, todayOslo } from '../../shared/time.ts';
import { fetchAllLatest, matchVessels, type AisVesselInfo } from '../ais/barentswatch.ts';
import { loadOrders } from '../db/orders.ts';
import { loadCalls } from '../db/portCalls.ts';
import { query } from '../lib/http.ts';
import { loadSettings } from '../lib/settings.ts';
import type { AppEnv } from '../types.ts';

// Globalt søk fra toppfeltet: båter, anløp, biler, bulkbiler og folk i Flow, pluss fartøy fra AIS
// (Kystverket via BarentsWatch) – også båter som ikke er i båtregisteret.
const app = new Hono<AppEnv>();

const LIMIT = 6;

export function toExternal(v: AisVesselInfo, boatId: string | null): ExternalVessel {
  const num = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null);
  return {
    mmsi: String(v.mmsi), name: v.name?.trim() || null, callsign: v.callSign?.trim() || null,
    imo: v.imoNumber ? String(v.imoNumber) : null, ship_type: shipTypeLabel(v.shipType),
    length: num(v.shipLength), width: num(v.shipWidth), draught: num(v.draught),
    destination: v.destination?.trim() || null, country: v.countryCode ?? null,
    lat: typeof v.latitude === 'number' ? v.latitude : null, lon: typeof v.longitude === 'number' ? v.longitude : null,
    sog: typeof v.speedOverGround === 'number' ? v.speedOverGround : null, seen_at: v.msgtime ?? null, boat_id: boatId,
  };
}

type CallRow = SearchResult['calls'][number];
type BulkRow = { id: string; truck: string; destination: string | null; status: string; delivery_no: number | null; project_no: string | null; at: string };
const BULK_SELECT = `SELECT o.id, coalesce(v.reg_no, o.truck) AS truck, coalesce(bc.name, o.destination) AS destination, o.status, o.delivery_no, o.project_no,
                            coalesce(o.finished_at, o.expected_at, o.created_at) AS at
                     FROM bulk_orders o LEFT JOIN vehicles v ON v.id = o.vehicle_id LEFT JOIN bulk_customers bc ON bc.id = o.customer_id`;

app.get('/', query(z.object({ q: z.string().trim().min(1).max(80) })), async c => {
  const parsed = parseScope(c.req.valid('query').q);
  const { scope } = parsed;
  const q = parsed.q || c.req.valid('query').q;
  const db = c.env.DB;
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const compact = q.replace(/\s+/g, '');
  const today = todayOslo();
  const digits = /^\d+$/.test(q) ? Number(q) : -1;
  const on = (...s: SearchScope[]) => !scope || s.includes(scope);
  const none = db.prepare('SELECT 1 WHERE 0');

  const [boats, callIds, trucks, bulk, users, mmsiRows, orderIds, vehicles, projects, drivers, agents] = await db.batch([
    on('bat') ? db.prepare(`SELECT id, name, mmsi, flag_auto, flag_override FROM boats
                WHERE active = 1 AND (name LIKE ?1 OR mmsi LIKE ?1 OR callsign LIKE ?1 OR imo LIKE ?1) ORDER BY name LIMIT ${LIMIT}`).bind(like) : none,
    on('bat', 'kai') ? db.prepare(`SELECT pc.id FROM port_calls pc JOIN boats b ON b.id = pc.boat_id JOIN quays q ON q.id = pc.quay_id
                WHERE pc.source = 'app' AND pc.cancelled_at IS NULL AND pc.service_date BETWEEN ? AND ?
                  AND (${scope === 'kai' ? 'q.name LIKE ?3 OR q.nickname LIKE ?3 OR q.company LIKE ?3' : 'b.name LIKE ?3'})
                ORDER BY pc.service_date >= ?4 DESC, abs(julianday(pc.service_date) - julianday(?4)) LIMIT ${scope === 'kai' ? 12 : LIMIT}`)
      .bind(addDays(today, scope === 'kai' ? -1 : -14), addDays(today, 60), like, today) : none,
    on('so', 'bil', 'kunde') ? db.prepare(`SELECT id, so_number, customer, expected_date, reg_no, picked_up_at FROM truck_orders
                WHERE cancelled_at IS NULL AND (customer LIKE ?1 OR carrier LIKE ?1 OR reg_no LIKE ?1 OR replace(reg_no, ' ', '') LIKE ?2 OR so_number LIKE ?1)
                ORDER BY picked_up_at IS NOT NULL, expected_date DESC LIMIT ${LIMIT}`).bind(like, `%${compact}%`) : none,
    on('bil', 'kunde', 'sjafor') ? db.prepare(`${BULK_SELECT} LEFT JOIN drivers d ON d.id = o.driver_profile_id
                WHERE o.truck LIKE ?1 OR replace(v.reg_no, ' ', '') LIKE ?2 OR o.destination LIKE ?1 OR bc.name LIKE ?1 OR o.project_no LIKE ?1
                   OR o.so_number LIKE ?1 OR o.delivery_no = ?3 OR d.name LIKE ?1
                ORDER BY o.delivery_no = ?3 DESC, o.created_at DESC LIMIT ${LIMIT}`).bind(like, `%${compact}%`, digits) : none,
    on('person') ? db.prepare(`SELECT id, name, title, phone FROM users WHERE active = 1 AND (name LIKE ?1 OR short_name LIKE ?1 OR title LIKE ?1)
                ORDER BY name LIMIT ${LIMIT}`).bind(like) : none,
    db.prepare(`SELECT id, mmsi FROM boats WHERE mmsi IS NOT NULL`),
    // Salgsordre: SO-nummer (også delvis, f.eks. «4364») eller kunde.
    on('so', 'kunde') ? db.prepare(`SELECT so.id FROM sales_orders so WHERE so.source = 'app' AND (so.so_number LIKE ?1 OR so.customer LIKE ?1)
                ORDER BY so.cancelled_at IS NOT NULL, so.so_number = ?2 DESC, so.created_at DESC LIMIT ${LIMIT}`).bind(like, q) : none,
    // Reg.nr. («SU 20 110» eller «SU20110»): bilen med lastinger i dag og totalt.
    on('bil') && (REG_NO.test(q) || scope === 'bil') ? db.prepare(`
                SELECT v.id, v.reg_no, v.description, h.name AS hauler,
                       (SELECT count(*) FROM bulk_orders o WHERE o.vehicle_id = v.id AND o.status <> 'avlyst' AND o.created_at >= ?2) AS today,
                       (SELECT count(*) FROM bulk_orders o WHERE o.vehicle_id = v.id AND o.status = 'ferdig') AS total,
                       (SELECT max(o.finished_at) FROM bulk_orders o WHERE o.vehicle_id = v.id) AS last_at
                FROM vehicles v JOIN haulers h ON h.id = v.hauler_id WHERE replace(v.reg_no, ' ', '') LIKE ?1 OR v.description LIKE ?3 LIMIT ${LIMIT}`)
      .bind(`%${compact}%`, osloToUtc(today, 0), like) : none,
    // Prosjektnummer («P-2631»): leveranser og tonn på prosjektet.
    on('kunde', 'bil') && (PROJECT_NO.test(q) || scope === 'kunde') ? db.prepare(`
                SELECT o.project_no, max(bc.name) AS customer, count(*) AS loads, round(sum((SELECT sum(coalesce(s.weighed_tonnes, s.tonnes)) FROM bulk_order_steps s WHERE s.order_id = o.id)), 2) AS tonnes
                FROM bulk_orders o LEFT JOIN bulk_customers bc ON bc.id = o.customer_id
                WHERE o.project_no LIKE ?1 AND o.status = 'ferdig' GROUP BY o.project_no ORDER BY max(o.finished_at) DESC LIMIT ${LIMIT}`).bind(like) : none,
    on('sjafor', 'person') ? db.prepare(`SELECT d.id, d.name, d.phone, h.name AS hauler FROM drivers d JOIN haulers h ON h.id = d.hauler_id
                WHERE d.active = 1 AND (d.name LIKE ?1 OR d.phone LIKE ?2) ORDER BY d.name LIMIT ${LIMIT}`).bind(like, `%${compact.replace(/\D/g, '') || 'x'}%`) : none,
    on('person') ? db.prepare(`SELECT id, name, phone FROM agents WHERE name LIKE ? ORDER BY name LIMIT ${LIMIT}`).bind(like) : none,
  ]);
  const orders = await loadOrders(db, { ids: (orderIds.results as { id: string }[]).map(r => r.id) });

  const settings = await loadSettings(db);
  const loadCallRows = async (ids: string[]): Promise<CallRow[]> => {
    const calls = ids.length ? await loadCalls(db, { ids }, settings) : [];
    const order = new Map(ids.map((id, i) => [id, i]));
    calls.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return calls.map(x => ({ id: x.id, boat_name: x.boat.name, service_date: x.service_date, eta: x.eta, time_known: x.time_known, type: x.type, status: x.status }));
  };
  type TruckRow = { id: string; so_number: string; customer: string; expected_date: string; reg_no: string | null; picked_up_at: string | null };
  const truckRows = (rows: TruckRow[]) => rows.map(t => ({ id: t.id, so_number: t.so_number, customer: t.customer, expected_date: t.expected_date, reg_no: t.reg_no, picked_up: !!t.picked_up_at }));

  // Dato i søket: anløp, bilhentinger og bulkbestillinger den dagen (eller uka).
  const day = scope ? null : parseDay(q, today);
  let agenda: SearchResult['agenda'] = null;
  if (day) {
    const [ac, at, ab] = await db.batch([
      db.prepare(`SELECT id FROM port_calls WHERE cancelled_at IS NULL AND service_date BETWEEN ? AND ? ORDER BY eta LIMIT 20`).bind(day.from, day.to),
      db.prepare(`SELECT id, so_number, customer, expected_date, reg_no, picked_up_at FROM truck_orders WHERE cancelled_at IS NULL AND expected_date BETWEEN ? AND ?
                  ORDER BY expected_date, customer LIMIT 20`).bind(day.from, day.to),
      db.prepare(`${BULK_SELECT} WHERE o.status <> 'avlyst' AND coalesce(o.expected_at, o.created_at) >= ? AND coalesce(o.expected_at, o.created_at) < ?
                  ORDER BY coalesce(o.expected_at, o.created_at) LIMIT 20`).bind(osloToUtc(day.from, 0), osloToUtc(addDays(day.to, 1), 0)),
    ]);
    agenda = { ...day, calls: await loadCallRows((ac.results as { id: string }[]).map(r => r.id)), trucks: truckRows(at.results as TruckRow[]), bulk: ab.results as BulkRow[] };
  }

  // AIS: bare når søket ligner et navn eller nummer, og nøklene finnes.
  let vessels: ExternalVessel[] = [];
  let aisError: string | null = null;
  if (q.length >= 3 && on('bat') && !day && !REG_NO.test(q) && !PROJECT_NO.test(q)) {
    if (!c.env.BW_CLIENT_ID || !c.env.BW_CLIENT_SECRET) aisError = 'AIS-søk er ikke satt opp (BarentsWatch-nøkler mangler).';
    else {
      try {
        const fleet = await fetchAllLatest({ clientId: c.env.BW_CLIENT_ID, clientSecret: c.env.BW_CLIENT_SECRET });
        const byMmsi = new Map((mmsiRows.results as { id: string; mmsi: string }[]).map(r => [r.mmsi, r.id]));
        vessels = matchVessels(fleet, q).map(v => toExternal(v, byMmsi.get(String(v.mmsi)) ?? null));
      } catch (e) {
        aisError = e instanceof Error ? e.message : 'AIS-søket feilet.';
      }
    }
  }

  type BoatRow = { id: string; name: string; mmsi: string | null; flag_auto: Flag; flag_override: Flag | null };
  return c.json({
    q,
    scope,
    boats: (boats.results as BoatRow[]).map(b => ({ id: b.id, name: b.name, mmsi: b.mmsi, flag: effectiveFlag(b) })),
    orders: orders.map(o => ({
      id: o.id, kind: o.kind, so_number: o.so_number, customer: o.customer, status: o.status, boat_name: o.calls[0]?.boat_name ?? null,
      service_date: o.calls[0]?.service_date ?? o.wanted_date,
    })),
    calls: await loadCallRows((callIds.results as { id: string }[]).map(r => r.id)),
    trucks: truckRows(trucks.results as TruckRow[]),
    bulk: bulk.results as BulkRow[],
    users: users.results as SearchResult['users'],
    vessels,
    ais_error: aisError,
    agenda,
    vehicles: vehicles.results as SearchResult['vehicles'],
    projects: projects.results as SearchResult['projects'],
    drivers: drivers.results as SearchResult['drivers'],
    agents: agents.results as SearchResult['agents'],
  } satisfies SearchResult);
});

export default app;
