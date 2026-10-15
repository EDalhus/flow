import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { PortCallView } from '../../../shared/api.ts';
import { AlertsPanel, useAlerts } from '../components/Alerts.tsx';
import { CallDetail, type DetailTab } from '../components/CallDetail.tsx';
import { Anchor, Minus, Plus, Target, TrendUp } from '../components/Icons.tsx';
import { KaibokModal } from '../components/KaibokForm.tsx';
import { Sidebar, Topbar } from '../components/Topbar.tsx';
import { CallIssues, Loading, QuayMark, Segmented, StatusBadge } from '../components/ui.tsx';
import { ATTRIBUTION, FlowMap, type MapHandle, type Project } from '../map/FlowMap.tsx';
import { STATUS_STYLE, addDays, nb, dayHeading, goodsShort, isOwnQuay, osloTime, quayLabel, quayTitle, timeRange, todayOslo, typeLabel } from '../lib/format.ts';
import { useAis, useMe, usePortCalls, useQuays, useSettings, useSummary } from '../lib/queries.ts';
import { AisCheck } from '../components/AisCheck.tsx';
import { VesselLayer, aisLive } from '../map/Vessels.tsx';
import { useNow } from '../lib/useNow.ts';
import './kart.css';

type Filter = 'alle' | 'levering' | 'henting' | 'kollisjon';
const FALLBACK = { lat: 62.47918, lon: 6.19292 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
const WEEKDAYS = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];

export function KartPage() {
  const now = useNow();
  const today = todayOslo(now);
  const tomorrow = addDays(today, 1);
  const calls = usePortCalls(today, tomorrow);
  const quays = useQuays();
  const settings = useSettings();
  const alerts = useAlerts();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('alle');
  const [q, setQ] = useState('');
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [kaibok, setKaibok] = useState(false);
  const [aisCheck, setAisCheck] = useState(false);
  const me = useMe();
  const isAdmin = !!me.data?.roles.includes('admin');
  const mapRef = useRef<MapHandle>(null);

  const list = calls.data?.calls ?? [];
  const selectedId = params.get('id');
  const tab = (params.get('tab') as DetailTab) ?? 'oversikt';
  // Ingen automatisk valg: detaljpanelet vises bare når et anløp er valgt, så kartet er mest mulig fritt.
  const selected = selectedId ? list.find(c => c.id === selectedId) : undefined;
  const select = (id: string, t?: DetailTab) => setParams(p => { p.set('id', id); if (t) p.set('tab', t); else p.delete('tab'); return p; }, { replace: true });
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

  // Søk: båt, varer, selger, ansvarlig.
  const needle = q.trim().toLowerCase();
  const pass = (c: PortCallView) =>
    (filter === 'alle' || (filter === 'kollisjon' ? c.collisions.length > 0 : c.type === filter)) &&
    (!needle || [c.boat.name, goodsShort(c.goods), c.seller?.name, c.responsible?.name].some(s => s?.toLowerCase().includes(needle)));

  const todays = list.filter(c => c.service_date === today);
  const active = list.filter(c => c.status !== 'ferdig');
  const clashCount = active.filter(c => c.collisions.length).length;
  const groups = [today, tomorrow].map(d => ({
    date: d,
    title: d === today ? 'I dag' : dayHeading(d, today),
    items: list.filter(c => c.service_date === d && pass(c)),
  })).filter(g => g.items.length);

  const flagCount = alerts.flagged.length;
  const alertSummary = [
    alerts.collisions.length && `${alerts.collisions.length} ${alerts.collisions.length === 1 ? 'kollisjon' : 'kollisjoner'}`,
    flagCount && `${flagCount} flagg`,
  ].filter(Boolean).join(' · ');

  const ais = useAis();
  const live = aisLive(ais.data?.status, now);
  const vessels = ais.data?.vessels ?? [];
  const atQuay = list.filter(c => c.status === 'ved_kai' && c.service_date === today);
  const onTheWay = list.filter(c => c.status === 'paa_vei').length;
  const aisText = live
    ? `AIS live · ${vessels.length} fartøy · ${onTheWay} på vei til oss`
    : ais.data?.status?.configured === false ? `AIS ikke tilkoblet${isAdmin ? ' – klikk for å sjekke' : ''}`
    : ais.data?.status?.message ?? `AIS venter på data · ${atQuay.length} ved kai`;

  // Første gang AIS-data finnes: vis kaia og båtene som skal til oss.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !mapRef.current || !vessels.length || !calls.data) return;
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
      else deselectRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const overlays = (project: Project) => {
    const quayPt = project(fence.lon, fence.lat);
    const card = (x: number, y: number) => selected && <MapCard call={selected} x={x} y={y} now={now} today={today} onChat={() => select(selected.id, 'chat')} />;
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
        {/* Valgt båt uten posisjon: kortet festes ved kaia. */}
        {selected && !selectedOnMap && quayPt && card(quayPt[0], quayPt[1])}
      </>
    );
  };

  return (
    <div className={`kart${selected ? ' has-sel' : ''}`}>
      <Sidebar />
      <div className="kart-mapwrap" style={{ position: 'absolute', inset: 0 }}>
        {settings.isSuccess && (
          <FlowMap ref={mapRef} center={[fence.lon - 0.06, fence.lat + 0.004]} zoom={11.4}
            padding={{ top: 120, bottom: 236, left: 520, right: 320 }} geofence={fence} overlays={overlays} />
        )}
        <span className="kart-attr ov-hide">{ATTRIBUTION}</span>
      </div>

      <div className="ov kart-top">
        <Topbar glass alertsOpen={alertsOpen} onAlerts={setAlertsOpen}
          search={
            <label className="pill ov-hide" style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 46, padding: '0 16px', width: 280, backdropFilter: 'blur(16px)' }}>
              <span className="sr">Søk</span>
              <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Søk båt, vare eller selger"
                style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', color: 'var(--fg)', fontSize: 14, outlineOffset: 6 }} />
            </label>
          } />
      </div>

      <div className="ov kart-title">
        <h1 style={{ margin: 0, fontSize: 76, fontWeight: 300, letterSpacing: '-0.04em', lineHeight: 1, textShadow: '0 2px 30px rgba(0,0,0,.45)' }}>Flatholmen</h1>
        <div style={{ display: 'flex', gap: 10, pointerEvents: 'auto', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
          <button type="button" onClick={isAdmin ? () => setAisCheck(!aisCheck) : undefined} aria-expanded={isAdmin ? aisCheck : undefined}
            title={`${aisText}${ais.data?.status?.checked_at ? ` (sjekket ${osloTime(ais.data.status.checked_at)})` : ''}${isAdmin ? ' – klikk for å sjekke' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 36, padding: '0 6px', background: 'none', border: 'none', cursor: isAdmin ? 'pointer' : 'default', color: 'var(--fg)' }}>
            <span className={live ? 'dot ping' : 'dot'} style={{ width: 8, height: 8, background: live ? 'var(--aqua)' : 'var(--sage)' }} />
            <span className="eyebrow" style={{ color: 'var(--fg)' }}>{live ? 'AIS live' : ais.data?.status?.configured === false ? 'AIS ikke tilkoblet' : 'AIS venter'}</span>
            <span className="n" style={{ fontSize: 15, color: 'var(--sage)' }}>
              {WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()].slice(0, 3)} {Number(today.slice(8))}. {MONTHS[Number(today.slice(5, 7)) - 1]} · {osloTime(now)}
            </span>
          </button>
          {alertSummary && (
            <button type="button" className="pill" onClick={() => setAlertsOpen(!alertsOpen)} aria-expanded={alertsOpen}
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '0 14px', backdropFilter: 'blur(16px)', background: 'rgba(120,42,38,.55)', borderColor: 'rgba(255,107,94,.25)', fontSize: 13 }}>
              <span className="dot" style={{ width: 7, height: 7, background: '#E5484D' }} />{alertSummary}
            </button>
          )}
        </div>
        {aisCheck && <div style={{ pointerEvents: 'auto', textAlign: 'left' }}><AisCheck onClose={() => setAisCheck(false)} /></div>}
      </div>

      <aside className="ov glass scroll kart-left" aria-label="Anløp">
        <span className="eyebrow" style={{ padding: '4px 6px 0' }}>Anløp i dag og i morgen</span>
        <div style={{ display: 'flex', gap: 8, padding: '0 6px', fontSize: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ width: 8, height: 8, background: 'var(--green)' }} />{active.length - clashCount} i rute</span>
          {clashCount > 0 && (
            <button type="button" onClick={() => setFilter('kollisjon')} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--bad-fg)' }}>
              <span className="dot" style={{ width: 8, height: 8, background: 'var(--red)' }} />{clashCount} {clashCount === 1 ? 'kollisjon' : 'kollisjoner'}
            </button>
          )}
        </div>
        <Segmented<Filter> label="Filter" value={filter} onChange={setFilter} stretch
          options={[{ value: 'alle', label: 'Alle' }, { value: 'levering', label: 'Levering' }, { value: 'henting', label: 'Henting' }, { value: 'kollisjon', label: 'Kollisjon' }]} />
        {calls.isPending && <Loading />}
        {groups.map(g => (
          <div key={g.date} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 style={{ margin: '4px 4px 0', fontSize: 13, fontWeight: 400, color: 'var(--fg-62)' }}>{g.title}</h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {g.items.map(c => <li key={c.id}><CallCard call={c} on={c.id === selected?.id} onClick={() => (c.id === selected?.id ? deselect() : select(c.id))} /></li>)}
            </ul>
          </div>
        ))}
        {calls.isSuccess && !groups.length && <p className="empty" style={{ padding: 20 }}>Ingen anløp i dette filteret.</p>}
      </aside>

      {!selected && <MainStats />}

      <div className="ov kart-zoom">
        <span style={{ fontSize: 15, marginRight: 6 }}>Zoom</span>
        <button type="button" className="zoom-btn" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom inn"><Plus size={16} /></button>
        <button type="button" className="zoom-btn" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom ut"><Minus size={16} /></button>
        <button type="button" className="zoom-btn solid" onClick={() => mapRef.current?.flyTo(fence.lon, fence.lat, 14)} aria-label="Sentrer på kaia"><Target size={17} /></button>
      </div>

      <Timeline calls={todays} selected={selected?.id} onSelect={select} now={now} quays={quays.data ?? []} />

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

function CallCard({ call: c, on, onClick }: { call: PortCallView; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`card${on ? ' on' : ''}${c.status === 'ferdig' ? ' done' : ''}`} onClick={onClick} aria-pressed={on} style={{ gap: 8, padding: '14px 16px' }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, width: '100%' }}>
        <span style={{ fontSize: 18, letterSpacing: '-0.01em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.boat.name}</span>
        <StatusBadge status={c.status} basis={c.status_basis} />
      </span>
      <span className="n" style={{ fontSize: 13, color: 'var(--fg-62)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span>{timeRange(c)}</span><span aria-hidden="true">·</span><QuayMark quay={c.quay} compact /><span aria-hidden="true">·</span><span>{typeLabel(c.type)}</span>
      </span>
      <span style={{ fontSize: 13, color: 'var(--fg-75)', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{goodsShort(c.goods)}</span>
      <CallIssues call={c} />
    </button>
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
function MapCard({ call, x, y, now, today, onChat }: { call: PortCallView; x: number; y: number; now: Date; today: string; onChat: () => void }) {
  const eta = Date.parse(call.eta);
  const mins = Math.round((eta - now.getTime()) / 60_000);
  const kai = quayLabel(call.quay);
  let sub = call.quay.company ? `Neste · nabo ${quayTitle(call.quay)}` : `Neste: Vår kai · ${quayTitle(call.quay)}`;
  let big = osloTime(call.eta).slice(0, 2), dim = osloTime(call.eta).slice(2);
  let foot = call.service_date === today ? `ETA ${osloTime(call.eta)}` : `ETA ${call.service_date === addDays(today, 1) ? 'i morgen' : call.service_date.slice(8, 10) + '.' + call.service_date.slice(5, 7)}`;
  if (call.status === 'ved_kai') {
    sub = `Ved kai · ${kai}`; big = osloTime(call.etd).slice(0, 2); dim = osloTime(call.etd).slice(2); foot = 'Planlagt avgang';
  } else if (call.status === 'ferdig') {
    sub = `Ferdig · ${kai}`; big = osloTime(call.etd).slice(0, 2); dim = osloTime(call.etd).slice(2); foot = 'Kaibok levert';
  } else if (call.status === 'kaibok_mangler') {
    sub = `Kaibok mangler · ${kai}`; big = osloTime(call.etd).slice(0, 2); dim = osloTime(call.etd).slice(2); foot = 'ETD passert – fyll ut kaibok';
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
    </div>
  );
}

/** Kaibelegg i dag: én bane per kai, kollisjoner skravert, strek for nå. */
function Timeline({ calls, selected, onSelect, now, quays }: {
  calls: PortCallView[]; selected?: string; onSelect: (id: string) => void; now: Date;
  quays: { id: string; name: string; nickname: string | null; company: string | null }[];
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

  return (
    <section className="ov panel-light kart-tl" aria-labelledby="tl-h">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 id="tl-h" style={{ margin: 0, fontSize: 26, fontWeight: 300, letterSpacing: '-0.02em' }}>Kaibelegg i dag</h2>
          <span style={{ fontSize: 13, color: 'var(--fg-62)' }}>{remaining} gjenstående anløp · {zones.length} {zones.length === 1 ? 'kollisjon' : 'kollisjoner'}</span>
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
