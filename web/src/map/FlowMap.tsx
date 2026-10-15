import { LngLatBounds, Map as MlMap, setWorkerUrl, type ExpressionSpecification, type GeoJSONSource, type LayerSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { shipImages, type TrafficLayers } from './traffic.ts';

// Bakgrunnskart som brukeren velger selv:
//   mørk/lys  – flatt sjøkart-preg som hos Kystverket: hav, land, veier og navn, uten terreng og høydekurver.
//               Vektorfliser fra OpenFreeMap (OpenStreetMap-data), uten nøkkel.
//   satellitt – Esri World Imagery. Hybrid legger Esris stedsnavn og grenser oppå.
// MapLibre finner ikke sin web worker etter bundling (vektorfliser og GeoJSON trenger den), så vi peker på den.
setWorkerUrl(workerUrl);

const OPENFREEMAP = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

export type Basemap = 'mork' | 'lys' | 'satellitt' | 'hybrid';
export const BASEMAPS: { value: Basemap; label: string }[] = [
  { value: 'mork', label: 'Mørk' }, { value: 'lys', label: 'Lys' }, { value: 'satellitt', label: 'Satellitt' }, { value: 'hybrid', label: 'Hybrid' },
];
export const attribution = (b: Basemap) =>
  b === 'mork' || b === 'lys' ? '© OpenFreeMap © OpenMapTiles © OpenStreetMap-bidragsytere · AIS: Kystverket' : 'Bilder © Esri, Maxar, Earthstar Geographics · AIS: Kystverket';

interface Palette { land: string; sea: string; road: string; roadEdge: string; ferry: string; building: string; label: string; halo: string; water: string; trafficLabel: string }
const PALETTE: Record<'mork' | 'lys', Palette> = {
  mork: { land: '#3A3D41', sea: '#07122A', road: '#2C2F33', roadEdge: '#26292C', ferry: '#55657F', building: '#34373B', label: '#EEF1F3', halo: '#07122A', water: '#9AAAC2', trafficLabel: '#F2F5F3' },
  lys: { land: '#EFEFEB', sea: '#BCD3E5', road: '#FFFFFF', roadEdge: '#D9D9D2', ferry: '#7F99B2', building: '#E1E1DA', label: '#2B2F33', halo: '#FFFFFF', water: '#4F6E8C', trafficLabel: '#1A231E' },
};

const name: ExpressionSpecification = ['coalesce', ['get', 'name:nb'], ['get', 'name:no'], ['get', 'name']];
const lineType = (t: string): ExpressionSpecification => ['==', ['geometry-type'], t];

/** Vektorlagene for mørk/lys. Bare fargene skifter mellom de to. */
function vectorLayers(p: Palette): LayerSpecification[] {
  const roads: ExpressionSpecification = ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false];
  return [
    { id: 'vk-water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': p.sea } },
    { id: 'vk-waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 11, paint: { 'line-color': p.sea, 'line-width': 1 } },
    { id: 'vk-building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': p.building } },
    {
      id: 'vk-ferry', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'ferry'],
      paint: { 'line-color': p.ferry, 'line-width': 1, 'line-dasharray': [3, 3], 'line-opacity': 0.8 },
    },
    {
      id: 'vk-road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12.5,
      filter: ['all', ['match', ['get', 'class'], ['minor', 'service'], true, false], ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: { 'line-color': p.roadEdge, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 17, 4] },
    },
    {
      id: 'vk-road', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: roads,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': p.road, 'line-opacity': ['case', ['==', ['get', 'brunnel'], 'tunnel'], 0.45, 1],
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 12, 1.6, 16, 7],
      },
    },
    {
      id: 'vk-water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name', filter: lineType('Point'),
      layout: { 'text-field': name, 'text-font': ['Noto Sans Italic'], 'text-size': 13, 'text-letter-spacing': 0.15 },
      paint: { 'text-color': p.water, 'text-halo-color': p.halo, 'text-halo-width': 1 },
    },
    {
      id: 'vk-water-name-line', type: 'symbol', source: 'omt', 'source-layer': 'water_name', filter: lineType('LineString'),
      layout: { 'text-field': name, 'text-font': ['Noto Sans Italic'], 'text-size': 13, 'text-letter-spacing': 0.2, 'symbol-placement': 'line' },
      paint: { 'text-color': p.water, 'text-halo-color': p.halo, 'text-halo-width': 1 },
    },
    {
      id: 'vk-road-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13, filter: roads,
      layout: { 'text-field': ['upcase', name], 'text-font': ['Noto Sans Regular'], 'text-size': 10, 'text-letter-spacing': 0.08, 'symbol-placement': 'line' },
      paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.2, 'text-opacity': 0.75 },
    },
    {
      id: 'vk-place', type: 'symbol', source: 'omt', 'source-layer': 'place',
      filter: ['match', ['get', 'class'], ['city', 'town', 'village', 'suburb', 'hamlet', 'island', 'islet', 'neighbourhood'], true, false],
      layout: {
        'text-field': name,
        'text-font': ['match', ['get', 'class'], ['city', 'town'], ['literal', ['Noto Sans Bold']], ['literal', ['Noto Sans Regular']]],
        'text-size': ['match', ['get', 'class'], 'city', 18, 'town', 15, ['island'], 14, 13],
        'symbol-sort-key': ['get', 'rank'],
        'text-padding': 6,
      },
      paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.4 },
    },
  ] as LayerSpecification[];
}

const VECTOR_IDS = vectorLayers(PALETTE.mork).map(l => l.id);
const LAYERS: Record<Basemap, string[]> = {
  mork: VECTOR_IDS, lys: VECTOR_IDS, satellitt: ['esri-bilder'], hybrid: ['esri-bilder', 'esri-navn'],
};
const ALL_LAYERS = [...new Set(Object.values(LAYERS).flat())];
const landColor = (b: Basemap) => (b === 'lys' ? PALETTE.lys.land : b === 'mork' ? PALETTE.mork.land : '#1B2A23');

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
  /** Trafikkbildet (AIS) som kartlag. */
  traffic?: TrafficLayers;
  /** Klikk på et skip (MMSI og eventuelt anløp hos oss), eller på tomt kart (null). */
  onShipClick?: (mmsi: string | null, callId?: string) => void;
  /** Kalles når zoomnivået krysser terskelen for skipsnavn. */
  onZoomNames?: (on: boolean) => void;
}

/** Fra dette zoomnivået vises navn på alle skip. */
export const NAME_ZOOM = 13;

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

export const FlowMap = forwardRef<MapHandle, Props>(function FlowMap({ center, zoom = 11.6, padding, geofence, overlays, interactive = true, basemap = 'mork', traffic, onShipClick, onZoomNames }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [, setFrame] = useState(0);
  const [trafficReady, setTrafficReady] = useState(false);
  const clickRef = useRef(onShipClick);
  clickRef.current = onShipClick;
  const zoomRef = useRef(onZoomNames);
  zoomRef.current = onZoomNames;

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
        glyphs: GLYPHS,
        sources: {
          omt: { type: 'vector', url: OPENFREEMAP },
          esri: { type: 'raster', tiles: [ESRI_IMAGERY], tileSize: 256, maxzoom: 19 },
          esriNavn: { type: 'raster', tiles: [ESRI_LABELS], tileSize: 256, maxzoom: 19 },
        },
        layers: [
          { id: 'hav', type: 'background', paint: { 'background-color': landColor(basemap) } },
          ...vectorLayers(PALETTE[basemap === 'lys' ? 'lys' : 'mork']),
          { id: 'esri-bilder', type: 'raster', source: 'esri', paint: { 'raster-saturation': -0.1 } },
          { id: 'esri-navn', type: 'raster', source: 'esriNavn' },
        ].map(l => (l.id === 'hav' || LAYERS[basemap].includes(l.id) ? l : { ...l, layout: { ...('layout' in l ? l.layout : {}), visibility: 'none' } })) as LayerSpecification[],
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
      addTraffic(m, basemap);
      setTrafficReady(true);
    });
    m.on('click', e => {
      const hit = m.getLayer('ais-ships') ? m.queryRenderedFeatures([[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]], { layers: ['ais-ships'] })[0] : undefined;
      clickRef.current?.(hit ? String(hit.properties.mmsi) : null, hit?.properties.call ? String(hit.properties.call) : undefined);
    });
    m.on('mouseenter', 'ais-ships', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'ais-ships', () => { m.getCanvas().style.cursor = ''; });
    let names = m.getZoom() >= NAME_ZOOM;
    m.on('zoomend', () => {
      const on = m.getZoom() >= NAME_ZOOM;
      if (on !== names) { names = on; zoomRef.current?.(on); }
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
      m.setPaintProperty('hav', 'background-color', landColor(basemap));
      // Mørk og lys deler lag; bare fargene byttes.
      if (basemap === 'mork' || basemap === 'lys') {
        for (const l of vectorLayers(PALETTE[basemap])) {
          for (const [k, v] of Object.entries(l.paint ?? {})) m.setPaintProperty(l.id, k as 'fill-color', v);
        }
      }
      if (m.getLayer('ais-ship-names')) {
        const p = PALETTE[basemap === 'lys' ? 'lys' : 'mork'];
        m.setPaintProperty('ais-ship-names', 'text-color', p.trafficLabel);
        m.setPaintProperty('ais-ship-names', 'text-halo-color', basemap === 'lys' ? '#FFFFFF' : 'rgba(7,18,42,.9)');
        m.setPaintProperty('ais-predict', 'line-color', basemap === 'lys' ? '#1A231E' : '#FFFFFF');
        m.setPaintProperty('ais-rings', 'line-color', basemap === 'lys' ? '#1A231E' : '#FFFFFF');
        m.setPaintProperty('ais-ring-labels', 'text-color', basemap === 'lys' ? '#1A231E' : '#FFFFFF');
        m.setPaintProperty('ais-ring-labels', 'text-halo-color', basemap === 'lys' ? '#FFFFFF' : 'rgba(7,18,42,.9)');
      }
    };
    // Lagene finnes så snart stilen er lest inn. isStyleLoaded() er false mens fliser lastes,
    // og «load» har da allerede gått – derfor sjekkes laget direkte.
    if (m.getLayer('esri-bilder')) apply(); else m.once('styledata', apply);
  }, [basemap]);

  // Trafikkbildet oppdateres ved å bytte data i kildene; lagene står.
  useEffect(() => {
    const m = map.current;
    if (!m || !trafficReady || !traffic) return;
    for (const [key, fc] of Object.entries(traffic)) (m.getSource(`ais-${key}`) as GeoJSONSource | undefined)?.setData(fc);
  }, [traffic, trafficReady]);

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

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

/** Kilder og lag for AIS-trafikken, i rekkefølge nedenfra: døgnspor, ringer, spor, kurslinje, skip. */
function addTraffic(m: MlMap, basemap: Basemap) {
  for (const img of shipImages()) if (!m.hasImage(img.id)) m.addImage(img.id, img.data, { pixelRatio: 2 });
  for (const key of ['track', 'route', 'rings', 'trails', 'predict', 'ships']) m.addSource(`ais-${key}`, { type: 'geojson', data: EMPTY });
  const light = basemap === 'lys';
  const ink = light ? '#1A231E' : '#FFFFFF';
  const halo = light ? '#FFFFFF' : 'rgba(7,18,42,.9)';
  m.addLayer({ id: 'ais-track', type: 'line', source: 'ais-track', layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#80EFDE', 'line-width': 2, 'line-opacity': 0.75 } });
  m.addLayer({ id: 'ais-route', type: 'line', source: 'ais-route', layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#80EFDE', 'line-width': 2.2, 'line-opacity': 0.9, 'line-dasharray': [1, 2] } });
  m.addLayer({ id: 'ais-rings', type: 'line', source: 'ais-rings', paint: { 'line-color': ink, 'line-width': 1, 'line-opacity': 0.7, 'line-dasharray': [3, 3] } });
  m.addLayer({ id: 'ais-ring-labels', type: 'symbol', source: 'ais-rings',
    layout: { 'symbol-placement': 'line', 'symbol-spacing': 900, 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-keep-upright': true },
    paint: { 'text-color': ink, 'text-halo-color': halo, 'text-halo-width': 1.4 } });
  m.addLayer({ id: 'ais-trails', type: 'line', source: 'ais-trails', layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-dasharray': [2, 2], 'line-opacity': 0.9 } });
  m.addLayer({ id: 'ais-predict', type: 'line', source: 'ais-predict', paint: { 'line-color': ink, 'line-width': 1.4, 'line-opacity': 0.9 } });
  m.addLayer({ id: 'ais-ships', type: 'symbol', source: 'ais-ships',
    layout: {
      'icon-image': ['get', 'icon'], 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true, 'icon-ignore-placement': true,
      // Våre båter litt større, valgt båt størst.
      'icon-size': ['interpolate', ['linear'], ['zoom'],
        8, ['case', ['get', 'sel'], 1, ['get', 'ours'], 0.85, 0.7],
        11, ['case', ['get', 'sel'], 1.35, ['get', 'ours'], 1.15, 1],
        14, ['case', ['get', 'sel'], 1.7, ['get', 'ours'], 1.5, 1.35]],
      'symbol-sort-key': ['case', ['get', 'sel'], 2, ['get', 'ours'], 1, 0],
    } });
  m.addLayer({ id: 'ais-ship-names', type: 'symbol', source: 'ais-ships',
    // Navnet står rett ved siden av båten, i fet skrift for våre båter (som i Kystverkets kart).
    layout: {
      'text-field': ['get', 'label'], 'text-font': ['case', ['get', 'bold'], ['literal', ['Noto Sans Bold']], ['literal', ['Noto Sans Regular']]],
      'text-size': ['case', ['get', 'bold'], 13, 11.5], 'text-anchor': 'left', 'text-offset': [1.1, 0], 'text-optional': true,
      'symbol-sort-key': ['case', ['get', 'bold'], 0, 1],
    },
    paint: { 'text-color': light ? PALETTE.lys.trafficLabel : PALETTE.mork.trafficLabel, 'text-halo-color': halo, 'text-halo-width': 1.6 } });
}
