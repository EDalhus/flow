import { Hono } from 'hono';
import { z } from 'zod';
import type { ExternalVessel, SearchResult } from '../../shared/api.ts';
import { effectiveFlag } from '../../shared/domain/flags.ts';
import { shipTypeLabel } from '../../shared/domain/shiptype.ts';
import type { Flag } from '../../shared/domain/types.ts';
import { addDays, todayOslo } from '../../shared/time.ts';
import { fetchAllLatest, matchVessels, type AisVesselInfo } from '../ais/barentswatch.ts';
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

app.get('/', query(z.object({ q: z.string().trim().min(1).max(80) })), async c => {
  const { q } = c.req.valid('query');
  const db = c.env.DB;
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const today = todayOslo();

  const [boats, callIds, trucks, bulk, users, mmsiRows] = await db.batch([
    db.prepare(`SELECT id, name, mmsi, flag_auto, flag_override FROM boats
                WHERE active = 1 AND (name LIKE ?1 OR mmsi LIKE ?1 OR callsign LIKE ?1 OR imo LIKE ?1) ORDER BY name LIMIT ${LIMIT}`).bind(like),
    db.prepare(`SELECT pc.id FROM port_calls pc JOIN boats b ON b.id = pc.boat_id
                WHERE pc.source = 'app' AND pc.cancelled_at IS NULL AND pc.service_date BETWEEN ? AND ? AND b.name LIKE ?
                ORDER BY pc.service_date >= ? DESC, abs(julianday(pc.service_date) - julianday(?)) LIMIT ${LIMIT}`)
      .bind(addDays(today, -14), addDays(today, 60), like, today, today),
    db.prepare(`SELECT id, customer, expected_date, reg_no, picked_up_at FROM truck_orders
                WHERE cancelled_at IS NULL AND (customer LIKE ?1 OR carrier LIKE ?1 OR reg_no LIKE ?1 OR reference LIKE ?1)
                ORDER BY picked_up_at IS NOT NULL, expected_date DESC LIMIT ${LIMIT}`).bind(like),
    db.prepare(`SELECT id, truck, destination, status FROM bulk_orders WHERE truck LIKE ?1 OR destination LIKE ?1
                ORDER BY created_at DESC LIMIT ${LIMIT}`).bind(like),
    db.prepare(`SELECT id, name, title, phone FROM users WHERE active = 1 AND (name LIKE ?1 OR short_name LIKE ?1 OR title LIKE ?1)
                ORDER BY name LIMIT ${LIMIT}`).bind(like),
    db.prepare(`SELECT id, mmsi FROM boats WHERE mmsi IS NOT NULL`),
  ]);

  const settings = await loadSettings(db);
  const ids = (callIds.results as { id: string }[]).map(r => r.id);
  const calls = ids.length ? await loadCalls(db, { ids }, settings) : [];
  const order = new Map(ids.map((id, i) => [id, i]));
  calls.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  // AIS: bare når søket ligner et navn eller nummer, og nøklene finnes.
  let vessels: ExternalVessel[] = [];
  let aisError: string | null = null;
  if (q.length >= 3) {
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
    boats: (boats.results as BoatRow[]).map(b => ({ id: b.id, name: b.name, mmsi: b.mmsi, flag: effectiveFlag(b) })),
    calls: calls.map(x => ({ id: x.id, boat_name: x.boat.name, service_date: x.service_date, eta: x.eta, time_known: x.time_known, type: x.type, status: x.status })),
    trucks: (trucks.results as { id: string; customer: string; expected_date: string; reg_no: string | null; picked_up_at: string | null }[])
      .map(t => ({ id: t.id, customer: t.customer, expected_date: t.expected_date, reg_no: t.reg_no, picked_up: !!t.picked_up_at })),
    bulk: bulk.results as SearchResult['bulk'],
    users: users.results as SearchResult['users'],
    vessels,
    ais_error: aisError,
  } satisfies SearchResult);
});

export default app;
