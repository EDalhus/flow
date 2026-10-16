import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { PortCallView } from '../../../shared/api.ts';
import { osloToUtc } from '../../../shared/time.ts';
import { AlertsPanel } from '../components/Alerts.tsx';
import { CallDetail, type DetailTab } from '../components/CallDetail.tsx';
import { Anchor, Minus, Plus, Target, TrendUp } from '../components/Icons.tsx';
import { KaibokModal } from '../components/KaibokForm.tsx';
import { BoatTabs, Sidebar, Topbar } from '../components/Topbar.tsx';
import { QuayMark } from '../components/ui.tsx';
import { BASEMAPS, FlowMap, attribution, type MapHandle, type Project } from '../map/FlowMap.tsx';
import { ShipCard, TrafficLegend, approachLabel, approachText } from '../map/ShipCard.tsx';
import { useBasemap, useTraffic } from '../map/useTraffic.ts';
import { STATUS_STYLE, addDays, dayShort, nb, isOwnQuay, osloTime, quayTitle, timeRange, todayOslo } from '../lib/format.ts';
import { useMe, usePortCalls, useSavePrefs, useQuays, useSettings, useSummary } from '../lib/queries.ts';
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
  // Kaiplanen er lagt sammen som standard, så kartet får fokus. Valget huskes.
  const [tlOpen, setTlOpen] = useState(() => { try { return localStorage.getItem('flow-kaibelegg') === 'open'; } catch { return false; } });
  const toggleTl = () => setTlOpen(o => { try { localStorage.setItem('flow-kaibelegg', o ? 'closed' : 'open'); } catch { /* ignorer */ } return !o; });
  const mapRef = useRef<MapHandle>(null);
  const [basemap, pickBasemap] = useBasemap();

  const list = calls.data?.calls ?? [];
  const selectedId = params.get('id');
  const tab = (params.get('tab') as DetailTab) ?? 'oversikt';
  // Ingen automatisk valg: detaljpanelet vises bare når et anløp er valgt, så kartet er mest mulig fritt.
  const selected = selectedId ? list.find(c => c.id === selectedId) : undefined;
  const fence = settings.data?.geofence ?? { ...FALLBACK, radius_m: 300, label: '' };
  const t = useTraffic(list, selected?.boat.id ?? null, fence);
  const { vessels, traffic, hot, shipSel, setShipSel, selShip, layers, setZoomNames, trackError } = t;
  const select = (id: string, t?: DetailTab) => {
    setShipSel(null);
    setParams(p => { p.set('id', id); if (t) p.set('tab', t); else p.delete('tab'); return p; }, { replace: true });
  };
  const deselect = () => setParams(p => { p.delete('id'); p.delete('tab'); return p; }, { replace: true });
  const deselectRef = useRef(deselect);
  deselectRef.current = deselect;
  const alertsRef = useRef(false);
  alertsRef.current = alertsOpen;

  const quayPos = (id: string) => {
    const qy = quays.data?.find(x => x.id === id);
    return qy?.lat != null && qy.lon != null ? { lat: qy.lat, lon: qy.lon } : fence;
  };


  // Båt med anløp hos oss: åpne anløpet i sidepanelet. Andre båter: skipskortet.
  const pickShip = (mmsi: string | null, callId?: string) => {
    if (callId) { select(callId); return; }
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
    if (focus.mmsi && !hot.has(focus.mmsi)) setShipSel(focus.mmsi);
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
        <VesselLayer project={project} vessels={vessels} calls={list} selectedId={selected?.id} onSelect={id => select(id)} quayPos={quayPos} />
        {shipSel && selShip && (() => {
          const pt = project(selShip.lon, selShip.lat);
          return pt && <ShipCard v={selShip} x={pt[0]} y={pt[1]} now={now.getTime()} approach={t.approach} trackError={trackError} onClose={() => setShipSel(null)} />;
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

      <TrafficLegend showOthers={t.showOthers} setShowOthers={t.setShowOthers} colorOthers={t.colorOthers} setColorOthers={t.setColorOthers} />

      <Timeline today={today} selected={selected?.id} onSelect={select} now={now} quays={quays.data ?? []} open={tlOpen} onToggle={toggleTl} />

      {alertsOpen && <div className="ov kart-alerts"><AlertsPanel onClose={() => setAlertsOpen(false)} /></div>}

      {selected && (
        <aside className="ov glass scroll kart-right" aria-label="Valgt anløp">
          <CallDetail call={selected} tab={tab} onTab={t => select(selected.id, t)} onOpenKaibok={() => setKaibok(true)}
            onOpenAlerts={() => setAlertsOpen(true)} onClose={deselect}
            extra={selShip && t.approach && selected.status !== 'ved_kai' && selected.status !== 'ferdig' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 12px', borderRadius: 14, background: 'rgba(128,239,222,.08)' }}>
                <span style={{ fontSize: 12, color: 'var(--fg-62)' }}>AIS · {approachLabel(t.approach)}</span>
                <span className="n" style={{ fontSize: 14, color: 'var(--aqua)' }}>{approachText(t.approach)}</span>
              </div>
            )} />
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

const PERIODS_TL = [{ days: 1, label: '24 t' }, { days: 3, label: '3 d' }, { days: 7, label: '7 d' }, { days: 14, label: '14 d' }] as const;
type TlDays = (typeof PERIODS_TL)[number]['days'];
const DAY_MS = 86_400_000;

/**
 * Kaiplan: én bane per kai for valgt periode (24 t, 3, 7 eller 14 dager – 7 er standard, og hver bruker velger selv).
 * Kollisjoner skravert, strek for nå. Anløp uten klokkeslett vises som stiplet heldagsfelt.
 * Sammenlagt er den en smal stripe; åpen vokser den oppover. Vis/Skjul-knappen står på samme sted i begge.
 */
function Timeline({ today, selected, onSelect, now, quays, open, onToggle }: {
  today: string; selected?: string; onSelect: (id: string) => void; now: Date;
  quays: { id: string; name: string; nickname: string | null; company: string | null }[];
  open: boolean; onToggle: () => void;
}) {
  const me = useMe();
  const savePrefs = useSavePrefs();
  const days: TlDays = me.data?.prefs?.timeline_days ?? 7;
  const range = usePortCalls(today, addDays(today, days - 1));
  const all = (range.data?.calls ?? []).filter(c => c.status !== 'avlyst');
  const calls = days === 1 ? all.filter(c => c.time_known) : all;
  const untimed = all.filter(c => !c.time_known && c.status !== 'ferdig').length;

  const ms = (iso: string) => Date.parse(iso);
  const start = ms(osloToUtc(today, 0));
  let t0 = start, t1 = ms(osloToUtc(addDays(today, days), 0));
  if (days === 1) {
    // I dag: tett rundt dagens anløp, minst 05–20.
    const h = 3_600_000;
    t0 = Math.min(start + 5 * h, ...calls.map(c => Math.floor(ms(c.eta) / h) * h));
    t1 = Math.min(start + DAY_MS, Math.max(start + 20 * h, ...calls.map(c => Math.ceil(ms(c.etd) / h) * h)));
  }
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - t0) / (t1 - t0)) * 100));
  const span = (c: PortCallView) => { const a = ms(c.eta); return [a, Math.max(a + 15 * 60_000, ms(c.etd))]; };
  const remaining = calls.filter(c => c.status !== 'ferdig').length;
  const zones = useMemo(() => {
    const seen = new Set<string>();
    return calls.flatMap(c => c.collisions.filter(x => x.kind === 'quay')).filter(z => {
      const k = `${z.calls.join()}`; if (seen.has(k)) return false; seen.add(k); return true;
    });
  }, [calls]);
  // Akse: timer for i dag, dager (og midt på dagen for 3 d) ellers.
  const ticks: { t: number; label: string; day?: boolean }[] = [];
  if (days === 1) {
    for (let t = Math.ceil(t0 / 7_200_000) * 7_200_000; t <= t1; t += 7_200_000) ticks.push({ t, label: osloTime(new Date(t).toISOString()).slice(0, 2) });
  } else {
    for (let d = 0; d < days; d++) {
      const date = addDays(today, d);
      ticks.push({ t: ms(osloToUtc(date, 0)), label: days === 14 ? dayShort(date).replace(/ \S+$/, '') : dayShort(date), day: true });
      if (days === 3) ticks.push({ t: ms(osloToUtc(date, 12 * 60)), label: '12' });
    }
  }
  const nowT = now.getTime();
  const ownQuays = quays.filter(q => isOwnQuay(q) || calls.some(c => c.quay.id === q.id));
  const bar = (c: PortCallView) => c.time_known ? span(c) : [ms(osloToUtc(c.service_date, 0)), ms(osloToUtc(addDays(c.service_date, 1), 0))];
  const periodLabel = days === 1 ? 'i dag' : `neste ${days} dager`;

  const picker = (
    <div role="group" aria-label="Periode" className="pill seg" style={{ flex: 'none' }}>
      {PERIODS_TL.map(p => (
        <button key={p.days} type="button" className="tab" aria-pressed={days === p.days} onClick={() => savePrefs.mutate({ timeline_days: p.days })}
          style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }}>{p.label}</button>
      ))}
    </div>
  );

  return (
    <section className={`ov glass kart-tl${open ? ' kart-tl-open' : ' kart-tl-mini'}`} aria-labelledby="tl-h">
      {open && (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: days === 14 ? 900 : 560, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {quays.map(qy => (
              <div key={qy.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 118, flex: 'none', paddingRight: 4 }}><QuayMark quay={qy} compact /></div>
                <div style={{ position: 'relative', flex: 1, height: 36, borderRadius: 12,
                  background: isOwnQuay(qy) ? 'rgba(var(--tint), .05)' : 'rgba(232,176,110,.07)', outline: isOwnQuay(qy) ? undefined : '1px solid rgba(232,176,110,.16)' }}>
                  {days > 1 && ticks.filter(x => x.day && x.t > t0).map(x => (
                    <span key={x.t} aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, width: 1, background: 'rgba(var(--tint), .1)', left: `${pct(x.t)}%` }} />
                  ))}
                  {calls.filter(c => c.quay.id === qy.id).map(c => {
                    const st = STATUS_STYLE[c.status];
                    const [a, b] = bar(c);
                    return (
                      <button key={c.id} type="button" onClick={() => onSelect(c.id)} title={`${c.boat.name} · ${dayShort(c.service_date)} ${timeRange(c)}`}
                        aria-label={`${c.boat.name}, ${dayShort(c.service_date)} ${timeRange(c)}, ${st.label}`}
                        style={{ position: 'absolute', top: 4, bottom: 4, left: `${pct(a)}%`, width: `max(6px, ${pct(b) - pct(a)}%)`, borderRadius: 9, padding: '0 8px', fontSize: 12, cursor: 'pointer', textAlign: 'left', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: 'var(--fg)',
                          background: c.time_known ? `color-mix(in srgb, ${st.c} 26%, rgba(20,27,23,.6))` : 'rgba(var(--tint), .04)', opacity: c.status === 'ferdig' ? .55 : 1,
                          border: `1.5px ${c.time_known ? 'solid' : 'dashed'} ${selected === c.id ? 'var(--aqua)' : `color-mix(in srgb, ${st.c} 65%, transparent)`}` }}>
                        {c.boat.name}{!c.time_known && <span style={{ color: 'var(--fg-45)' }}> · tid ikke satt</span>}
                      </button>
                    );
                  })}
                  {zones.filter(z => z.kind === 'quay' && z.quay_id === qy.id).map(z => (
                    <div key={z.calls.join()} className="hatch" style={{ position: 'absolute', top: 1, bottom: 1, left: `${pct(ms(z.from))}%`, width: `${pct(ms(z.to)) - pct(ms(z.from))}%`, border: '1px dashed #FF6B5E', borderRadius: 10, pointerEvents: 'none' }} />
                  ))}
                  {nowT >= t0 && nowT <= t1 && <div style={{ position: 'absolute', top: -3, bottom: -3, width: 2, background: 'var(--aqua)', pointerEvents: 'none', left: `${pct(nowT)}%` }} />}
                </div>
              </div>
            ))}
            <div style={{ display: 'flex' }}>
              <div style={{ width: 118, flex: 'none' }} />
              <div style={{ position: 'relative', flex: 1, height: 16 }}>
                {ticks.map(x => (
                  <span key={x.t} className="n" style={{ position: 'absolute', top: 0, transform: x.day ? 'translateX(6px)' : 'translateX(-50%)', fontSize: 11, whiteSpace: 'nowrap', color: x.day ? 'var(--fg-75)' : 'var(--fg-55)', left: `${pct(x.t)}%` }}>{x.label}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 150 }}>
          <span id="tl-h" style={{ fontSize: 15 }}>Kaiplan <span style={{ color: 'var(--fg-62)' }}>· {periodLabel}</span></span>
          <span style={{ fontSize: 12, color: 'var(--fg-62)' }}>
            {remaining} gjenstår{untimed ? ` · ${untimed} uten tid` : ''}{zones.length ? <> · <span style={{ color: 'var(--bad-fg)' }}>{zones.length} {zones.length === 1 ? 'kollisjon' : 'kollisjoner'}</span></> : ''}
          </span>
        </div>
        {open ? (
          <div style={{ flex: 1, display: 'flex', gap: 14, fontSize: 12, color: 'var(--fg-62)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {(['ved_kai', 'paa_vei'] as const).map(st => (
              <span key={st} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ width: 8, height: 8, background: STATUS_STYLE[st].c }} />{STATUS_STYLE[st].label}</span>
            ))}
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="hatch" style={{ width: 12, height: 8, borderRadius: 2, border: '1px dashed #FF6B5E' }} />Kollisjon</span>
            {days > 1 && <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 8, borderRadius: 2, border: '1px dashed var(--fg-45)' }} />Uten tid</span>}
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }} aria-hidden="true">
            {ownQuays.map(qy => (
              <div key={qy.id} style={{ position: 'relative', height: 7, borderRadius: 4, background: 'rgba(var(--tint), .08)' }}>
                {calls.filter(c => c.quay.id === qy.id).map(c => {
                  const [a, b] = bar(c);
                  return <span key={c.id} style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct(a)}%`, width: `max(3px, ${pct(b) - pct(a)}%)`, borderRadius: 4, background: c.collisions.length ? 'var(--red-soft)' : STATUS_STYLE[c.status].c, opacity: c.status === 'ferdig' ? .4 : c.time_known ? .85 : .3 }} />;
                })}
                {nowT >= t0 && nowT <= t1 && <span style={{ position: 'absolute', top: -3, bottom: -3, width: 2, background: 'var(--fg)', left: `${pct(nowT)}%` }} />}
              </div>
            ))}
          </div>
        )}
        {picker}
        <button type="button" className="btn" onClick={onToggle} aria-expanded={open} aria-controls="tl-h" style={{ minHeight: 36, fontSize: 13, padding: '0 14px', width: 64, flex: 'none' }}>
          {open ? 'Skjul' : 'Vis'}
        </button>
      </div>
    </section>
  );
}
