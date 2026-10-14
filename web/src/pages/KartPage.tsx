import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { PortCallView } from '../../../shared/api.ts';
import { AlertsPanel, useAlerts } from '../components/Alerts.tsx';
import { CallDetail, type DetailTab } from '../components/CallDetail.tsx';
import { Anchor, Check, Clock, Minus, Plus, Target, Warning } from '../components/Icons.tsx';
import { KaibokModal } from '../components/KaibokForm.tsx';
import { Topbar } from '../components/Topbar.tsx';
import { FlagBadge, Loading, Rating, Segmented, StatusBadge } from '../components/ui.tsx';
import { ATTRIBUTION, FlowMap, type MapHandle, type Project } from '../map/FlowMap.tsx';
import { STATUS_STYLE, addDays, crewSummary, dayHeading, goodsShort, osloTime, timeRange, todayOslo, typeLabel } from '../lib/format.ts';
import { useAis, usePortCalls, useQuays, useSettings } from '../lib/queries.ts';
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
  const mapRef = useRef<MapHandle>(null);

  const list = calls.data?.calls ?? [];
  const selectedId = params.get('id');
  const tab = (params.get('tab') as DetailTab) ?? 'oversikt';
  const selected = list.find(c => c.id === selectedId)
    ?? list.find(c => c.service_date === today && c.status !== 'ferdig')
    ?? list[0];
  const select = (id: string, t?: DetailTab) => setParams(p => { p.set('id', id); if (t) p.set('tab', t); else p.delete('tab'); return p; }, { replace: true });

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
  const counts = [
    { n: todays.length, label: 'i dag' },
    { n: list.filter(c => c.status === 'ved_kai').length, label: 'ved kai' },
    { n: list.filter(c => c.status === 'paa_vei').length, label: 'på vei' },
    { n: list.filter(c => c.service_date === tomorrow).length, label: 'i morgen' },
  ];
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
    : ais.data?.status?.configured === false ? `AIS ikke tilkoblet · ${atQuay.length} ved kai`
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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAlertsOpen(false);
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
          <span style={{ position: 'absolute', left: quayPt[0], top: quayPt[1], transform: 'translate(-50%, -150%)', display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(243,245,246,.95)', color: '#0B0E11', borderRadius: 999, padding: '4px 10px 4px 6px', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#0B0E11', color: '#F3F5F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Anchor size={11} /></span>
            Vår kai · {quays.data?.length ? `Kai ${quays.data.map(x => x.name.replace('Kai ', '')).join('–')}` : 'Flatholmen'}
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
    <div className="kart">
      <div className="kart-mapwrap" style={{ position: 'absolute', inset: 0 }}>
        {settings.isSuccess && (
          <FlowMap ref={mapRef} center={[fence.lon - 0.06, fence.lat + 0.004]} zoom={11.4}
            padding={{ top: 96, bottom: 228, left: 404, right: 404 }} geofence={fence} overlays={overlays} />
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
        <h1 style={{ margin: 0, fontSize: 60, fontWeight: 300, letterSpacing: '-0.035em', lineHeight: 1, textShadow: '0 2px 24px rgba(0,0,0,.5)' }}>Flatholmen</h1>
        <div style={{ display: 'flex', gap: 8, pointerEvents: 'auto', flexWrap: 'wrap' }}>
          <span className="pill" style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 42, padding: '0 16px', backdropFilter: 'blur(16px)', background: 'rgba(17,21,25,.55)', fontSize: 14 }}>
            <Clock size={16} />
            <span>{WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()]} {Number(today.slice(8))}. {MONTHS[Number(today.slice(5, 7)) - 1]} · <span className="n">{osloTime(now)}</span></span>
          </span>
          <span className="pill" title={ais.data?.status?.checked_at ? `Sist sjekket ${osloTime(ais.data.status.checked_at)}` : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 42, padding: '0 16px', backdropFilter: 'blur(16px)', background: 'rgba(17,21,25,.55)', fontSize: 14 }}>
            <span className={live ? 'dot ping' : 'dot'} style={{ width: 8, height: 8, background: live ? '#5BD68A' : '#A3ACB3' }} />
            {aisText}
          </span>
          {alertSummary && (
            <button type="button" className="pill" onClick={() => setAlertsOpen(!alertsOpen)} aria-expanded={alertsOpen}
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, minHeight: 42, padding: '0 16px', backdropFilter: 'blur(16px)', background: 'rgba(120,42,38,.55)', borderColor: 'rgba(255,107,94,.25)', fontSize: 14 }}>
              <span className="dot" style={{ width: 8, height: 8, background: '#E5484D' }} />{alertSummary}
            </button>
          )}
        </div>
      </div>

      <aside className="ov glass scroll kart-left" aria-label="Anløp">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
          {counts.map(c => (
            <div key={c.label} className="pill" style={{ minHeight: 52, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.2, borderRadius: 18 }}>
              <span className="n" style={{ fontSize: 17 }}>{c.n}</span>
              <span style={{ fontSize: 12, color: 'var(--fg-62)' }}>{c.label}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          <Stat icon={<span style={{ width: 22, height: 22, borderRadius: '50%', background: '#5BD68A', color: '#0B0E11', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={13} strokeWidth={3} /></span>}
            label="I rute" value={active.length - clashCount} />
          <Stat icon={<Warning />} label="Kollisjon" value={clashCount} onClick={clashCount ? () => setFilter('kollisjon') : undefined} />
        </div>
        <Segmented<Filter> label="Filter" value={filter} onChange={setFilter} stretch
          options={[{ value: 'alle', label: 'Alle' }, { value: 'levering', label: 'Levering' }, { value: 'henting', label: 'Henting' }, { value: 'kollisjon', label: 'Kollisjon' }]} />
        {calls.isPending && <Loading />}
        {groups.map(g => (
          <div key={g.date} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 style={{ margin: '4px 4px 0', fontSize: 13, fontWeight: 400, color: 'var(--fg-62)' }}>{g.title}</h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {g.items.map(c => <li key={c.id}><CallCard call={c} on={c.id === selected?.id} onClick={() => select(c.id)} /></li>)}
            </ul>
          </div>
        ))}
        {calls.isSuccess && !groups.length && <p className="empty" style={{ padding: 20 }}>Ingen anløp i dette filteret.</p>}
      </aside>

      <div className="ov kart-zoom">
        <button type="button" className="icon-btn glass" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom inn" style={{ borderRadius: '50%' }}><Plus size={18} /></button>
        <button type="button" className="icon-btn glass" onClick={() => mapRef.current?.flyTo(fence.lon, fence.lat, 14)} aria-label="Sentrer på kaia" style={{ borderRadius: '50%' }}><Target size={19} /></button>
        <button type="button" className="icon-btn glass" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom ut" style={{ borderRadius: '50%' }}><Minus size={18} /></button>
      </div>

      <Timeline calls={todays} selected={selected?.id} onSelect={select} now={now} quays={quays.data ?? []} />

      {alertsOpen && <div className="ov kart-alerts"><AlertsPanel onClose={() => setAlertsOpen(false)} /></div>}

      <aside className="ov glass scroll kart-right" aria-label="Valgt anløp">
        {selected
          ? <CallDetail call={selected} tab={tab} onTab={t => select(selected.id, t)} onOpenKaibok={() => setKaibok(true)} onOpenAlerts={() => setAlertsOpen(true)} />
          : calls.isSuccess && <p className="empty">Ingen anløp i dag eller i morgen.</p>}
      </aside>

      {kaibok && selected && <KaibokModal call={selected} onClose={() => setKaibok(false)} />}
    </div>
  );
}

function Stat({ icon, label, value, onClick }: { icon: React.ReactNode; label: string; value: number; onClick?: () => void }) {
  const body = (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{icon}<span style={{ fontSize: 14 }}>{label}</span></div>
      <span className="n" style={{ fontSize: 40, fontWeight: 200, lineHeight: 1 }}>{value}</span>
    </>
  );
  const style: React.CSSProperties = { borderRadius: 20, background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.06)', padding: '14px 16px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', textAlign: 'left' };
  return onClick
    ? <button type="button" onClick={onClick} style={{ ...style, cursor: 'pointer' }}>{body}</button>
    : <div style={style}>{body}</div>;
}

function CallCard({ call: c, on, onClick }: { call: PortCallView; on: boolean; onClick: () => void }) {
  const crew = crewSummary(c);
  const boats = [...new Set(c.collisions.flatMap(x => x.with.map(w => w.boat_name)))];
  return (
    <button type="button" className={`card${on ? ' on' : ''}${c.status === 'ferdig' ? ' done' : ''}`} onClick={onClick} aria-pressed={on}>
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, width: '100%' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 19, letterSpacing: '-0.01em' }}>{c.boat.name}</span>
          <span className="n" style={{ fontSize: 13, color: 'var(--fg-62)' }}>{timeRange(c)} · {c.quay.name} · {typeLabel(c.type)}</span>
        </span>
        <StatusBadge status={c.status} basis={c.status_basis} />
      </span>
      <span style={{ fontSize: 13, color: 'var(--fg-75)' }}>{goodsShort(c.goods)}</span>
      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <FlagBadge flag={c.boat.flag} />
        <Rating value={c.boat.rating_count ? c.boat.avg_total : null} />
        <span style={{ color: crew.ansWarn ? '#F7C873' : 'var(--fg-62)' }}>{crew.ansText}{crew.open ? ` · ${crew.open} uten navn` : ''}</span>
      </span>
      {c.collisions.length > 0 && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#FF8A80', fontSize: 12 }}>
          <span className="dot" style={{ background: '#E5484D' }} />
          {boats.length ? `Kolliderer med ${boats.join(', ')}` : c.collisions[0].text}
        </span>
      )}
    </button>
  );
}

/** Flytende kort ved valgt båt/kai: nedtelling til ankomst eller planlagt avgang. */
function MapCard({ call, x, y, now, today, onChat }: { call: PortCallView; x: number; y: number; now: Date; today: string; onChat: () => void }) {
  const eta = Date.parse(call.eta);
  const mins = Math.round((eta - now.getTime()) / 60_000);
  let sub = `Neste: Vår kai · ${call.quay.name}`;
  let big = osloTime(call.eta).slice(0, 2), dim = osloTime(call.eta).slice(2);
  let foot = call.service_date === today ? `ETA ${osloTime(call.eta)}` : `ETA ${call.service_date === addDays(today, 1) ? 'i morgen' : call.service_date.slice(8, 10) + '.' + call.service_date.slice(5, 7)}`;
  if (call.status === 'ved_kai') {
    sub = `Ved kai · ${call.quay.name}`; big = osloTime(call.etd).slice(0, 2); dim = osloTime(call.etd).slice(2); foot = 'Planlagt avgang';
  } else if (call.status === 'ferdig') {
    sub = `Ferdig · ${call.quay.name}`; big = osloTime(call.etd).slice(0, 2); dim = osloTime(call.etd).slice(2); foot = 'Kaibok levert';
  } else if (call.status === 'kaibok_mangler') {
    sub = `Kaibok mangler · ${call.quay.name}`; big = osloTime(call.etd).slice(0, 2); dim = osloTime(call.etd).slice(2); foot = 'ETD passert – fyll ut kaibok';
  } else if (call.service_date === today && mins > 0) {
    big = String(Math.floor(mins / 60)); dim = ` t ${String(mins % 60).padStart(2, '0')} min`; foot = `til ankomst · ETA ${osloTime(call.eta)}`;
  }
  // Kortet legges til høyre for punktet, eller til venstre hvis det ikke får plass.
  const left = x + 52 + 248 > window.innerWidth - 420 ? x - 52 - 248 : x + 52;
  const top = Math.min(Math.max(y + 44, 230), window.innerHeight - 240 - 170);
  return (
    <div className="glass ov-hide" style={{ position: 'absolute', left, top, width: 248, padding: '18px 18px 16px', borderRadius: 22, background: 'rgba(40,46,44,.5)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 16 }}>{call.boat.name}</span>
          <span style={{ fontSize: 13, color: 'var(--fg-62)' }}>{sub}</span>
        </div>
        <button type="button" className="icon-btn" onClick={onChat} aria-label="Åpne chat for anløpet" style={{ width: 36, height: 36, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)' }}>
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
  calls: PortCallView[]; selected?: string; onSelect: (id: string) => void; now: Date; quays: { id: string; name: string }[];
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
    <section className="ov glass kart-tl" aria-labelledby="tl-h">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 id="tl-h" style={{ margin: 0, fontSize: 16, fontWeight: 400 }}>Kaibelegg i dag</h2>
          <span style={{ fontSize: 13, color: 'var(--fg-62)' }}>{remaining} gjenstående anløp · {zones.length} {zones.length === 1 ? 'kollisjon' : 'kollisjoner'}</span>
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--fg-62)', flexWrap: 'wrap' }}>
          {(['ved_kai', 'paa_vei'] as const).map(s => (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ width: 7, height: 7, background: STATUS_STYLE[s].c }} />{STATUS_STYLE[s].label}</span>
          ))}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="hatch" style={{ width: 12, height: 8, borderRadius: 2, border: '1px dashed #FF6B5E' }} />Kollisjon</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ width: 7, height: 7, background: '#A3ACB3' }} />Ferdig</span>
        </div>
      </div>
      <div style={{ overflowX: 'auto', flex: 1 }}>
        <div style={{ minWidth: 520, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {quays.map(qy => (
            <div key={qy.id} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ width: 52, flex: 'none', fontSize: 13, color: 'var(--fg-62)' }}>{qy.name}</div>
              <div style={{ position: 'relative', flex: 1, height: 38, borderRadius: 12, background: 'rgba(255,255,255,.03)' }}>
                {calls.filter(c => c.quay.id === qy.id).map(c => {
                  const s = STATUS_STYLE[c.status];
                  const a = hour(c.eta), b = Math.max(a + 0.25, hour(c.etd) < a ? 24 : hour(c.etd));
                  return (
                    <button key={c.id} type="button" onClick={() => onSelect(c.id)} aria-label={`${c.boat.name}, ${timeRange(c)}, ${s.label}`}
                      style={{ position: 'absolute', top: 4, bottom: 4, left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%`, borderRadius: 9, padding: '0 10px', fontSize: 12, cursor: 'pointer', textAlign: 'left', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: '#F3F5F6', background: s.bg, border: `1px solid ${selected === c.id ? 'rgba(243,245,246,.85)' : s.c + '55'}` }}>
                      {c.boat.name}
                    </button>
                  );
                })}
                {zones.filter(z => z.kind === 'quay' && z.quay_id === qy.id).map(z => (
                  <div key={z.calls.join()} className="hatch" style={{ position: 'absolute', top: 1, bottom: 1, left: `${pct(hour(z.from))}%`, width: `${pct(hour(z.to)) - pct(hour(z.from))}%`, border: '1px dashed #FF6B5E', borderRadius: 10, pointerEvents: 'none' }} />
                ))}
                {nowH >= t0 && nowH <= t1 && <div style={{ position: 'absolute', top: -3, bottom: -3, width: 1.5, background: '#F3F5F6', pointerEvents: 'none', left: `${pct(nowH)}%` }} />}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex' }}>
            <div style={{ width: 52, flex: 'none' }} />
            <div style={{ position: 'relative', flex: 1, height: 16 }}>
              {ticks.map(h => <span key={h} className="n" style={{ position: 'absolute', top: 0, transform: 'translateX(-50%)', fontSize: 11, color: 'rgba(243,245,246,.5)', left: `${pct(h)}%` }}>{String(h % 24).padStart(2, '0')}</span>)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
