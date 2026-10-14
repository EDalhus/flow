import { LngLatBounds, Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';

// Bakgrunnskart: Kartverkets åpne WMTS-cache (topograatone), CC BY 4.0.
// Gråtonekartet er lyst; vi inverterer lysstyrken (brightness-min > max) for mørkt tema som i designet.
export const KARTVERKET_TILES = 'https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png';
export const ATTRIBUTION = 'Kart © Kartverket (CC BY 4.0)';

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

export const FlowMap = forwardRef<MapHandle, Props>(function FlowMap({ center, zoom = 11.6, padding, geofence, overlays, interactive = true }, ref) {
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
          kartverket: { type: 'raster', tiles: [KARTVERKET_TILES], tileSize: 256, maxzoom: 18, attribution: ATTRIBUTION },
        },
        layers: [
          { id: 'hav', type: 'background', paint: { 'background-color': '#0B1219' } },
          {
            id: 'kartverket', type: 'raster', source: 'kartverket',
            paint: { 'raster-brightness-min': 0.5, 'raster-brightness-max': 0.03, 'raster-saturation': -1, 'raster-contrast': -0.15, 'raster-opacity': 0.85 },
          },
        ],
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
        background: 'linear-gradient(90deg, rgba(7,9,11,.55) 0%, rgba(7,9,11,0) 32%, rgba(7,9,11,0) 68%, rgba(7,9,11,.55) 100%), linear-gradient(180deg, rgba(7,9,11,.5) 0%, rgba(7,9,11,0) 22%)',
      }} />
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div style={{ pointerEvents: 'auto' }}>{map.current && overlays?.(project)}</div>
      </div>
    </div>
  );
});
