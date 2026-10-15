import { mergeArea } from '../../shared/domain/ais.ts';
import type { AreaVessel } from '../../shared/api.ts';
import { loadSettings } from '../lib/settings.ts';
import { fetchArea, type Fetcher } from './barentswatch.ts';

// Trafikkbildet rundt kaia: alle fartøy i et rektangel rundt geofencen, hentet hvert minutt
// sammen med AIS-synken. Sporene bygges opp her (BarentsWatch gir bare siste posisjon) og
// lagres som én rad, så kartet kan tegne stiplede spor for de siste minuttene.

/** Halv bredde/høyde på området (grader). Ca. 60 × 60 km rundt Ålesund. */
const HALF_LAT = 0.28;
const HALF_LON = 0.6;

export function areaBox(c: { lat: number; lon: number }): [number, number, number, number] {
  return [c.lon - HALF_LON, c.lat - HALF_LAT, c.lon + HALF_LON, c.lat + HALF_LAT];
}

export async function loadArea(db: D1Database): Promise<AreaVessel[]> {
  const row = await db.prepare('SELECT data FROM ais_area WHERE id = 1').first<{ data: string }>();
  return row ? (JSON.parse(row.data) as AreaVessel[]) : [];
}

/** Henter området, slår sammen med forrige bilde og lagrer. Returnerer antall fartøy. */
export async function syncArea(env: Env, now = new Date(), fetcher: Fetcher = fetch): Promise<number> {
  if (!env.BW_CLIENT_ID || !env.BW_CLIENT_SECRET) return 0;
  const db = env.DB;
  const { geofence } = await loadSettings(db);
  const fresh = await fetchArea({ clientId: env.BW_CLIENT_ID, clientSecret: env.BW_CLIENT_SECRET }, areaBox(geofence),
    new Date(now.getTime() - 60 * 60_000), fetcher);
  const merged = mergeArea(await loadArea(db), fresh, now);
  await db.prepare(`INSERT INTO ais_area (id, data, updated_at) VALUES (1, ?, ?)
                    ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
    .bind(JSON.stringify(merged), now.toISOString()).run();
  return merged.length;
}
