import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { AisTrack, BoatDetail, PortCallView } from '../../../shared/api.ts';
import { distanceM } from '../../../shared/domain/geo.ts';
import { MOVING_KNOTS } from '../../../shared/domain/ais.ts';
import { shipTypeLabel } from '../../../shared/domain/shiptype.ts';
import { AlertsPanel } from '../components/Alerts.tsx';
import { CallDetail, type DetailTab } from '../components/CallDetail.tsx';
import { Anchor, Close, Minus, Plus, Target, TrendUp } from '../components/Icons.tsx';
import { KaibokModal } from '../components/KaibokForm.tsx';
import { BoatTabs, Sidebar, Topbar } from '../components/Topbar.tsx';
import { QuayMark } from '../components/ui.tsx';
import { BASEMAPS, FlowMap, attribution, type Basemap, type MapHandle, type Project } from '../map/FlowMap.tsx';
import { CATEGORY_COLOR, CATEGORY_LABEL, ago, degMin, trafficLayers, trafficVessels, type TrafficVessel } from '../map/traffic.ts';
import { STATUS_STYLE, addDays, fr, nb, isOwnQuay, osloTime, quayLabel, quayTitle, timeRange, titleCase, todayOslo } from '../lib/format.ts';
import { api, errorText } from '../lib/api.ts';
import { canBoats } from '../lib/roles.ts';
import { useAis, useMe, usePortCalls, useQuays, useSettings, useSummary } from '../lib/queries.ts';
import { VesselLayer } from '../map/Vessels.tsx';
import { useNow } from '../lib/useNow.ts';
import './kart.css';

const FALLBACK = { lat: 62.47918, lon: 6.19292 };

export function KartPage() {
  const now = useNow();
  const today = todayOslo(now);
  const tomorrow = addDays(today, 1);
  const calls = usePortCalls(today, tomorrow);
  const quays = useQuays();
  const settings = useSettings();
  const [params, setParams] = useSearchParams();
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [kaibok, setKaibok] = useState(false);
  // Kaibelegget er lagt sammen som standard, så kartet får fokus. Valget huskes.
  const [tlOpen, setTlOpen] = useState(() => { try { return localStorage.getItem('flow-kaibelegg') === 'open'; } catch { return false; } });
  const toggleTl = () => setTlOpen(o => { try { localStorage.setItem('flow-kaibelegg', o ? 'closed' : 'open'); } catch { /* ignorer */ } return !o; });
  const mapRef = useRef<MapHandle>(null);
  // Bakgrunnskart velges av hver bruker og huskes i nettleseren.
  const [basemap, setBasemap] = useState<Basemap>(() => {
    try { const v = localStorage.getItem('flow-kartstil'); return BASEMAPS.some(b => b.value === v) ? v as Basemap : 'mork'; } catch { return 'mork'; }
  });
  const pickBasemap = (b: Basemap) => { setBasemap(b); try { localStorage.setItem('flow-kartstil', b); } catch { /* ignorer */ } };

  const list = calls.data?.calls ?? [];
  const selectedId = params.get('id');
  const tab = (params.get('tab') as DetailTab) ?? 'oversikt';
  // Ingen automatisk valg: detaljpanelet vises bare når et anløp er valgt, så kartet er mest mulig fritt.
  const selected = selectedId ? list.find(c => c.id === selectedId) : undefined;
  const [shipSel, setShipSel] = useState<string | null>(null);
  const select = (id: string, t?: DetailTab) => {
    setShipSel(null);
    setParams(p => { p.set('id', id); if (t) p.set('tab', t); else p.delete('tab'); return p; }, { replace: true });
  };
  const deselect = () => setParams(p => { p.delete('id'); p.delete('tab'); return p; }, { replace: true });
  const deselectRef = useRef(deselect);
  deselectRef.current = deselect;
  const alertsRef = useRef(false);
  alertsRef.current = alertsOpen;

  const fence = settings.data?.geofence ?? { ...FALLBACK, radius_m: 300, label: '' };
  const quayPos = (id: string) => {
    const qy = quays.data?.find(x => x.id === id);
    return qy?.lat != null && qy.lon != null ? { lat: qy.lat, lon: qy.lon } : fence;
  };

  const todays = list.filter(c => c.service_date === today);

  const ais = useAis();
  const vessels = ais.data?.vessels ?? [];

  // Trafikkbildet: alle fartøy i området. Båter med anløp hos oss tegnes som egne knapper.
  const [zoomNames, setZoomNames] = useState(false);
  const traffic = useMemo(() => trafficVessels(ais.data?.area ?? [], vessels), [ais.data, vessels]);
  const hotMmsi = useMemo(() => {
    const booked = new Set(list.filter(c => c.status !== 'ferdig' && c.status !== 'avlyst').map(c => c.boat.id));
    return new Set(vessels.filter(v => booked.has(v.boat_id)).map(v => v.mmsi));
  }, [list, vessels]);
  const selectedMmsi = shipSel ?? (selected ? vessels.find(v => v.boat_id === selected.boat.id)?.mmsi ?? null : null);
  const selShip = traffic.find(v => v.mmsi === selectedMmsi) ?? null;
  const track24 = useQuery({
    queryKey: ['ais-track', selectedMmsi], queryFn: () => api<AisTrack>(`/ais/track/${selectedMmsi}`),
    enabled: !!selectedMmsi, staleTime: 120_000,
  });
  const layers = useMemo(
    () => trafficLayers(traffic, hotMmsi, selectedMmsi, track24.data?.mmsi === selectedMmsi ? track24.data.points : null, zoomNames),
    [traffic, hotMmsi, selectedMmsi, track24.data, zoomNames],
  );
  const pickShip = (mmsi: string | null) => {
    setShipSel(mmsi);
    if (mmsi && selected) deselect();
  };
  const shipRef = useRef(shipSel);
  shipRef.current = shipSel;

  // Fra det globale søket: «Vis i kartet» sender posisjonen hit (også båter utenfor båtregisteret).
  const focus = params.get('lat') && params.get('lon')
    ? { lat: Number(params.get('lat')), lon: Number(params.get('lon')), name: params.get('name') ?? '', mmsi: params.get('mmsi') }
    : null;
  useEffect(() => {
    if (!focus || !mapRef.current) return;
    mapRef.current.flyTo(focus.lon, focus.lat, 12.5);
    if (focus.mmsi && !hotMmsi.has(focus.mmsi)) setShipSel(focus.mmsi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.lat, focus?.lon, settings.isSuccess]);
  // Første gang AIS-data finnes: vis kaia og båtene som skal til oss.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || focus || !mapRef.current || !vessels.length || !calls.data) return;
    const booked = new Set(list.filter(c => c.status !== 'ferdig').map(c => c.boat.id));
    const pts = vessels.filter(v => booked.has(v.boat_id)).map(v => [v.lon, v.lat] as [number, number]);
    mapRef.current.fitTo([[fence.lon, fence.lat], ...pts], 12.5);
    fitted.current = true;
  }, [vessels, calls.data, list, fence.lon, fence.lat]);

  useEffect(() => {
    // Esc lukker varsler først, deretter valgt anløp. Ikke mens kaibok-skjemaet er åpent.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (alertsRef.current) setAlertsOpen(false);
      else if (shipRef.current) setShipSel(null);
      else deselectRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const overlays = (project: Project) => {
    const quayPt = project(fence.lon, fence.lat);
    const card = (x: number, y: number) => selected && <MapCard call={selected} x={x} y={y} now={now} today={today} onChat={() => select(selected.id, 'chat')} approach={selShip && approach(selShip, fence)} />;
    const selectedOnMap = vessels.some(v => v.boat_id === selected?.boat.id) || (selected?.status === 'ved_kai');
    return (
      <>
        {quayPt && (
          <span style={{ position: 'absolute', left: quayPt[0], top: quayPt[1], transform: 'translate(-50%, -150%)', display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(242,245,243,.95)', color: '#1A231E', borderRadius: 999, padding: '4px 10px 4px 6px', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#1A231E', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Anchor size={11} /></span>
            Vår kai · {(() => {
              const own = (quays.data ?? []).filter(x => !x.company);
              return own.length ? own.map(x => quayTitle(x)).join(' · ') : 'Flatholmen';
            })()}
          </span>
        )}
        <VesselLayer project={project} vessels={vessels} calls={list} selectedId={selected?.id} onSelect={id => select(id)}
          quayPos={quayPos} today={today} card={card} />
        {shipSel && selShip && (() => {
          const pt = project(selShip.lon, selShip.lat);
          return pt && <ShipCard v={selShip} x={pt[0]} y={pt[1]} now={now.getTime()} fence={fence} trackError={track24.data?.error ?? null} onClose={() => setShipSel(null)} />;
        })()}
        {focus && !traffic.some(v => v.mmsi === focus.mmsi) && (() => {
          const pt = project(focus.lon, focus.lat);
          return pt && (
            <span style={{ position: 'absolute', left: pt[0], top: pt[1], transform: 'translate(-9px, -9px)', display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
              <span className="ping" style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--aqua)', border: '3px solid #1A231E' }} />
              <span className="vessel-label">{focus.name || `MMSI ${focus.mmsi}`}</span>
            </span>
          );
        })()}
        {/* Valgt båt uten posisjon: kortet festes ved kaia. */}
        {selected && !selectedOnMap && quayPt && card(quayPt[0], quayPt[1])}
      </>
    );
  };

  return (
    <div className={`kart${selected ? ' has-sel' : ''}${tlOpen ? ' tl-open' : ''}`}>
      <Sidebar />
      <div className="kart-mapwrap" style={{ position: 'absolute', inset: 0 }}>
        {settings.isSuccess && (
          <FlowMap ref={mapRef} center={focus ? [focus.lon, focus.lat] : [fence.lon - 0.06, fence.lat + 0.004]} zoom={focus ? 12.5 : 11.4}
            padding={{ top: 120, bottom: 160, left: 120, right: 320 }} geofence={fence} overlays={overlays} basemap={basemap}
            traffic={layers} onShipClick={pickShip} onZoomNames={setZoomNames} />
        )}
        <span className="kart-attr ov-hide">{attribution(basemap)}</span>
      </div>

      <div className="ov kart-top">
        <Topbar glass alertsOpen={alertsOpen} onAlerts={setAlertsOpen} center={<BoatTabs />} />
      </div>

      {!selected && !shipSel && <MainStats />}

      <div className="ov kart-zoom">
        <div role="group" aria-label="Kartvisning" className="pill seg" style={{ backdropFilter: 'blur(16px)', background: 'rgba(32,42,36,.7)', marginRight: 8 }}>
          {BASEMAPS.map(b => (
            <button key={b.value} type="button" className="tab" aria-pressed={basemap === b.value} onClick={() => pickBasemap(b.value)}
              style={{ minHeight: 32, padding: '0 12px', fontSize: 13 }}>{b.label}</button>
          ))}
        </div>
        <button type="button" className="zoom-btn" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom inn"><Plus size={16} /></button>
        <button type="button" className="zoom-btn" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom ut"><Minus size={16} /></button>
        <button type="button" className="zoom-btn solid" onClick={() => mapRef.current?.flyTo(fence.lon, fence.lat, 14)} aria-label="Sentrer på kaia"><Target size={17} /></button>
      </div>

      <TrafficLegend />

      <Timeline calls={todays.filter(c => c.time_known)} untimed={todays.filter(c => !c.time_known && c.status !== 'ferdig').length} selected={selected?.id} onSelect={select} now={now} quays={quays.data ?? []} open={tlOpen} onToggle={toggleTl} />

      {alertsOpen && <div className="ov kart-alerts"><AlertsPanel onClose={() => setAlertsOpen(false)} /></div>}

      {selected && (
        <aside className="ov glass scroll kart-right" aria-label="Valgt anløp">
          <CallDetail call={selected} tab={tab} onTab={t => select(selected.id, t)} onOpenKaibok={() => setKaibok(true)}
            onOpenAlerts={() => setAlertsOpen(true)} onClose={deselect} />
        </aside>
      )}

      {kaibok && selected && <KaibokModal call={selected} onClose={() => setKaibok(false)} />}
    </div>
  );
}

const PERIODS = [7, 30, 90, 180] as const;

/** Hovedtall: tonn utlevert (og mottatt) siste 7/30/90/180 dager mot perioden før. */
function MainStats() {
  const [days, setDays] = useState<number>(() => {
    try { const v = Number(localStorage.getItem('flow-periode')); return PERIODS.includes(v as 30) ? v : 30; } catch { return 30; }
  });
  const pick = (d: number) => { setDays(d); try { localStorage.setItem('flow-periode', String(d)); } catch { /* ignorer */ } };
  const sum = useSummary(days);
  const d = sum.data;
  const change = (a: number, b: number) => {
    if (!b) return null;
    const p = Math.round((a / b - 1) * 100);
    return { text: `${p > 0 ? '+' : p < 0 ? '−' : '±'}${Math.abs(p)} %`, up: p >= 0 };
  };
  const main = d && change(d.out.tonnes, d.prev.out.tonnes);
  return (
    <aside className="ov kart-stats" aria-label="Hovedtall">
      <h2 style={{ margin: 0, fontSize: 32, fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1.08 }}>Hovedtall</h2>
      <div role="group" aria-label="Periode" style={{ display: 'flex', gap: 4 }}>
        {PERIODS.map(p => (
          <button key={p} type="button" className="tab" aria-pressed={days === p} onClick={() => pick(p)} style={{ minHeight: 32, padding: '0 11px', fontSize: 13 }}>
            {p} d
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14, color: 'var(--sage)' }}>Tonn utlevert</span>
        <span className="n" style={{ fontSize: 52, fontWeight: 200, lineHeight: 1.02, letterSpacing: '-0.03em' }}>{d ? nb(d.out.tonnes) : '–'}</span>
        {main && (
          <span className="n" style={{ fontSize: 13, color: main.up ? 'var(--aqua)' : 'var(--bad-fg)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <TrendUp size={14} style={main.up ? undefined : { transform: 'scaleY(-1)' }} />{main.text} mot forrige {days} d
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 13, color: 'var(--sage)' }}>Mottatt</span>
          <span className="n" style={{ fontSize: 26, fontWeight: 300 }}>{d ? nb(d.in.tonnes) : '–'}<span style={{ fontSize: 14, color: 'var(--fg-55)' }}> t</span></span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 13, color: 'var(--sage)' }}>Anløp</span>
          <span className="n" style={{ fontSize: 26, fontWeight: 300 }}>{d ? nb(d.calls) : '–'}</span>
        </div>
      </div>
    </aside>
  );
}

/** Flytende kort ved valgt båt/kai: nedtelling til ankomst eller planlagt avgang. */
function MapCard({ call, x, y, now, today, onChat, approach }: { call: PortCallView; x: number; y: number; now: Date; today: string; onChat: () => void; approach?: Approach | null }) {
  const eta = Date.parse(call.eta);
  const mins = Math.round((eta - now.getTime()) / 60_000);
  const kai = quayLabel(call.quay);
  let sub = call.quay.company ? `Neste · nabo ${quayTitle(call.quay)}` : `Neste: Vår kai · ${quayTitle(call.quay)}`;
  let big = osloTime(call.eta).slice(0, 2), dim = osloTime(call.eta).slice(2);
  let foot = call.service_date === today ? `ETA ${osloTime(call.eta)}` : `ETA ${call.service_date === addDays(today, 1) ? 'i morgen' : call.service_date.slice(8, 10) + '.' + call.service_date.slice(5, 7)}`;
  if (call.status === 'ved_kai' && !call.time_known) {
    sub = `Ved kai · ${kai}`; big = 'Ved'; dim = ' kai'; foot = 'Avgang ikke satt';
  } else if (call.status === 'ved_kai') {
    sub = `Ved kai · ${kai}`; big = osloTime(call.etd).slice(0, 2); dim = osloTime(call.etd).slice(2); foot = 'Planlagt avgang';
  } else if (call.status === 'ferdig') {
    sub = `Ferdig · ${kai}`; big = osloTime(call.etd).slice(0, 2); dim = osloTime(call.etd).slice(2); foot = 'Kaibok levert';
  } else if (call.status === 'kaibok_mangler') {
    sub = `Kaibok mangler · ${kai}`; big = osloTime(call.etd).slice(0, 2); dim = osloTime(call.etd).slice(2); foot = 'ETD passert – fyll ut kaibok';
  } else if (!call.time_known) {
    big = '––'; dim = ':––'; foot = `${call.service_date === today ? 'I dag' : call.service_date === addDays(today, 1) ? 'I morgen' : call.service_date.slice(8, 10) + '.' + call.service_date.slice(5, 7)} · klokkeslett ikke satt`;
  } else if (call.service_date === today && mins > 0) {
    big = String(Math.floor(mins / 60)); dim = ` t ${String(mins % 60).padStart(2, '0')} min`; foot = `til ankomst · ETA ${osloTime(call.eta)}`;
  }
  // Kortet legges til høyre for punktet, eller til venstre hvis det ikke får plass.
  const left = x + 52 + 248 > window.innerWidth - 420 ? x - 52 - 248 : x + 52;
  const top = Math.min(Math.max(y + 44, 230), window.innerHeight - 240 - 170);
  return (
    <div className="glass ov-hide" style={{ position: 'absolute', left, top, width: 248, padding: '18px 18px 16px', borderRadius: 22, background: 'rgba(51,64,56,.5)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 16 }}>{call.boat.name}</span>
          <span style={{ fontSize: 13, color: 'var(--fg-62)' }}>{sub}</span>
        </div>
        <button type="button" className="icon-btn" onClick={onChat} aria-label="Åpne chat for anløpet" style={{ width: 36, height: 36, background: 'var(--aqua)', color: 'var(--ink)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7" /><path d="M8 7h9v9" /></svg>
        </button>
      </div>
      <span className="n" style={{ fontSize: 46, fontWeight: 200, letterSpacing: '-0.02em', lineHeight: 1.1, marginTop: 10 }}>{big}<span style={{ color: 'var(--fg-45)' }}>{dim}</span></span>
      <span style={{ fontSize: 13, color: 'var(--fg-62)' }}>{foot}</span>
      {approach && call.status !== 'ved_kai' && call.status !== 'ferdig' && (
        <span className="n" style={{ fontSize: 13, color: 'var(--aqua)', marginTop: 6 }}>AIS: {approachText(approach)}</span>
      )}
    </div>
  );
}

/** Luftlinje til kaia og tid dit med farten fartøyet holder nå. */
interface Approach { nm: number; knots: number | null; minutes: number | null }

function approach(v: TrafficVessel, fence: { lat: number; lon: number }): Approach {
  const nm = distanceM(v, fence) / 1852;
  const moving = (v.sog ?? 0) >= MOVING_KNOTS;
  return { nm, knots: v.sog, minutes: moving ? (nm / v.sog!) * 60 : null };
}

function approachText(a: Approach) {
  const when = a.minutes == null ? 'ligger stille' : a.minutes < 90 ? `ca. ${Math.round(a.minutes)} min` : `ca. ${fr(a.minutes / 60)} t`;
  return `${fr(a.nm)} nm til kaia · ${when}${a.knots != null && a.minutes != null ? ` i ${fr(a.knots)} kn` : ''}`;
}

/** Info om et fartøy i trafikkbildet, som når man klikker et skip i Kystverkets kart. */
function ShipCard({ v, x, y, now, fence, trackError, onClose }: {
  v: TrafficVessel; x: number; y: number; now: number; fence: { lat: number; lon: number }; trackError: string | null; onClose: () => void;
}) {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = v.info;
  const name = v.name ? titleCase(v.name) : `MMSI ${v.mmsi}`;
  const type = v.cat === 'flow' ? 'Vår båt' : shipTypeLabel(info?.ship_type) ?? 'Ukjent type';
  const a = approach(v, fence);
  const add = async () => {
    setBusy(true); setError(null);
    try {
      const b = await api<BoatDetail>('/boats', { body: { name, mmsi: v.mmsi, imo: info?.imo && /^\d{7}$/.test(info.imo) ? info.imo : null, callsign: info?.callsign ?? null } });
      qc.invalidateQueries({ queryKey: ['boats'] });
      qc.invalidateQueries({ queryKey: ['ais'] });
      navigate(`/baater?id=${b.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const left = x + 34 + 300 > window.innerWidth - 24 ? x - 34 - 300 : x + 34;
  const top = Math.min(Math.max(y - 60, 110), window.innerHeight - 420);
  const cell = (k: string, val: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flex: 1 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{k}</span>
      <span className="n" style={{ fontSize: 14, color: 'var(--fg-75)' }}>{val}</span>
    </div>
  );
  return (
    <div className="glass ov-hide" role="dialog" aria-label={`Fartøy ${name}`}
      style={{ position: 'absolute', left, top, width: 300, padding: 16, borderRadius: 18, background: 'rgba(30,34,38,.88)', display: 'flex', flexDirection: 'column', gap: 12, zIndex: 6 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(242,245,243,.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <span style={{ width: 12, height: 22, background: CATEGORY_COLOR[v.cat], clipPath: 'polygon(50% 0, 100% 30%, 100% 100%, 0 100%, 0 30%)', transform: 'rotate(30deg)' }} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 17, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          <span style={{ fontSize: 13, color: 'var(--fg-62)' }}>
            {[info?.country, info?.callsign, type].filter(Boolean).join(' · ')}
          </span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Lukk" style={{ width: 32, height: 32 }}><Close size={14} /></button>
      </div>
      <div style={{ display: 'flex', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
        {cell('Stevning', v.heading != null ? `${Math.round(v.heading)}°` : '–')}
        {cell('Kurs', v.cog != null ? `${fr(v.cog)}°` : '–')}
        {cell('Fart', v.sog != null ? `${fr(v.sog)} kn` : '–')}
      </div>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 12px', fontSize: 13 }}>
        {info?.destination && <><dt style={{ fontWeight: 600 }}>Destinasjon</dt><dd style={{ margin: 0, textAlign: 'right' }}>{info.destination}</dd></>}
        {info?.length && <><dt style={{ fontWeight: 600 }}>Størrelse</dt><dd className="n" style={{ margin: 0, textAlign: 'right' }}>{fr(info.length, 0)} × {info.width ? fr(info.width, 0) : '–'} m{info.draught ? ` · ${fr(info.draught)} m dypg.` : ''}</dd></>}
        <dt style={{ fontWeight: 600 }}>Posisjon</dt>
        <dd className="n" style={{ margin: 0, textAlign: 'right' }}>{degMin(v.lat, 'N', 'S')}, {degMin(v.lon, 'Ø', 'V')}</dd>
        <dt style={{ fontWeight: 600 }}>Oppdatert</dt>
        <dd className="n" style={{ margin: 0, textAlign: 'right' }}>{osloTime(v.ts)} · {ago(v.ts, now)}</dd>
      </dl>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 10px', borderRadius: 12, background: 'rgba(128,239,222,.08)' }}>
        <span style={{ fontSize: 12, color: 'var(--fg-62)' }}>Til vår kai (luftlinje)</span>
        <span className="n" style={{ fontSize: 14, color: 'var(--aqua)' }}>{approachText(a)}</span>
      </div>
      <span style={{ fontSize: 12, color: 'var(--fg-55)' }}>
        Ringene: 6, 12, 24, 36, 48, 60 min og 3 t med farten nå. Turkis linje: sporet siste døgn{trackError ? ` (ikke tilgjengelig: ${trackError})` : ''}.
      </span>
      {error && <div className="error-box">{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        {v.boatId
          ? <button type="button" className="btn" style={{ minHeight: 36, fontSize: 13 }} onClick={() => navigate(`/baater?id=${v.boatId}`)}>Åpne i båtregisteret</button>
          : canBoats(me.data) && <button type="button" className="btn btn-w" style={{ minHeight: 36, fontSize: 13 }} disabled={busy} onClick={add}>Legg til i båtregisteret</button>}
      </div>
    </div>
  );
}

/** Fargeforklaring for skipstypene. */
export function TrafficLegend() {
  return (
    <div className="ov kart-legend ov-hide" aria-label="Fargeforklaring">
      {(Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).filter(k => k !== 'hurtig').map(k => (
        <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 13, background: CATEGORY_COLOR[k], clipPath: 'polygon(50% 0, 100% 30%, 100% 100%, 0 100%, 0 30%)' }} />{CATEGORY_LABEL[k]}
        </span>
      ))}
    </div>
  );
}

/** Kaibelegg i dag: én bane per kai, kollisjoner skravert, strek for nå. */
function Timeline({ calls, untimed, selected, onSelect, now, quays, open, onToggle }: {
  calls: PortCallView[]; untimed: number; selected?: string; onSelect: (id: string) => void; now: Date;
  quays: { id: string; name: string; nickname: string | null; company: string | null }[];
  open: boolean; onToggle: () => void;
}) {
  const hour = (iso: string) => { const [h, m] = osloTime(iso).split(':').map(Number); return h + m / 60; };
  const t0 = Math.min(5, ...calls.map(c => Math.floor(hour(c.eta))));
  const t1 = Math.max(20, ...calls.map(c => Math.min(24, Math.ceil(hour(c.etd) < hour(c.eta) ? 24 : hour(c.etd)))));
  const pct = (h: number) => ((h - t0) / (t1 - t0)) * 100;
  const remaining = calls.filter(c => c.status !== 'ferdig').length;
  const zones = useMemo(() => {
    const seen = new Set<string>();
    return calls.flatMap(c => c.collisions.filter(x => x.kind === 'quay')).filter(z => {
      const k = `${z.calls.join()}`; if (seen.has(k)) return false; seen.add(k); return true;
    });
  }, [calls]);
  const ticks: number[] = [];
  for (let h = Math.ceil(t0 / 2) * 2; h <= t1; h += 2) ticks.push(h);
  const nowH = hour(now.toISOString());

  if (!open) {
    // Sammenlagt: én smal stripe med en minitidslinje per kai.
    const ownQuays = quays.filter(q => isOwnQuay(q) || calls.some(c => c.quay.id === q.id));
    return (
      <section className="ov glass kart-tl kart-tl-mini" aria-label="Kaibelegg i dag">
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 150 }}>
          <span style={{ fontSize: 15 }}>Kaibelegg i dag</span>
          <span style={{ fontSize: 12, color: 'var(--fg-62)' }}>
            {remaining} gjenstår{untimed ? ` · ${untimed} uten tid` : ''}{zones.length ? <> · <span style={{ color: 'var(--bad-fg)' }}>{zones.length} {zones.length === 1 ? 'kollisjon' : 'kollisjoner'}</span></> : ''}
          </span>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }} aria-hidden="true">
          {ownQuays.map(qy => (
            <div key={qy.id} style={{ position: 'relative', height: 7, borderRadius: 4, background: 'rgba(var(--tint), .08)' }}>
              {calls.filter(c => c.quay.id === qy.id).map(c => {
                const a = hour(c.eta), b = Math.max(a + 0.25, hour(c.etd) < a ? 24 : hour(c.etd));
                return <span key={c.id} style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%`, borderRadius: 4, background: c.collisions.length ? 'var(--red-soft)' : STATUS_STYLE[c.status].c, opacity: c.status === 'ferdig' ? .4 : .85 }} />;
              })}
              {nowH >= t0 && nowH <= t1 && <span style={{ position: 'absolute', top: -3, bottom: -3, width: 2, background: 'var(--fg)', left: `${pct(nowH)}%` }} />}
            </div>
          ))}
        </div>
        <button type="button" className="btn" onClick={onToggle} aria-expanded={false} style={{ minHeight: 36, fontSize: 13, padding: '0 14px' }}>Vis</button>
      </section>
    );
  }

  return (
    <section className="ov panel-light kart-tl" aria-labelledby="tl-h">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 id="tl-h" style={{ margin: 0, fontSize: 26, fontWeight: 300, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 12 }}>
            Kaibelegg i dag
            <button type="button" className="btn" onClick={onToggle} aria-expanded={true} style={{ minHeight: 32, fontSize: 13, padding: '0 12px' }}>Skjul</button>
          </h2>
          <span style={{ fontSize: 13, color: 'var(--fg-62)' }}>{remaining} gjenstående anløp{untimed ? ` · ${untimed} uten tid` : ''} · {zones.length} {zones.length === 1 ? 'kollisjon' : 'kollisjoner'}</span>
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--fg-62)', flexWrap: 'wrap' }}>
          {(['ved_kai', 'paa_vei'] as const).map(s => (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ width: 8, height: 8, background: `color-mix(in srgb, ${STATUS_STYLE[s].c} 70%, #1A231E)` }} />{STATUS_STYLE[s].label}</span>
          ))}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="hatch" style={{ width: 12, height: 8, borderRadius: 2, border: '1px dashed #FF6B5E' }} />Kollisjon</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ width: 7, height: 7, background: '#B1C2B7' }} />Ferdig</span>
        </div>
      </div>
      <div style={{ overflowX: 'auto', flex: 1 }}>
        <div style={{ minWidth: 520, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {quays.map(qy => (
            <div key={qy.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 118, flex: 'none', paddingRight: 4 }}>
                <QuayMark quay={qy} compact />
              </div>
              <div style={{
                position: 'relative', flex: 1, height: 38, borderRadius: 12,
                background: isOwnQuay(qy) ? 'rgba(26,35,30,.05)' : 'rgba(232,176,110,.12)',
                outline: isOwnQuay(qy) ? undefined : '1px solid rgba(232,176,110,.18)',
              }}>
                {calls.filter(c => c.quay.id === qy.id).map(c => {
                  const s = STATUS_STYLE[c.status];
                  const a = hour(c.eta), b = Math.max(a + 0.25, hour(c.etd) < a ? 24 : hour(c.etd));
                  return (
                    <button key={c.id} type="button" onClick={() => onSelect(c.id)} aria-label={`${c.boat.name}, ${timeRange(c)}, ${s.label}`}
                      style={{ position: 'absolute', top: 4, bottom: 4, left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%`, borderRadius: 9, padding: '0 10px', fontSize: 12, cursor: 'pointer', textAlign: 'left', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: 'var(--fg)', background: `color-mix(in srgb, ${s.solid.startsWith('#') ? s.solid : s.c} 28%, #F2F5F3)`, border: `1.5px solid ${selected === c.id ? 'var(--fg)' : `color-mix(in srgb, ${s.c} 60%, #1A231E)`}` }}>
                      {c.boat.name}
                    </button>
                  );
                })}
                {zones.filter(z => z.kind === 'quay' && z.quay_id === qy.id).map(z => (
                  <div key={z.calls.join()} className="hatch" style={{ position: 'absolute', top: 1, bottom: 1, left: `${pct(hour(z.from))}%`, width: `${pct(hour(z.to)) - pct(hour(z.from))}%`, border: '1px dashed #FF6B5E', borderRadius: 10, pointerEvents: 'none' }} />
                ))}
                {nowH >= t0 && nowH <= t1 && <div style={{ position: 'absolute', top: -3, bottom: -3, width: 2, background: 'var(--teal)', pointerEvents: 'none', left: `${pct(nowH)}%` }} />}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex' }}>
            <div style={{ width: 118, flex: 'none' }} />
            <div style={{ position: 'relative', flex: 1, height: 16 }}>
              {ticks.map(h => <span key={h} className="n" style={{ position: 'absolute', top: 0, transform: 'translateX(-50%)', fontSize: 11, color: 'var(--fg-55)', left: `${pct(h)}%` }}>{String(h % 24).padStart(2, '0')}</span>)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
