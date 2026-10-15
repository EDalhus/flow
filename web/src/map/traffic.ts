import type { FeatureCollection, LineString, Point } from 'geojson';
import type { AisVessel, AreaVessel } from '../../../shared/api.ts';
import { MOVING_KNOTS, RANGE_MINUTES, destination, metersAfter, moveBearing, shipCategory, type ShipCategory } from '../../../shared/domain/ais.ts';
import { fr } from '../lib/format.ts';

// Trafikkbildet som GeoJSON for MapLibre: skip farget etter type, stiplet spor de siste 12 minuttene,
// hvit linje for hvor de er om 6 minutter, og for valgt fartøy ringer for 6 min–3 t og spor siste døgn.

/** Farger som i Kystverkets kart. «flow» er båter i vårt båtregister. */
export const CATEGORY_COLOR: Record<ShipCategory | 'flow', string> = {
  fiske: '#F5A623', last: '#6BBF59', tank: '#E5484D', passasjer: '#4A90E2', hurtig: '#F2D24B',
  slep: '#40C4C4', spesial: '#F2D24B', fritid: '#C77DD8', annet: '#9AA3A0', flow: '#80EFDE',
};
export const CATEGORY_LABEL: Record<ShipCategory | 'flow', string> = {
  flow: 'Våre båter', fiske: 'Fiske', last: 'Last', tank: 'Tank', passasjer: 'Passasjer', hurtig: 'Hurtigbåt',
  slep: 'Slep', spesial: 'Los/redning', fritid: 'Fritid', annet: 'Annet',
};

/** Ett fartøy slik kartet trenger det, fra områdelisten eller fra båtregisteret. */
export interface TrafficVessel {
  mmsi: string;
  name: string | null;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  ts: string;
  cat: ShipCategory | 'flow';
  trail: [number, number][];
  info: AreaVessel | null;
  boatId: string | null;
}

/** Slår sammen områdelisten og båtene i registeret (som kan være utenfor området). */
export function trafficVessels(area: AreaVessel[], fleet: AisVessel[]): TrafficVessel[] {
  const fleetBy = new Map(fleet.map(v => [v.mmsi, v]));
  const out: TrafficVessel[] = area.map(a => {
    const f = fleetBy.get(a.mmsi);
    return {
      mmsi: a.mmsi, name: f?.name ?? a.name, lat: a.lat, lon: a.lon, sog: a.sog, cog: a.cog, heading: a.heading, ts: a.ts,
      cat: f ? 'flow' : shipCategory(a.ship_type), trail: a.trail.map(p => [p[0], p[1]]), info: a, boatId: f?.boat_id ?? null,
    };
  });
  const inArea = new Set(area.map(a => a.mmsi));
  for (const f of fleet) {
    if (inArea.has(f.mmsi)) continue;
    out.push({ mmsi: f.mmsi, name: f.name, lat: f.lat, lon: f.lon, sog: f.sog, cog: f.cog, heading: f.heading, ts: f.ais_ts, cat: 'flow', trail: f.track, info: null, boatId: f.boat_id });
  }
  return out;
}

const moving = (v: { sog: number | null }) => (v.sog ?? 0) >= MOVING_KNOTS;

type Fc<G extends Point | LineString> = FeatureCollection<G, Record<string, string | number | boolean>>;

export interface TrafficLayers {
  ships: Fc<Point>;
  trails: Fc<LineString>;
  predict: Fc<LineString>;
  rings: Fc<LineString>;
  track: Fc<LineString>;
}

/** `hidden`: fartøy som tegnes som egne knapper (anløp hos oss) og ikke skal ha skipssymbol her. */
export function trafficLayers(vessels: TrafficVessel[], hidden: Set<string>, selected: string | null, track24: [number, number][] | null, zoomNames: boolean): TrafficLayers {
  const ships: Fc<Point> = { type: 'FeatureCollection', features: [] };
  const trails: Fc<LineString> = { type: 'FeatureCollection', features: [] };
  const predict: Fc<LineString> = { type: 'FeatureCollection', features: [] };
  const rings: Fc<LineString> = { type: 'FeatureCollection', features: [] };
  const track: Fc<LineString> = { type: 'FeatureCollection', features: [] };

  for (const v of vessels) {
    const bearing = moveBearing(v);
    const go = moving(v) && bearing != null;
    if (!hidden.has(v.mmsi)) {
      ships.features.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
        properties: {
          mmsi: v.mmsi, icon: `${v.heading != null || go ? 'ship' : 'dot'}-${v.cat}`, rot: v.heading ?? bearing ?? 0,
          label: v.cat === 'flow' || zoomNames || v.mmsi === selected ? v.name ?? '' : '', sel: v.mmsi === selected, flow: v.cat === 'flow',
        },
      });
    }
    if (v.trail.length > 1) {
      trails.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [...v.trail, [v.lon, v.lat]] }, properties: { color: CATEGORY_COLOR[v.cat] } });
    }
    if (go) {
      predict.features.push({
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: [[v.lon, v.lat], destination(v.lat, v.lon, bearing, metersAfter(v.sog!, 6))] },
      });
    }
    if (v.mmsi === selected && moving(v)) {
      for (const min of RANGE_MINUTES) {
        const r = metersAfter(v.sog!, min);
        const coords: [number, number][] = [];
        for (let i = 0; i <= 96; i++) coords.push(destination(v.lat, v.lon, (i / 96) * 360, r));
        const when = min < 60 ? `${min} min` : `${min / 60} t`;
        rings.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { label: `Etter ${when}: ${fr(r / 1852)} nm` } });
      }
    }
  }
  if (track24 && track24.length > 1) track.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: track24 }, properties: {} });
  return { ships, trails, predict, rings, track };
}

// ---------------------------------------------------------------- symboler

/** Skrog (spiss baug) og prikk for fartøy uten retning, tegnet én gang per farge. */
export function shipImages(): { id: string; data: ImageData }[] {
  const out: { id: string; data: ImageData }[] = [];
  for (const [cat, color] of Object.entries(CATEGORY_COLOR)) {
    out.push({ id: `ship-${cat}`, data: draw(28, 52, ctx => {
      ctx.beginPath();
      ctx.moveTo(14, 3); ctx.lineTo(24, 18); ctx.lineTo(24, 47); ctx.lineTo(4, 47); ctx.lineTo(4, 18); ctx.closePath();
      paint(ctx, color);
      // Lys «bro» akterut, som i Kystverkets symboler.
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.fillRect(9, 36, 10, 6);
    }) });
    out.push({ id: `dot-${cat}`, data: draw(28, 28, ctx => {
      ctx.beginPath();
      ctx.arc(14, 14, 8, 0, Math.PI * 2);
      paint(ctx, color);
    }) });
  }
  return out;
}

function paint(ctx: CanvasRenderingContext2D, color: string) {
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(10,14,20,.85)';
  ctx.stroke();
}

function draw(w: number, h: number, fn: (ctx: CanvasRenderingContext2D) => void): ImageData {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.lineJoin = 'round';
  fn(ctx);
  return ctx.getImageData(0, 0, w, h);
}

// ---------------------------------------------------------------- tekst

/** 62.4951 → «62° 29,706′ N». */
export function degMin(v: number, pos: string, neg: string) {
  const a = Math.abs(v);
  const d = Math.floor(a);
  return `${d}° ${((a - d) * 60).toFixed(3).replace('.', ',')}′ ${v >= 0 ? pos : neg}`;
}

/** «12 sek siden», «4 min siden», «2 t siden». */
export function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 90) return `${s} sek siden`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min siden`;
  return `${Math.round(s / 3600)} t siden`;
}
