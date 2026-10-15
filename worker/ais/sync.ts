import type { FlowEvent } from '../../shared/events.ts';
import { insideGeofence } from '../../shared/domain/geo.ts';
import { ROOM } from '../lib/realtime.ts';
import { loadSettings } from '../lib/settings.ts';
import { fetchLatest, type Fetcher } from './barentswatch.ts';

// Kjøres av Cron Trigger hvert minutt. Henter siste posisjon for båtene i kaiboka (de med MMSI),
// lagrer posisjon og spor, og setter ankomst/avgang på anløpet når båten går inn/ut av geofencen.

/** Under denne farten (knop) regnes en båt i geofencen som fortøyd. */
const MOORED_KNOTS = 3;
const TRACK_HOURS = 6;

export interface AisStatus {
  checked_at: string;
  ok: boolean;
  configured: boolean;
  message: string | null;
  boats: number;
  positions: number;
}

export interface SyncResult extends AisStatus {
  arrived: string[];
  departed: string[];
}

async function saveStatus(db: D1Database, s: AisStatus) {
  await db.prepare(`INSERT INTO settings (key, value) VALUES ('ais_status', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
    .bind(JSON.stringify(s)).run();
}

export async function loadAisStatus(db: D1Database): Promise<AisStatus | null> {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'ais_status'`).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as AisStatus) : null;
}

export async function syncAis(env: Env, now = new Date(), fetcher: Fetcher = fetch): Promise<SyncResult> {
  const db = env.DB;
  const base = { checked_at: now.toISOString(), boats: 0, positions: 0, arrived: [] as string[], departed: [] as string[] };

  if (!env.BW_CLIENT_ID || !env.BW_CLIENT_SECRET) {
    const s = { ...base, ok: false, configured: false, message: `BarentsWatch-nøkler mangler: ${[!env.BW_CLIENT_ID && 'BW_CLIENT_ID', !env.BW_CLIENT_SECRET && 'BW_CLIENT_SECRET'].filter(Boolean).join(' og ')}. Legg dem inn som Secret under Settings → Variables and Secrets (ikke under Build).` };
    await saveStatus(db, s);
    return s;
  }

  const { results: boats } = await db
    .prepare(`SELECT id, mmsi FROM boats WHERE active = 1 AND mmsi IS NOT NULL`)
    .all<{ id: string; mmsi: string }>();
  if (!boats.length) {
    const s = { ...base, ok: true, configured: true, message: 'Ingen båter i kaiboka har MMSI ennå.' };
    await saveStatus(db, s);
    return s;
  }

  let positions;
  try {
    const mmsi = boats.map(b => Number(b.mmsi)).filter(n => Number.isFinite(n) && n > 0);
    if (!mmsi.length) {
      const s = { ...base, boats: boats.length, ok: false, configured: true, message: 'Ingen gyldige MMSI blant båtene i kaiboka.' };
      await saveStatus(db, s);
      return s;
    }
    positions = await fetchLatest({ clientId: env.BW_CLIENT_ID, clientSecret: env.BW_CLIENT_SECRET }, mmsi, fetcher);
  } catch (e) {
    const s = { ...base, boats: boats.length, ok: false, configured: true, message: e instanceof Error ? e.message : 'Ukjent feil mot BarentsWatch.' };
    await saveStatus(db, s);
    console.error('AIS-synk feilet', e);
    return s;
  }

  const settings = await loadSettings(db);
  const fence = settings.geofence;
  const boatByMmsi = new Map(boats.map(b => [String(b.mmsi), b.id]));
  const fetchedAt = now.toISOString();

  // Anløp som kan påvirkes: ikke avlyst, ETA fra 24 t siden til 12 t frem.
  // Uten kjent klokkeslett regnes midt på dagen som ETA ved matching.
  const { results: calls } = await db
    .prepare(`SELECT id, boat_id, CASE WHEN time_known = 1 THEN eta ELSE strftime('%Y-%m-%dT%H:%M:%fZ', eta, '+12 hours') END AS eta, arrived_at, departed_at FROM port_calls
              WHERE source = 'app' AND cancelled_at IS NULL AND eta BETWEEN ? AND ?
                AND boat_id IN (SELECT value FROM json_each(?))`)
    .bind(new Date(now.getTime() - 24 * 3_600_000).toISOString(), new Date(now.getTime() + 12 * 3_600_000).toISOString(), JSON.stringify(boats.map(b => b.id)))
    .all<{ id: string; boat_id: string; eta: string; arrived_at: string | null; departed_at: string | null }>();

  const stmts: D1PreparedStatement[] = [];
  const arrived: string[] = [];
  const departed: string[] = [];

  for (const p of positions) {
    const boatId = boatByMmsi.get(String(p.mmsi));
    if (!boatId || typeof p.latitude !== 'number' || typeof p.longitude !== 'number') continue;
    const inside = insideGeofence({ lat: p.latitude, lon: p.longitude }, fence);
    const ts = new Date(p.msgtime).toISOString();
    stmts.push(
      db.prepare(`INSERT INTO ais_positions (mmsi, boat_id, lat, lon, sog, cog, heading, nav_status, ais_ts, fetched_at, in_geofence)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT (mmsi) DO UPDATE SET boat_id = excluded.boat_id, lat = excluded.lat, lon = excluded.lon, sog = excluded.sog,
                    cog = excluded.cog, heading = excluded.heading, nav_status = excluded.nav_status, ais_ts = excluded.ais_ts,
                    fetched_at = excluded.fetched_at, in_geofence = excluded.in_geofence`)
        .bind(String(p.mmsi), boatId, p.latitude, p.longitude, p.speedOverGround ?? null, p.courseOverGround ?? null,
          p.trueHeading != null && p.trueHeading < 360 ? p.trueHeading : null, p.navigationalStatus ?? null, ts, fetchedAt, inside ? 1 : 0),
      db.prepare(`INSERT OR IGNORE INTO ais_track (mmsi, ts, lat, lon, sog) VALUES (?, ?, ?, ?, ?)`)
        .bind(String(p.mmsi), ts, p.latitude, p.longitude, p.speedOverGround ?? null),
    );

    const mine = calls.filter(c => c.boat_id === boatId);
    if (inside && (p.speedOverGround ?? 0) < MOORED_KNOTS) {
      // Ankomst: anløpet uten ankomst som har ETA nærmest nå.
      const open = mine.filter(c => !c.arrived_at)
        .sort((a, b) => Math.abs(Date.parse(a.eta) - now.getTime()) - Math.abs(Date.parse(b.eta) - now.getTime()))[0];
      const alreadyAt = mine.some(c => c.arrived_at && !c.departed_at);
      if (open && !alreadyAt && Math.abs(Date.parse(open.eta) - now.getTime()) <= 12 * 3_600_000) {
        stmts.push(db.prepare(`UPDATE port_calls SET arrived_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND arrived_at IS NULL`).bind(ts, fetchedAt, open.id));
        arrived.push(open.id);
      }
    } else if (!inside) {
      // Avgang: båten har forlatt geofencen etter å ha ligget ved kai.
      for (const c of mine.filter(x => x.arrived_at && !x.departed_at)) {
        stmts.push(db.prepare(`UPDATE port_calls SET departed_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND departed_at IS NULL`).bind(ts, fetchedAt, c.id));
        departed.push(c.id);
      }
    }
  }
  stmts.push(db.prepare(`DELETE FROM ais_track WHERE ts < ?`).bind(new Date(now.getTime() - TRACK_HOURS * 3_600_000).toISOString()));
  await db.batch(stmts);

  const s = { ...base, boats: boats.length, positions: positions.length, ok: true, configured: true, message: null };
  await saveStatus(db, s);
  return { ...s, arrived, departed };
}

/** Synk + kringkasting til åpne klienter. Brukes av cron. */
export async function runAisSync(env: Env) {
  const r = await syncAis(env);
  const events: FlowEvent[] = [
    { type: 'ais.updated' },
    ...[...r.arrived, ...r.departed].map(id => ({ type: 'port_call.changed' as const, id })),
  ];
  if (r.ok && r.positions) await env.QUAY_ROOM.getByName(ROOM).broadcast(events);
  return r;
}
