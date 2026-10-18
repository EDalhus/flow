import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { AisCoast, AisTrack, PortCallView } from '../../../shared/api.ts';
import { MOVING_KNOTS } from '../../../shared/domain/ais.ts';
import { distanceM } from '../../../shared/domain/geo.ts';
import { api } from '../lib/api.ts';
import { useAis } from '../lib/queries.ts';
import { BASEMAPS, type Basemap } from './FlowMap.tsx';
import { seaRoute } from './seaRoute.ts';
import { isLight } from '../lib/theme.ts';
import { LEGEND_TYPES, RANGE_STEPS, trafficLayers, trafficVessels, type LegendType, type RangeKm, type TrafficVessel } from './traffic.ts';

/** Avstand og tid til kaia med farten fartøyet holder nå. `sea`: målt langs sjøveien (ellers luftlinje). */
export interface Approach { nm: number; knots: number | null; minutes: number | null; sea: boolean; pending: boolean }

const stored = (key: string, fallback: boolean) => { try { const v = localStorage.getItem(key); return v == null ? fallback : v === '1'; } catch { return fallback; } };
const store = (key: string, v: boolean) => { try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* ignorer */ } };
const storedHidden = (): Set<LegendType> => {
  try { const v = JSON.parse(localStorage.getItem('flow-skjul-typer') ?? '[]'); return new Set((Array.isArray(v) ? v : []).filter(x => (LEGEND_TYPES as readonly string[]).includes(x))); } catch { return new Set(); }
};
const storedRange = (): RangeKm => {
  try { const v = Number(localStorage.getItem('flow-omrade')); return (RANGE_STEPS as readonly number[]).includes(v) && localStorage.getItem('flow-omrade') != null ? v as RangeKm : 75; } catch { return 75; }
};

/** Kartutsnitt rundet utover til halve grader, så små flytt ikke gir nye kall. */
const roundBox = ([w, s, e, n]: [number, number, number, number]) =>
  [Math.floor(w * 2) / 2, Math.floor(s * 2) / 2, Math.ceil(e * 2) / 2, Math.ceil(n * 2) / 2].join(',');

/**
 * Trafikkbildet for kartet (desktop og mobil): alle fartøy i området, valgt skip, sjøvei til kaia og kartlagene.
 * `selectedBoatId`: båten til valgt anløp, som da får ringer, døgnspor og sjøvei.
 */
export function useTraffic(calls: PortCallView[], selectedBoatId: string | null, quay: { lat: number; lon: number }) {
  const ais = useAis();
  const vessels = useMemo(() => ais.data?.vessels ?? [], [ais.data]);
  const [shipSel, setShipSel] = useState<string | null>(null);
  const [zoomNames, setZoomNames] = useState(false);
  // Visning av fartøy utenfor båtregisteret; valgene huskes i nettleseren.
  const [showOthers, setShowOthersState] = useState(() => stored('flow-andre-vis', true));
  const [colorOthers, setColorOthersState] = useState(() => stored('flow-andre-farge', true));
  const setShowOthers = (v: boolean) => { setShowOthersState(v); store('flow-andre-vis', v); };
  const setColorOthers = (v: boolean) => { setColorOthersState(v); store('flow-andre-farge', v); };
  // Typer som er skrudd av, og hvor langt ut andre båter vises (0 = hele kysten).
  const [hidden, setHidden] = useState<Set<LegendType>>(storedHidden);
  const toggleType = (k: LegendType) => {
    const next = new Set(hidden);
    if (next.has(k)) next.delete(k); else next.add(k);
    setHidden(next);
    try { localStorage.setItem('flow-skjul-typer', JSON.stringify([...next])); } catch { /* ignorer */ }
  };
  const [range, setRangeState] = useState<RangeKm>(storedRange);
  const setRange = (v: RangeKm) => { setRangeState(v); try { localStorage.setItem('flow-omrade', String(v)); } catch { /* ignorer */ } };
  const coastOn = range === 0 && showOthers;
  const [bounds, setBounds] = useState<string | null>(null);
  const coast = useQuery({
    queryKey: ['ais-coast', bounds], queryFn: () => api<AisCoast>(`/ais/coast?bbox=${bounds}`),
    enabled: coastOn && !!bounds, refetchInterval: 60_000, staleTime: 50_000, placeholderData: keepPreviousData,
  });
  const coastList = coastOn ? coast.data?.vessels : undefined;

  const traffic = useMemo(() => trafficVessels(ais.data?.area ?? [], vessels, coastList), [ais.data, vessels, coastList]);
  // Fartøy med anløp hos oss: MMSI → neste aktive anløp.
  const hot = useMemo(() => {
    const active = calls.filter(c => c.status !== 'ferdig' && c.status !== 'avlyst').sort((a, b) => a.eta.localeCompare(b.eta));
    const m = new Map<string, string>();
    for (const v of vessels) { const c = active.find(x => x.boat.id === v.boat_id); if (c) m.set(v.mmsi, c.id); }
    return m;
  }, [calls, vessels]);
  const selectedMmsi = shipSel ?? (selectedBoatId ? vessels.find(v => v.boat_id === selectedBoatId)?.mmsi ?? null : null);
  const selShip = traffic.find(v => v.mmsi === selectedMmsi) ?? null;
  const track24 = useQuery({
    queryKey: ['ais-track', selectedMmsi], queryFn: () => api<AisTrack>(`/ais/track/${selectedMmsi}`),
    enabled: !!selectedMmsi, staleTime: 120_000,
  });
  // Sjøvei: beregnes på nytt når fartøyet har flyttet seg et par hundre meter.
  const routeKey = selShip ? [selShip.mmsi, selShip.lat.toFixed(3), selShip.lon.toFixed(3), quay.lat, quay.lon] : null;
  const route = useQuery({
    queryKey: ['sea-route', ...(routeKey ?? [])], queryFn: () => seaRoute(selShip!, quay),
    enabled: !!selShip && distanceM(selShip, quay) > 300, staleTime: 5 * 60_000, gcTime: 10 * 60_000, retry: false,
  });
  // Ruten for valgt fartøy; null mens den beregnes eller hvis ingen vei over vann ble funnet.
  const routeData = selShip ? route.data ?? null : null;

  const layers = useMemo(
    () => trafficLayers(traffic, {
      hot, selected: selectedMmsi, track24: track24.data?.mmsi === selectedMmsi ? track24.data.points : null,
      route: routeData?.path ?? null, zoomNames, showOthers, colorOthers, hidden,
      radiusKm: range === 0 || range === 75 ? null : range, quay,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [traffic, hot, selectedMmsi, track24.data, routeData, zoomNames, showOthers, colorOthers, hidden, range, quay.lat, quay.lon],
  );

  const approach = (v: TrafficVessel | null): Approach | null => {
    if (!v) return null;
    const sea = v.mmsi === selShip?.mmsi && routeData ? routeData.meters : null;
    const nm = (sea ?? distanceM(v, quay)) / 1852;
    const moving = (v.sog ?? 0) >= MOVING_KNOTS;
    return { nm, knots: v.sog, minutes: moving ? (nm / v.sog!) * 60 : null, sea: sea != null, pending: route.isFetching && sea == null };
  };

  return {
    ais, vessels, traffic, hot, shipSel, setShipSel, selShip, layers, setZoomNames, trackError: track24.data?.error ?? null,
    approach: approach(selShip), showOthers, setShowOthers, colorOthers, setColorOthers,
    hidden, toggleType, range, setRange, onBounds: (b: [number, number, number, number]) => setBounds(roundBox(b)),
    coastPending: coastOn && (coast.isFetching && !coast.data), coastError: coastOn ? coast.data?.error ?? null : null,
    coastCount: coastList?.length ?? null,
  };
}

/** Bakgrunnskartet velges av hver bruker og huskes i nettleseren. */
export function useBasemap() {
  const [basemap, setBasemap] = useState<Basemap>(() => {
    // Uten eget valg følger kartet temaet: lyst kart i lyst tema.
    const fallback: Basemap = isLight() ? 'lys' : 'mork';
    try { const v = localStorage.getItem('flow-kartstil'); return BASEMAPS.some(b => b.value === v) ? v as Basemap : fallback; } catch { return fallback; }
  });
  const pick = (b: Basemap) => { setBasemap(b); try { localStorage.setItem('flow-kartstil', b); } catch { /* ignorer */ } };
  return [basemap, pick] as const;
}
