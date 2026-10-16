import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { distanceM } from '../../../shared/domain/geo.ts';
import { findPath, largestComponent, smoothPath, snapToWater, type Cell } from '../../../shared/domain/searoute.ts';

// Seilingsrute til kaia: vannflatene fra de samme vektorflisene som kartet bruker (OpenFreeMap)
// tegnes inn i et rutenett, og korteste vei over vann finnes med A*. Gir distanse og linje til kartet.

const TILEJSON = 'https://tiles.openfreemap.org/planet';
let template: Promise<string> | null = null;
const tileUrl = () => (template ??= fetch(TILEJSON).then(r => r.json()).then((j: { tiles: string[] }) => j.tiles[0]));

const MAX_CELLS = 1400;
const mercX = (lon: number) => (lon + 180) / 360;
const mercY = (lat: number) => { const s = Math.sin((lat * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
const lonOf = (x: number) => x * 360 - 180;
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

export interface SeaRoute { meters: number; path: [number, number][] }

/** Rute over vann fra `from` til `to`, eller null (mangler fliser eller finner ingen vei). */
export async function seaRoute(from: { lat: number; lon: number }, to: { lat: number; lon: number }): Promise<SeaRoute | null> {
  const direct = distanceM(from, to);
  // Rammen rundt begge punktene, med margin så ruten kan gå rundt øyer.
  const margin = Math.max(3000, direct * 0.35);
  const midLat = (from.lat + to.lat) / 2;
  const mPerMerc = 40_075_016 * Math.cos((midLat * Math.PI) / 180);
  const pad = margin / mPerMerc;
  const x0 = Math.min(mercX(from.lon), mercX(to.lon)) - pad, x1 = Math.max(mercX(from.lon), mercX(to.lon)) + pad;
  const y0 = Math.min(mercY(from.lat), mercY(to.lat)) - pad, y1 = Math.max(mercY(from.lat), mercY(to.lat)) + pad;
  // Rutestørrelse: ca. 40 m nær kaia, grovere for lange strekk.
  const cell = Math.max(40 / mPerMerc, Math.max(x1 - x0, y1 - y0) / MAX_CELLS);
  const w = Math.ceil((x1 - x0) / cell), h = Math.ceil((y1 - y0) / cell);

  // Zoomnivå der én flis er rundt 100–200 ruter bred, men ikke flere enn ca. 60 fliser.
  let z = 13;
  while (z > 8 && Math.ceil((x1 - x0) * 2 ** z + 1) * Math.ceil((y1 - y0) * 2 ** z + 1) > 60) z--;
  const n = 2 ** z;
  const tiles: [number, number][] = [];
  for (let tx = Math.floor(x0 * n); tx <= Math.floor(x1 * n); tx++) for (let ty = Math.floor(y0 * n); ty <= Math.floor(y1 * n); ty++) tiles.push([tx, ty]);

  const url = await tileUrl();
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  const loaded = await Promise.all(tiles.map(async ([tx, ty]) => {
    const res = await fetch(url.replace('{z}', String(z)).replace('{x}', String(tx)).replace('{y}', String(ty)));
    if (!res.ok) return false;
    const layer = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer()))).layers.water;
    if (!layer) return true;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 3) continue;
      const path = new Path2D();
      const k = 1 / (f.extent * n * cell);
      for (const ring of f.loadGeometry()) {
        ring.forEach((p, j) => {
          const px = (tx / n - x0) / cell + p.x * k, py = (ty / n - y0) / cell + p.y * k;
          if (j) path.lineTo(px, py); else path.moveTo(px, py);
        });
        path.closePath();
      }
      ctx.fill(path, 'nonzero');
    }
    return true;
  }));
  if (!loaded.some(Boolean)) return null;

  const px = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 127 ? 1 : 0;

  // Bare havet: innsjøer og dammer er egne, mindre vannflater og tas bort.
  largestComponent(mask, w, h);
  const toCell = (p: { lat: number; lon: number }): Cell => [Math.floor((mercX(p.lon) - x0) / cell), Math.floor((mercY(p.lat) - y0) / cell)];
  const snapR = Math.ceil(1500 / (cell * mPerMerc));
  const a = snapToWater(mask, w, h, toCell(from), snapR);
  const b = snapToWater(mask, w, h, toCell(to), snapR);
  if (!a || !b) return null;
  const cells = findPath(mask, w, h, a, b);
  if (!cells) return null;
  const pts = smoothPath(mask, w, cells).map(([cx, cy]) => [lonOf(x0 + (cx + 0.5) * cell), latOf(y0 + (cy + 0.5) * cell)] as [number, number]);
  const path: [number, number][] = [[from.lon, from.lat], ...pts, [to.lon, to.lat]];
  let meters = 0;
  for (let i = 1; i < path.length; i++) meters += distanceM({ lon: path[i - 1][0], lat: path[i - 1][1] }, { lon: path[i][0], lat: path[i][1] });
  return { meters, path };
}
