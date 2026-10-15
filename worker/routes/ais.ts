import { Hono } from 'hono';
import type { AisTrack, AisView } from '../../shared/api.ts';
import { thin, TRAIL_MIN } from '../../shared/domain/ais.ts';
import { effectiveFlag } from '../../shared/domain/flags.ts';
import type { Flag } from '../../shared/domain/types.ts';
import { loadArea } from '../ais/area.ts';
import { fetchTrack24h } from '../ais/barentswatch.ts';
import { loadAisStatus, runAisSync } from '../ais/sync.ts';
import { CAN, requireRole } from '../auth/access.ts';
import type { AppEnv } from '../types.ts';

const app = new Hono<AppEnv>();

/** Siste posisjon for båtene i kaiboka med spor de siste minuttene, og alle fartøy i området rundt kaia. */
app.get('/', async c => {
  const db = c.env.DB;
  const since = new Date(Date.now() - TRAIL_MIN * 60_000).toISOString();
  const [positions, tracks] = await db.batch([
    db.prepare(`SELECT a.mmsi, a.boat_id, b.name, b.flag_auto, b.flag_override, a.lat, a.lon, a.sog, a.cog, a.heading,
                       a.ais_ts, a.fetched_at, a.in_geofence
                FROM ais_positions a JOIN boats b ON b.id = a.boat_id WHERE b.active = 1`),
    db.prepare(`SELECT mmsi, lat, lon FROM ais_track WHERE ts >= ? ORDER BY mmsi, ts`).bind(since),
  ]);
  const byMmsi = Map.groupBy(tracks.results as { mmsi: string; lat: number; lon: number }[], t => t.mmsi);
  type Row = { mmsi: string; boat_id: string; name: string; flag_auto: Flag; flag_override: Flag | null; lat: number; lon: number; sog: number | null; cog: number | null; heading: number | null; ais_ts: string; fetched_at: string; in_geofence: number };
  const vessels = (positions.results as Row[]).map(r => ({
    mmsi: r.mmsi, boat_id: r.boat_id, name: r.name, flag: effectiveFlag(r), lat: r.lat, lon: r.lon, sog: r.sog, cog: r.cog,
    heading: r.heading, ais_ts: r.ais_ts, fetched_at: r.fetched_at, in_geofence: !!r.in_geofence,
    track: (byMmsi.get(r.mmsi) ?? []).map(t => [t.lon, t.lat] as [number, number]),
  }));
  return c.json({ status: await loadAisStatus(db), vessels, area: await loadArea(db) } satisfies AisView);
});

// Spor siste 24 timer hentes fra BarentsWatch når et fartøy velges, og holdes litt i minnet.
const tracks = new Map<string, { at: number; body: AisTrack }>();

app.get('/track/:mmsi{[0-9]{9}}', async c => {
  const mmsi = c.req.param('mmsi');
  const hit = tracks.get(mmsi);
  if (hit && Date.now() - hit.at < 2 * 60_000) return c.json(hit.body);
  if (!c.env.BW_CLIENT_ID || !c.env.BW_CLIENT_SECRET) return c.json({ mmsi, points: [], error: 'AIS er ikke satt opp.' } satisfies AisTrack);
  try {
    const raw = await fetchTrack24h({ clientId: c.env.BW_CLIENT_ID, clientSecret: c.env.BW_CLIENT_SECRET }, Number(mmsi));
    const pts = raw.filter(p => typeof p.latitude === 'number' && typeof p.longitude === 'number')
      .sort((a, b) => a.msgtime.localeCompare(b.msgtime))
      .map(p => [p.longitude, p.latitude] as [number, number]);
    const body: AisTrack = { mmsi, points: thin(pts, 1500), error: null };
    if (tracks.size > 200) tracks.clear();
    tracks.set(mmsi, { at: Date.now(), body });
    return c.json(body);
  } catch (e) {
    return c.json({ mmsi, points: [], error: e instanceof Error ? e.message : 'Fant ikke sporet.' } satisfies AisTrack);
  }
});

/**
 * Kjør AIS-synk nå (admin). Viser om Workeren ser nøklene – bare ja/nei, aldri verdiene –
 * og hva BarentsWatch svarte. Brukes til feilsøking fra kartet.
 */
app.post('/sync', requireRole(...CAN.admin), async c => {
  const result = await runAisSync(c.env);
  const mmsi = await c.env.DB.prepare('SELECT count(*) AS n FROM boats WHERE active = 1 AND mmsi IS NOT NULL').first<{ n: number }>();
  return c.json({
    result,
    secrets: { BW_CLIENT_ID: !!c.env.BW_CLIENT_ID, BW_CLIENT_SECRET: !!c.env.BW_CLIENT_SECRET },
    // Klient-ID er «e-post:klientnavn». Klientnavnet (ikke hemmelig) viser hvilken klient som er lagt inn.
    client_name: c.env.BW_CLIENT_ID?.trim().includes(':') ? c.env.BW_CLIENT_ID.trim().split(':').pop() : null,
    boats_with_mmsi: mmsi?.n ?? 0,
  });
});

export default app;
