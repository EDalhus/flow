import { useState } from 'react';
import { useSearchParams } from 'react-router';
import type { PortCallView } from '../../../shared/api.ts';
import { CREW_ROLE_LABEL } from '../../../shared/domain/types.ts';
import { AlertsPanel } from '../components/Alerts.tsx';
import { Chat } from '../components/Chat.tsx';
import { ArrowLeft, Check, Phone } from '../components/Icons.tsx';
import { KaibokForm } from '../components/KaibokForm.tsx';
import { BellButton, UserBadge } from '../components/Topbar.tsx';
import { Loading, StatusBadge } from '../components/ui.tsx';
import { FlowMap } from '../map/FlowMap.tsx';
import { FLAG_STYLE, addDays, dayHeading, dayShort, fr, goodsParts, osloTime, quayLabel, telHref, timeRange, todayOslo, typeLabel } from '../lib/format.ts';
import { useAis, useBoat, useMe, usePortCalls, useQuays, useSettings, useUsers } from '../lib/queries.ts';
import { VesselLayer, aisLive } from '../map/Vessels.tsx';
import { canQuayLog } from '../lib/roles.ts';
import { useNow } from '../lib/useNow.ts';

const FALLBACK = { lat: 62.47918, lon: 6.19292, radius_m: 300, label: '' };
const sheet: React.CSSProperties = {
  position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: '34px 34px 0 0', borderBottom: 'none', display: 'flex', flexDirection: 'column',
  background: 'rgba(17,21,25,.62)', backdropFilter: 'blur(22px) saturate(140%)', WebkitBackdropFilter: 'blur(22px) saturate(140%)', border: '1px solid rgba(255,255,255,.09)',
};
const pill: React.CSSProperties = { background: 'rgba(17,21,25,.55)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 999 };
const Grabber = () => <div aria-hidden="true" style={{ width: 40, height: 5, borderRadius: 3, background: 'rgba(243,245,246,.3)', margin: '10px auto 0', flex: 'none' }} />;

/** Kaiarbeidervisning: store trykkflater, ett anløp om gangen. */
export function MobileApp() {
  const now = useNow();
  const today = todayOslo(now);
  const calls = usePortCalls(today, addDays(today, 1));
  const settings = useSettings();
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const [alerts, setAlerts] = useState(false);
  const list = calls.data?.calls ?? [];
  const sel = list.find(c => c.id === params.get('id'));
  const screen = params.get('kaibok') && sel ? 'kaibok' : sel ? 'detail' : 'list';
  const go = (id: string | null, kaibok = false) => setParams(id ? { id, ...(kaibok ? { kaibok: '1' } : {}) } : {});
  const fence = settings.data?.geofence ?? FALLBACK;
  const ais = useAis();
  const quays = useQuays();
  const quayPos = (id: string) => {
    const q = quays.data?.find(x => x.id === id);
    return q?.lat != null && q.lon != null ? { lat: q.lat, lon: q.lon } : fence;
  };

  if (screen === 'kaibok' && sel) {
    return (
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
        <KaibokForm call={sel} fullscreen onClose={() => go(sel.id)} onDone={() => go(sel.id)} />
      </div>
    );
  }

  const left = list.filter(c => c.service_date === today && c.status !== 'ferdig').length;
  const atQuay = list.filter(c => c.status === 'ved_kai').length;
  const clash = list.flatMap(c => c.collisions.map(x => ({ call: c, x }))).find(Boolean);

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'var(--bg)', fontSize: 16 }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: screen === 'list' ? 420 : 360, transition: 'height .4s ease' }}>
        {settings.isSuccess && (
          <FlowMap center={[fence.lon - 0.01, fence.lat]} zoom={12.4} geofence={fence} interactive={screen === 'list'}
            overlays={project => {
              const q = project(fence.lon, fence.lat);
              return (
                <>
                  {q && <span style={{ position: 'absolute', left: q[0], top: q[1], transform: 'translate(-50%, -140%)', background: 'rgba(243,245,246,.95)', color: '#0B0E11', borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', pointerEvents: 'none' }}>Vår kai</span>}
                  <VesselLayer project={project} vessels={ais.data?.vessels ?? []} calls={list} selectedId={sel?.id} onSelect={id => go(id)} quayPos={quayPos} today={today} compact />
                </>
              );
            }} />
        )}
      </div>

      {screen === 'list' ? (
        <>
          <header style={{ position: 'absolute', top: 14, left: 14, right: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 2 }}>
            <UserBadge size={48} align="left" />
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 300, letterSpacing: '-0.01em', textShadow: '0 2px 12px rgba(0,0,0,.6)' }}>Flatholmen Havn</h1>
            <BellButton open={alerts} onToggle={() => setAlerts(!alerts)} glass />
          </header>
          <div style={{ position: 'absolute', top: 76, left: 14, right: 14, display: 'flex', gap: 8, justifyContent: 'center', zIndex: 2 }}>
            <span className="n" style={{ ...pill, minHeight: 44, padding: '0 16px', display: 'flex', alignItems: 'center', fontSize: 15 }}>{dayShort(today)} · {osloTime(now)}</span>
            <span style={{ ...pill, minHeight: 44, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 15 }}>
              <span className="dot" style={{ width: 8, height: 8, background: aisLive(ais.data?.status, now) ? '#5BD68A' : '#A3ACB3' }} />
              {aisLive(ais.data?.status, now) ? `${list.filter(c => c.status === 'paa_vei').length} på vei · AIS` : `${atQuay} ved kai`}
            </span>
          </div>
          {alerts && <div style={{ position: 'absolute', top: 70, left: 10, right: 10, zIndex: 40 }}><AlertsPanel onClose={() => setAlerts(false)} style={{ width: '100%' }} /></div>}

          <section aria-labelledby="m-list-h" style={{ ...sheet, top: 388 }}>
            <Grabber />
            <div style={{ padding: '10px 20px 8px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flex: 'none' }}>
              <h2 id="m-list-h" style={{ margin: 0, fontSize: 22, fontWeight: 400 }}>Anløp</h2>
              <span style={{ fontSize: 14, color: 'var(--fg-62)' }}>{left} igjen i dag</span>
            </div>
            <div className="scroll-none" style={{ flex: 1, padding: '4px 14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {calls.isPending && <Loading />}
              {clash && (
                <div role="alert" className="alert-red" style={{ borderRadius: 22, padding: '14px 16px', background: 'rgba(120,42,38,.5)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span className="n" style={{ width: 22, height: 22, flex: 'none', borderRadius: '50%', background: '#E5484D', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, marginTop: 2 }}>!</span>
                  <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 16 }}>{clash.x.kind === 'quay' ? `Kollisjon på ${quayLabel(clash.call.quay)}` : 'Booket for tett'}</span>
                    <span style={{ fontSize: 14, color: 'rgba(243,245,246,.7)' }}>{[clash.call.boat.name, ...clash.x.with.map(w => w.boat_name)].join(' og ')} · {clash.x.text}</span>
                  </span>
                </div>
              )}
              {[today, addDays(today, 1)].map(d => {
                const items = list.filter(c => c.service_date === d);
                if (!items.length) return null;
                return (
                  <div key={d} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <h3 style={{ margin: '6px 6px 0', fontSize: 14, fontWeight: 400, color: 'var(--fg-62)' }}>{d === today ? 'I dag' : dayHeading(d, today)}</h3>
                    {items.map(c => <MobileCard key={c.id} call={c} onOpen={() => go(c.id)} />)}
                  </div>
                );
              })}
              {calls.isSuccess && !list.length && <p className="empty">Ingen anløp i dag eller i morgen.</p>}
            </div>
          </section>
        </>
      ) : sel && (
        <Detail call={sel} now={now} today={today} onBack={() => go(null)} onKaibok={() => go(sel.id, true)} canLog={canQuayLog(me.data)} />
      )}
    </div>
  );
}

function MobileCard({ call: c, onOpen }: { call: PortCallView; onOpen: () => void }) {
  const f = FLAG_STYLE[c.boat.flag];
  const boats = [...new Set(c.collisions.flatMap(x => x.with.map(w => w.boat_name)))];
  return (
    <button type="button" className="card" onClick={onOpen} aria-label={`${c.boat.name}, ${typeLabel(c.type)} ${quayLabel(c.quay)}, ETA ${osloTime(c.eta)}`}
      style={{ borderRadius: 24, gap: 10, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.07)', ...(c.status === 'ferdig' ? { opacity: .6 } : {}) }}>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%' }}>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 21, letterSpacing: '-0.01em' }}>{c.boat.name}</span>
          <span style={{ fontSize: 14, color: 'rgba(243,245,246,.65)' }}>{typeLabel(c.type)} · {quayLabel(c.quay)}</span>
        </span>
        <span className="n" style={{ fontSize: 28, fontWeight: 200, letterSpacing: '-0.02em' }}>{osloTime(c.eta)}</span>
      </span>
      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <StatusBadge status={c.status} basis={c.status_basis} size="lg" />
        <span className="badge" style={{ padding: '6px 11px', fontSize: 13, background: f.bg, color: f.c }}>{f.label} · {c.boat.rating_count ? fr(c.boat.avg_total) : '–'}</span>
      </span>
      {c.collisions.length > 0 && <span style={{ fontSize: 14, color: '#FF9A91' }}>{boats.length ? `Kolliderer med ${boats.join(', ')}` : c.collisions[0].text}</span>}
    </button>
  );
}

function Detail({ call: c, now, today, onBack, onKaibok, canLog }: {
  call: PortCallView; now: Date; today: string; onBack: () => void; onKaibok: () => void; canLog: boolean;
}) {
  const boat = useBoat(c.boat.id);
  const users = useUsers();
  const me = useMe();
  const f = FLAG_STYLE[c.boat.flag];
  const mins = Math.round((Date.parse(c.eta) - now.getTime()) / 60_000);
  const card = c.status === 'ved_kai'
    ? { title: 'Ved kai', sub: 'Planlagt avgang', big: osloTime(c.etd).slice(0, 2), dim: osloTime(c.etd).slice(2) }
    : c.status === 'ferdig' ? { title: 'Ferdig', sub: 'Kaibok levert', big: osloTime(c.etd).slice(0, 2), dim: osloTime(c.etd).slice(2) }
    : c.status === 'kaibok_mangler' ? { title: 'Kaibok mangler', sub: 'ETD passert', big: osloTime(c.etd).slice(0, 2), dim: osloTime(c.etd).slice(2) }
    : c.service_date === today && mins > 0 ? { title: 'Til ankomst', sub: `ETA ${osloTime(c.eta)}`, big: String(Math.floor(mins / 60)), dim: ` t ${String(mins % 60).padStart(2, '0')} min` }
    : { title: 'ETA', sub: dayShort(c.service_date), big: osloTime(c.eta).slice(0, 2), dim: osloTime(c.eta).slice(2) };
  const contacts = [
    boat.data?.agent?.phone && ['Agent', boat.data.agent.name, boat.data.agent.phone],
    boat.data?.ship_phone && ['Båtens mobil', boat.data.ship_contact ?? c.boat.name, boat.data.ship_phone],
    c.seller?.phone && ['Ansvarlig selger', c.seller.name, c.seller.phone],
  ].filter((x): x is string[] => !!x);
  const chips = [...new Set([c.seller?.short_name, c.responsible?.short_name, ...(users.data ?? []).filter(u => u.roles.includes('produksjon')).map(u => u.short_name)])]
    .filter((s): s is string => !!s && s !== me.data?.short_name).slice(0, 4);
  const auto = c.crew.length === 1;

  return (
    <>
      <header style={{ position: 'absolute', top: 14, left: 14, right: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 2 }}>
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Tilbake til anløpslista" style={{ ...pill, width: 48, height: 48 }}><ArrowLeft size={20} /></button>
        <span style={{ fontSize: 18, fontWeight: 300, textShadow: '0 2px 12px rgba(0,0,0,.6)' }}>{quayLabel(c.quay)} · {typeLabel(c.type)}</span>
        <span style={{ width: 48 }} />
      </header>
      <div className="glass" style={{ position: 'absolute', left: 16, top: 168, width: 200, padding: '14px 16px', borderRadius: 22, background: 'rgba(40,46,44,.5)', display: 'flex', flexDirection: 'column', zIndex: 2 }}>
        <span style={{ fontSize: 15 }}>{card.title}</span>
        <span style={{ fontSize: 13, color: 'var(--fg-62)' }}>{card.sub}</span>
        <span className="n" style={{ fontSize: 44, fontWeight: 200, lineHeight: 1.1, marginTop: 6 }}>{card.big}<span style={{ color: 'var(--fg-45)', fontSize: 22 }}>{card.dim}</span></span>
      </div>

      <section aria-labelledby="m-sel-h" style={{ ...sheet, top: 326 }}>
        <Grabber />
        <div className="scroll-none" style={{ flex: 1, padding: '10px 16px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 4px' }}>
            <h2 id="m-sel-h" style={{ margin: 0, fontSize: 32, fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{c.boat.name}</h2>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 14 }}>
              <span style={{ borderRadius: 999, padding: '4px 11px', background: f.bg, color: f.c }}>{f.label} · {c.boat.rating_count ? fr(c.boat.avg_total) : '–'}</span>
              <span className="n" style={{ color: 'rgba(243,245,246,.65)' }}>{timeRange(c)}</span>
              <StatusBadge status={c.status} basis={c.status_basis} />
            </span>
            {c.boat.flag_reason && <span style={{ fontSize: 14, color: 'rgba(243,245,246,.65)' }}>{c.boat.flag_reason}</span>}
          </div>

          {c.status === 'ferdig' && <div style={{ borderRadius: 20, padding: 16, background: 'rgba(163,172,179,.14)' }}>Ferdig – kaibok levert.</div>}

          {c.collisions.length > 0 && (
            <div role="alert" className="alert-red" style={{ borderRadius: 22, padding: '14px 16px', background: 'rgba(120,42,38,.5)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 16 }}>Booket for tett</span>
              {c.collisions.map((x, i) => (
                <span key={i} className="n" style={{ fontSize: 14, color: 'rgba(243,245,246,.75)', borderLeft: '1px solid rgba(243,245,246,.35)', paddingLeft: 10 }}>
                  {x.text} · {osloTime(x.from)}–{osloTime(x.to)}{x.with.length ? ` · ${x.with.map(w => w.boat_name).join(', ')}` : ''}
                </span>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '0 4px' }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 400, color: 'var(--fg-62)' }}>Mannskap</h3>
              <span style={{ fontSize: 14, color: c.responsible ? 'var(--fg-62)' : '#F7C873' }}>
                {c.responsible ? (auto ? 'Eneste på båten = ansvarlig' : `Ansvarlig: ${c.responsible.short_name}`) : 'Ansvarlig ikke valgt'}
              </span>
            </div>
            <div style={{ borderRadius: 22, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)', padding: '2px 6px' }}>
              {c.crew.map(s => {
                const mine = s.user?.id === me.data?.id;
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 54, padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                    <span style={{ width: 34, height: 34, flex: 'none', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
                      ...(mine ? { background: '#F3F5F6', color: '#0B0E11' } : s.user ? { background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)' } : { border: '1px dashed rgba(247,185,85,.5)', color: '#F7C873' }) }}>
                      {s.user?.initials ?? '?'}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 16, color: s.user ? undefined : '#F7C873' }}>{s.user ? `${s.user.short_name}${mine ? ' (deg)' : ''}` : 'Ikke satt'}</span>
                      <span style={{ fontSize: 13, color: 'rgba(243,245,246,.6)' }}>{CREW_ROLE_LABEL[s.crew_role]}</span>
                    </span>
                    {s.user && c.responsible?.id === s.user.id && <span style={{ fontSize: 13, borderRadius: 999, padding: '5px 12px', background: '#F3F5F6', color: '#0B0E11' }}>Ansvarlig</span>}
                  </div>
                );
              })}
              {c.boat_crane && <div style={{ padding: 10, fontSize: 14, color: 'rgba(243,245,246,.65)' }}>+ Båtens egen kran brukes</div>}
            </div>
          </div>

          <div style={{ borderRadius: 22, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)', padding: '4px 16px' }}>
            {c.goods.map(g => {
              const [q, d] = goodsParts(g);
              return (
                <div key={g.id} style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                  <span className="n" style={{ minWidth: 74 }}>{q}</span>
                  <span style={{ color: 'rgba(243,245,246,.8)', fontSize: 15 }}>{d}</span>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {contacts.map(([kind, name, phone]) => (
              <a key={kind} href={telHref(phone)} aria-label={`Ring ${kind.toLowerCase()}, ${name}`}
                style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 64, padding: '8px 8px 8px 16px', borderRadius: 22, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.07)', textDecoration: 'none', color: '#F3F5F6' }}>
                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, color: 'rgba(243,245,246,.6)' }}>{kind}</span>
                  <span>{name}</span>
                </span>
                <span style={{ width: 48, height: 48, flex: 'none', borderRadius: '50%', background: '#5BD68A', color: '#0B0E11', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Phone size={20} strokeWidth={2} /></span>
              </a>
            ))}
          </div>

          <Chat callId={c.id} chips={chips} variant="mobile" />
        </div>
        {c.status !== 'ferdig' && canLog && (
          <div style={{ flex: 'none', padding: '10px 16px 20px' }}>
            <button type="button" onClick={onKaibok}
              style={{ width: '100%', minHeight: 60, borderRadius: 999, border: 'none', background: '#F3F5F6', color: '#0B0E11', fontSize: 17, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <Check size={20} strokeWidth={2.2} />Ferdigstill og fyll ut kaibok
            </button>
          </div>
        )}
      </section>
    </>
  );
}
