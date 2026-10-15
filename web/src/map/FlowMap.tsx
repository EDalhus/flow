import { LngLatBounds, Map as MlMap, type LayerSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';

// Bakgrunnskart som brukeren velger selv:
//   mørk/lys  – Kartverkets åpne WMTS-cache (topograatone), CC BY 4.0. Mørk inverterer lysstyrken.
//   satellitt – Esri World Imagery. Hybrid legger Esris stedsnavn og grenser oppå.
export const KARTVERKET_TILES = 'https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png';
const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

export type Basemap = 'mork' | 'lys' | 'satellitt' | 'hybrid';
export const BASEMAPS: { value: Basemap; label: string }[] = [
  { value: 'mork', label: 'Mørk' }, { value: 'lys', label: 'Lys' }, { value: 'satellitt', label: 'Satellitt' }, { value: 'hybrid', label: 'Hybrid' },
];
export const attribution = (b: Basemap) =>
  b === 'mork' || b === 'lys' ? 'Kart © Kartverket (CC BY 4.0)' : 'Bilder © Esri, Maxar, Earthstar Geographics';
const LAYERS: Record<Basemap, string[]> = {
  mork: ['kartverket-mork'], lys: ['kartverket-lys'], satellitt: ['esri-bilder'], hybrid: ['esri-bilder', 'esri-navn'],
};
const ALL_LAYERS = [...new Set(Object.values(LAYERS).flat())];

export interface MapHandle {
  zoomIn(): void;
  zoomOut(): void;
  flyTo(lon: number, lat: number, zoom?: number): void;
  /** Tilpass utsnittet så alle punktene ([lon, lat]) synes. */
  fitTo(points: [number, number][], maxZoom?: number): void;
}

export type Project = (lon: number, lat: number) => [number, number] | null;

interface Props {
  center: [number, number];
  zoom?: number;
  /** Synlig område mellom glasspanelene, så sentrum havner i "hullet". */
  padding?: { top: number; bottom: number; left: number; right: number };
  geofence?: { lat: number; lon: number; radius_m: number } | null;
  /** HTML-overlegg (kai, båter, kort) plassert med project(). Tegnes på nytt når kartet flyttes. */
  overlays?: (project: Project) => ReactNode;
  interactive?: boolean;
  basemap?: Basemap;
}

function circle(lon: number, lat: number, radiusM: number, steps = 64) {
  const coords: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    coords.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [coords] } };
}

export const FlowMap = forwardRef<MapHandle, Props>(function FlowMap({ center, zoom = 11.6, padding, geofence, overlays, interactive = true, basemap = 'mork' }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [, setFrame] = useState(0);

  useEffect(() => {
    if (!el.current) return;
    const m = new MlMap({
      container: el.current,
      center,
      zoom,
      minZoom: 6,
      maxZoom: 17,
      interactive,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      style: {
        version: 8,
        sources: {
          kartverket: { type: 'raster', tiles: [KARTVERKET_TILES], tileSize: 256, maxzoom: 18 },
          esri: { type: 'raster', tiles: [ESRI_IMAGERY], tileSize: 256, maxzoom: 19 },
          esriNavn: { type: 'raster', tiles: [ESRI_LABELS], tileSize: 256, maxzoom: 19 },
        },
        layers: [
          { id: 'hav', type: 'background', paint: { 'background-color': basemap === 'lys' ? '#DCE3DF' : '#1B2A23' } },
          {
            id: 'kartverket-mork', type: 'raster', source: 'kartverket',
            paint: { 'raster-brightness-min': 0.55, 'raster-brightness-max': 0.02, 'raster-saturation': -1, 'raster-contrast': -0.1, 'raster-opacity': 0.7 },
          },
          { id: 'kartverket-lys', type: 'raster', source: 'kartverket', paint: { 'raster-saturation': -0.4, 'raster-opacity': 0.95 } },
          { id: 'esri-bilder', type: 'raster', source: 'esri', paint: { 'raster-saturation': -0.1 } },
          { id: 'esri-navn', type: 'raster', source: 'esriNavn' },
        ].map(l => (l.id === 'hav' || LAYERS[basemap].includes(l.id) ? l : { ...l, layout: { visibility: 'none' } })) as LayerSpecification[],
      },
    });
    if (padding) m.setPadding(padding);
    m.touchZoomRotate.disableRotation();
    const redraw = () => setFrame(f => f + 1);
    m.on('move', redraw);
    m.on('resize', redraw);
    m.on('load', () => {
      redraw();
      if (geofence) {
        m.addSource('geofence', { type: 'geojson', data: circle(geofence.lon, geofence.lat, geofence.radius_m) });
        m.addLayer({ id: 'geofence-fill', type: 'fill', source: 'geofence', paint: { 'fill-color': '#5BD68A', 'fill-opacity': 0.06 } });
        m.addLayer({ id: 'geofence-line', type: 'line', source: 'geofence', paint: { 'line-color': '#5BD68A', 'line-opacity': 0.45, 'line-width': 1.2, 'line-dasharray': [3, 3] } });
      }
    });
    map.current = m;
    return () => { m.remove(); map.current = null; };
    // Kartet opprettes én gang; senere endringer styres via handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bytt bakgrunnskart uten å bygge kartet på nytt: bare synligheten endres.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      for (const id of ALL_LAYERS) m.setLayoutProperty(id, 'visibility', LAYERS[basemap].includes(id) ? 'visible' : 'none');
      m.setPaintProperty('hav', 'background-color', basemap === 'lys' ? '#DCE3DF' : '#1B2A23');
    };
    if (m.isStyleLoaded()) apply(); else m.once('load', apply);
  }, [basemap]);

  useImperativeHandle(ref, () => ({
    zoomIn: () => map.current?.zoomIn(),
    zoomOut: () => map.current?.zoomOut(),
    flyTo: (lon, lat, z) => map.current?.flyTo({ center: [lon, lat], zoom: z ?? Math.max(map.current.getZoom(), 12.5), essential: true }),
    fitTo: (points, maxZoom = 13) => {
      if (!map.current || !points.length) return;
      const b = new LngLatBounds(points[0], points[0]);
      points.forEach(p => b.extend(p));
      map.current.fitBounds(b, { padding: 60, maxZoom, duration: 0 });
    },
  }), []);

  const project: Project = (lon, lat) => {
    const m = map.current;
    if (!m) return null;
    const p = m.project([lon, lat]);
    return [p.x, p.y];
  };

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: 'var(--bg-map)' }}>
      <div ref={el} style={{ position: 'absolute', inset: 0 }} aria-label="Kart over Ålesund med Flatholmen" role="region" />
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'linear-gradient(90deg, rgba(20,27,23,.55) 0%, rgba(20,27,23,0) 32%, rgba(20,27,23,0) 68%, rgba(20,27,23,.55) 100%), linear-gradient(180deg, rgba(20,27,23,.5) 0%, rgba(20,27,23,0) 22%)',
      }} />
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div style={{ pointerEvents: 'auto' }}>{map.current && overlays?.(project)}</div>
      </div>
    </div>
  );
});
