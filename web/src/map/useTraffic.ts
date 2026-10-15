import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { AisTrack, PortCallView } from '../../../shared/api.ts';
import { api } from '../lib/api.ts';
import { useAis } from '../lib/queries.ts';
import { BASEMAPS, type Basemap } from './FlowMap.tsx';
import { trafficLayers, trafficVessels } from './traffic.ts';

/**
 * Trafikkbildet for kartet (desktop og mobil): alle fartøy i området, valgt skip og kartlagene.
 * Båter med anløp hos oss tegnes som egne knapper og holdes utenfor skipslaget.
 * `selectedBoatId`: båten til valgt anløp, som da får ringer og døgnspor.
 */
export function useTraffic(calls: PortCallView[], selectedBoatId: string | null) {
  const ais = useAis();
  const vessels = useMemo(() => ais.data?.vessels ?? [], [ais.data]);
  const [shipSel, setShipSel] = useState<string | null>(null);
  const [zoomNames, setZoomNames] = useState(false);
  const traffic = useMemo(() => trafficVessels(ais.data?.area ?? [], vessels), [ais.data, vessels]);
  const hotMmsi = useMemo(() => {
    const booked = new Set(calls.filter(c => c.status !== 'ferdig' && c.status !== 'avlyst').map(c => c.boat.id));
    return new Set(vessels.filter(v => booked.has(v.boat_id)).map(v => v.mmsi));
  }, [calls, vessels]);
  const selectedMmsi = shipSel ?? (selectedBoatId ? vessels.find(v => v.boat_id === selectedBoatId)?.mmsi ?? null : null);
  const selShip = traffic.find(v => v.mmsi === selectedMmsi) ?? null;
  const track24 = useQuery({
    queryKey: ['ais-track', selectedMmsi], queryFn: () => api<AisTrack>(`/ais/track/${selectedMmsi}`),
    enabled: !!selectedMmsi, staleTime: 120_000,
  });
  const layers = useMemo(
    () => trafficLayers(traffic, hotMmsi, selectedMmsi, track24.data?.mmsi === selectedMmsi ? track24.data.points : null, zoomNames),
    [traffic, hotMmsi, selectedMmsi, track24.data, zoomNames],
  );
  return { ais, vessels, traffic, hotMmsi, shipSel, setShipSel, selShip, layers, setZoomNames, trackError: track24.data?.error ?? null };
}

/** Bakgrunnskartet velges av hver bruker og huskes i nettleseren. */
export function useBasemap() {
  const [basemap, setBasemap] = useState<Basemap>(() => {
    try { const v = localStorage.getItem('flow-kartstil'); return BASEMAPS.some(b => b.value === v) ? v as Basemap : 'mork'; } catch { return 'mork'; }
  });
  const pick = (b: Basemap) => { setBasemap(b); try { localStorage.setItem('flow-kartstil', b); } catch { /* ignorer */ } };
  return [basemap, pick] as const;
}
