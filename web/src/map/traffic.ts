import type { FeatureCollection, LineString, Point } from 'geojson';
import type { AisVessel, AreaVessel } from '../../../shared/api.ts';
import { MOVING_KNOTS, RANGE_MINUTES, destination, metersAfter, moveBearing, shipCategory, type ShipCategory } from '../../../shared/domain/ais.ts';
import { distanceM } from '../../../shared/domain/geo.ts';
import { fr } from '../lib/format.ts';
import { tr } from '../lib/i18n.ts';

// Trafikkbildet som GeoJSON for MapLibre: skip farget etter type, stiplet spor de siste 12 minuttene,
// hvit linje for hvor de er om 6 minutter, og for valgt fartøy ringer for 6 min–3 t og spor siste døgn.

/** Farger som i Kystverkets kart. «flow» er båter i vårt båtregister. */
export type MapCategory = ShipCategory | 'flow' | 'gra';
export const CATEGORY_COLOR: Record<MapCategory, string> = {
  fiske: '#F5A623', last: '#6BBF59', tank: '#E5484D', passasjer: '#4A90E2', hurtig: '#F2D24B',
  slep: '#40C4C4', spesial: '#F2D24B', fritid: '#C77DD8', annet: '#9AA3A0', flow: '#80EFDE', gra: '#7D858A',
};
export const CATEGORY_LABEL: Record<MapCategory, string> = {
  flow: 'Våre båter', fiske: 'Fiske', last: 'Last', tank: 'Tank', passasjer: 'Passasjer', hurtig: 'Hurtigbåt',
  slep: 'Slep', spesial: 'Los/redning', fritid: 'Fritid', annet: 'Annet', gra: 'Andre båter',
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

/** Typene i fargeforklaringen, som også kan skrus av og på. Hurtigbåt følger Los/redning (samme farge). */
export const LEGEND_TYPES = ['flow', 'fiske', 'last', 'tank', 'passasjer', 'slep', 'spesial', 'fritid', 'annet'] as const;
export type LegendType = (typeof LEGEND_TYPES)[number];
export const legendType = (cat: TrafficVessel['cat']): LegendType => (cat === 'hurtig' ? 'spesial' : cat);

/**
 * Valg for hvor langt ut fra kaia andre båter vises (km). 0 = hele kysten (hele Kystverkets AIS-dekning).
 * 75 km er hele området som hentes hvert minutt (ca. 150 × 150 km).
 */
export const RANGE_STEPS = [5, 10, 20, 30, 50, 75, 0] as const;
export type RangeKm = (typeof RANGE_STEPS)[number];

/**
 * Slår sammen områdelisten og båtene i registeret (som kan være utenfor området).
 * `coast`: fartøy langs hele kysten (uten spor), for dem som ikke er i områdelisten.
 */
export function trafficVessels(area: AreaVessel[], fleet: AisVessel[], coast: AreaVessel[] = []): TrafficVessel[] {
  const fleetBy = new Map(fleet.map(v => [v.mmsi, v]));
  const out: TrafficVessel[] = area.map(a => {
    const f = fleetBy.get(a.mmsi);
    return {
      mmsi: a.mmsi, name: f?.name ?? a.name, lat: a.lat, lon: a.lon, sog: a.sog, cog: a.cog, heading: a.heading, ts: a.ts,
      cat: f ? 'flow' : shipCategory(a.ship_type), trail: a.trail.map(p => [p[0], p[1]]), info: a, boatId: f?.boat_id ?? null,
    };
  });
  const inArea = new Set(area.map(a => a.mmsi));
  const fleetIds = new Set(fleet.map(f => f.mmsi));
  for (const a of coast) {
    if (inArea.has(a.mmsi) || fleetIds.has(a.mmsi)) continue;
    inArea.add(a.mmsi);
    out.push({ mmsi: a.mmsi, name: a.name, lat: a.lat, lon: a.lon, sog: a.sog, cog: a.cog, heading: a.heading, ts: a.ts, cat: shipCategory(a.ship_type), trail: [], info: a, boatId: null });
  }
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
  route: Fc<LineString>;
  /** Grensen for området når det er begrenset med slideren. */
  zone: Fc<LineString>;
}

export interface TrafficOptions {
  /** MMSI → anløp hos oss (i dag/i morgen). Klikk på disse åpner anløpet. */
  hot: Map<string, string>;
  selected: string | null;
  track24: [number, number][] | null;
  /** Seilingsruten fra valgt fartøy til kaia. */
  route: [number, number][] | null;
  zoomNames: boolean;
  /** Vis fartøy som ikke er i båtregisteret. */
  showOthers: boolean;
  /** Farg andre fartøy etter type; ellers grå. */
  colorOthers: boolean;
  /** Typer som er skrudd av i fargeforklaringen. */
  hidden: ReadonlySet<LegendType>;
  /** Andre båter vises bare innenfor så mange km fra kaia (null = ingen grense). */
  radiusKm: number | null;
  quay: { lat: number; lon: number };
}

export function trafficLayers(vessels: TrafficVessel[], o: TrafficOptions): TrafficLayers {
  const fc = <G extends Point | LineString>(): Fc<G> => ({ type: 'FeatureCollection', features: [] });
  const ships = fc<Point>(), trails = fc<LineString>(), predict = fc<LineString>(), rings = fc<LineString>(), track = fc<LineString>(), route = fc<LineString>(), zone = fc<LineString>();
  const maxM = o.radiusKm != null ? o.radiusKm * 1000 : null;

  for (const v of vessels) {
    const ours = v.cat === 'flow';
    const sel = v.mmsi === o.selected;
    if (!sel) {
      if (!ours && !o.showOthers) continue;
      if (o.hidden.has(legendType(v.cat))) continue;
      if (!ours && maxM != null && distanceM(v, o.quay) > maxM) continue;
    }
    const cat: MapCategory = ours || o.colorOthers ? v.cat : 'gra';
    const bearing = moveBearing(v);
    const go = moving(v) && bearing != null;
    ships.features.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
      properties: {
        mmsi: v.mmsi, call: o.hot.get(v.mmsi) ?? '', icon: `${v.heading != null || go ? 'ship' : 'dot'}-${cat}`, rot: v.heading ?? bearing ?? 0,
        label: ours || o.zoomNames || sel ? (v.name ?? '') : '', bold: ours || sel, sel, ours,
      },
    });
    if (v.trail.length > 1) {
      trails.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [...v.trail, [v.lon, v.lat]] }, properties: { color: CATEGORY_COLOR[cat] } });
    }
    if (go) {
      predict.features.push({
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: [[v.lon, v.lat], destination(v.lat, v.lon, bearing, metersAfter(v.sog!, 6))] },
      });
    }
    if (sel && moving(v)) {
      for (const min of RANGE_MINUTES) {
        const r = metersAfter(v.sog!, min);
        const coords: [number, number][] = [];
        for (let i = 0; i <= 96; i++) coords.push(destination(v.lat, v.lon, (i / 96) * 360, r));
        const when = min < 60 ? `${min} min` : tr('{n} t', { n: min / 60 });
        rings.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { label: tr('Etter {tid}: {nm} nm', { tid: when, nm: fr(r / 1852) }) } });
      }
    }
  }
  if (o.track24 && o.track24.length > 1) track.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: o.track24 }, properties: {} });
  if (o.route && o.route.length > 1) route.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: o.route }, properties: {} });
  if (maxM != null && o.showOthers) {
    const coords: [number, number][] = [];
    for (let i = 0; i <= 128; i++) coords.push(destination(o.quay.lat, o.quay.lon, (i / 128) * 360, maxM));
    zone.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { label: `${o.radiusKm} km` } });
  }
  return { ships, trails, predict, rings, track, route, zone };
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
  if (s < 90) return tr('{n} sek siden', { n: s });
  if (s < 90 * 60) return tr('{n} min siden', { n: Math.round(s / 60) });
  return tr('{n} t siden', { n: Math.round(s / 3600) });
}
