// Trafikkbildet rundt kaia: fartøy fra AIS med kort spor, fremskrevet kurs og fargekategori.

import type { AreaVessel } from '../api.ts';

/** Spor som vises for alle fartøy (minutter bakover). */
export const TRAIL_MIN = 12;
/** Fartøy som ikke har meldt seg på så lenge, tas ut av kartet. */
export const STALE_MIN = 60;
/** Under denne farten (knop) regnes fartøyet som stillestående: ingen fremskrevet linje eller ringer. */
export const MOVING_KNOTS = 0.5;
/** Ringer rundt valgt fartøy: hvor langt det kommer med farten det holder nå. */
export const RANGE_MINUTES = [6, 12, 24, 36, 48, 60, 180];

export type ShipCategory = 'fiske' | 'last' | 'tank' | 'passasjer' | 'hurtig' | 'slep' | 'spesial' | 'fritid' | 'annet';

/** AIS skipstype (0–99) til fargekategori på kartet. */
export function shipCategory(code: number | null | undefined): ShipCategory {
  if (code == null) return 'annet';
  if (code === 30) return 'fiske';
  if (code >= 70 && code < 80) return 'last';
  if (code >= 80 && code < 90) return 'tank';
  if (code >= 60 && code < 70) return 'passasjer';
  if (code >= 40 && code < 50) return 'hurtig';
  if (code === 31 || code === 32 || code === 52) return 'slep';
  if (code === 50 || code === 51 || code === 53 || code === 55 || code === 33 || code === 34 || code === 35) return 'spesial';
  if (code === 36 || code === 37) return 'fritid';
  return 'annet';
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Punktet man kommer til fra (lat, lon) etter `meters` i retning `bearing` (grader). */
export function destination(lat: number, lon: number, bearing: number, meters: number): [number, number] {
  const d = meters / R;
  const b = rad(bearing);
  const p1 = rad(lat);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = rad(lon) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [deg(l2), deg(p2)];
}

/** Distanse i meter etter `minutes` minutter i `knots` knop. */
export const metersAfter = (knots: number, minutes: number) => (knots * 1852 * minutes) / 60;

/** Retningen fartøyet beveger seg: kurs over grunn, ellers baugretning. */
export const moveBearing = (v: { cog: number | null; heading: number | null }) => v.cog ?? v.heading;

/** Fra BarentsWatch «latest/combined» (modelType Full). Feltene kan mangle. */
export interface AreaInput {
  mmsi: number;
  name?: string | null;
  callSign?: string | null;
  imoNumber?: number | null;
  shipType?: number | null;
  shipLength?: number | null;
  shipWidth?: number | null;
  draught?: number | null;
  destination?: string | null;
  countryCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  speedOverGround?: number | null;
  courseOverGround?: number | null;
  trueHeading?: number | null;
  navigationalStatus?: number | null;
  msgtime?: string | null;
}

const pos = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null);

/**
 * Slår sammen forrige bilde med ferske posisjoner: nytt punkt i sporet når meldingen er ny,
 * spor eldre enn TRAIL_MIN kuttes, og fartøy som ikke er hørt på STALE_MIN fjernes.
 */
export function mergeArea(prev: AreaVessel[], fresh: AreaInput[], now: Date): AreaVessel[] {
  const t = now.getTime();
  const byMmsi = new Map(prev.map(v => [v.mmsi, v]));
  for (const f of fresh) {
    if (typeof f.latitude !== 'number' || typeof f.longitude !== 'number' || !f.msgtime) continue;
    const mmsi = String(f.mmsi);
    const old = byMmsi.get(mmsi);
    const ts = Date.parse(f.msgtime);
    if (!Number.isFinite(ts) || (old && ts <= Date.parse(old.ts))) continue;
    const trail = [...(old?.trail ?? []), [f.longitude, f.latitude, Math.round(ts / 1000)] as [number, number, number]];
    byMmsi.set(mmsi, {
      mmsi,
      name: f.name?.trim() || old?.name || null,
      callsign: f.callSign?.trim() || old?.callsign || null,
      imo: f.imoNumber ? String(f.imoNumber) : old?.imo ?? null,
      ship_type: f.shipType ?? old?.ship_type ?? null,
      length: pos(f.shipLength) ?? old?.length ?? null,
      width: pos(f.shipWidth) ?? old?.width ?? null,
      draught: pos(f.draught) ?? old?.draught ?? null,
      destination: f.destination?.trim() || old?.destination || null,
      country: f.countryCode ?? old?.country ?? null,
      lat: f.latitude,
      lon: f.longitude,
      sog: typeof f.speedOverGround === 'number' && f.speedOverGround < 102.3 ? f.speedOverGround : null,
      cog: typeof f.courseOverGround === 'number' && f.courseOverGround < 360 ? f.courseOverGround : null,
      heading: typeof f.trueHeading === 'number' && f.trueHeading < 360 ? f.trueHeading : null,
      nav_status: f.navigationalStatus ?? null,
      ts: new Date(ts).toISOString(),
      trail,
    });
  }
  const trailFrom = (t - (TRAIL_MIN + 1) * 60_000) / 1000;
  const out: AreaVessel[] = [];
  for (const v of byMmsi.values()) {
    if (t - Date.parse(v.ts) > STALE_MIN * 60_000) continue;
    out.push({ ...v, trail: v.trail.filter(p => p[2] >= trailFrom) });
  }
  return out;
}

/** Tynner ut et langt spor til maks `max` punkter (første og siste beholdes). */
export function thin<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}
