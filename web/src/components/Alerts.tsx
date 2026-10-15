import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { CollisionView, PortCallView } from '../../../shared/api.ts';
import { errorText } from '../lib/api.ts';
import { FLAG_STYLE, addDays, dayRelative, fr, osloTime, todayOslo } from '../lib/format.ts';
import { useMe, useNotifications, usePatchPortCall, usePortCalls, useReadNotifications } from '../lib/queries.ts';
import { canPlan } from '../lib/roles.ts';
import { api } from '../lib/api.ts';
import { Chevron, Close, Sparkle } from './Icons.tsx';
import { QuayMark } from './ui.tsx';

/** Kollisjoner og flagg for i dag og i morgen, pluss personlige varsler. Brukes av bjella. */
export function useAlerts() {
  const today = todayOslo();
  const calls = usePortCalls(today, addDays(today, 1));
  const notes = useNotifications();
  const list = calls.data?.calls ?? [];
  const flagged = list.filter(c => c.status !== 'ferdig' && (c.boat.flag === 'red' || c.boat.flag === 'yellow'));
  const collisions = calls.data?.collisions ?? [];
  return {
    calls: list,
    collisions,
    flagged,
    notifications: notes.data?.items ?? [],
    unread: notes.data?.unread ?? 0,
    count: collisions.length + flagged.length + (notes.data?.unread ?? 0),
  };
}

function collisionTitle(c: CollisionView, calls: PortCallView[]) {
  if (c.kind === 'quay') return `Kollisjon på ${c.text.replace(' dobbeltbooket', '')}`;
  if (c.kind === 'person') return 'Mannskap dobbeltbooket';
  const call = calls.find(x => x.id === c.calls[0]);
  return `For få på vakt${call ? ` · ${dayRelative(call.service_date).toLowerCase()}` : ''}`;
}

export function AlertsPanel({ onClose, style }: { onClose: () => void; style?: React.CSSProperties }) {
  const a = useAlerts();
  const me = useMe();
  const nav = useNavigate();
  const patch = usePatchPortCall();
  const read = useReadNotifications();
  const [open, setOpen] = useState<string | null>(a.collisions.length ? 'c0' : null);
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(a.calls.map(c => [c.id, c])), [a.calls]);
  const planner = canPlan(me.data);

  const apply = async (s: CollisionView['suggestions'][number]) => {
    const call = byId.get(s.call_id);
    if (!call) return;
    setError(null);
    try {
      if (s.kind === 'move_quay') await patch.mutateAsync({ id: call.id, version: call.version, quay_id: s.quay_id });
      else await patch.mutateAsync({ id: call.id, version: call.version, eta: s.eta, etd: s.etd });
      const what = s.kind === 'move_quay'
        ? `Flyttet ${call.boat.name} til ${s.text.split(' til ').pop()}`
        : `Utsatt ${call.boat.name} til ${osloTime(s.eta)}–${osloTime(s.etd)}`;
      await api(`/port-calls/${call.id}/messages`, { body: { body: `${what} (fra varsel om kollisjon).` } });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const toggle = (id: string) => setOpen(open === id ? null : id);
  const goTo = (callId: string | null, tab?: string) => {
    if (callId) nav(`/?id=${callId}${tab ? `&tab=${tab}` : ''}`);
    onClose();
  };

  return (
    <div className="glass scroll" role="dialog" aria-label="Varsler"
      style={{ width: 360, maxHeight: 600, padding: 14, zIndex: 30, background: 'rgba(32,42,36,.88)', ...style }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 40, padding: '0 2px 0 6px' }}>
          <span style={{ fontSize: 18 }}>Varsler</span>
          <button type="button" className="icon-btn pill" onClick={onClose} aria-label="Lukk varsler" style={{ width: 40, height: 40 }}>
            <Close size={16} />
          </button>
        </div>
        {error && <div className="error-box" role="alert">{error}</div>}

        {a.collisions.map((c, i) => {
          const id = `c${i}`;
          const isOpen = open === id;
          const boats = c.calls.map(x => byId.get(x)?.boat.name ?? '').filter(Boolean);
          return (
            <div key={id} className="alert-red" style={{ borderRadius: 20, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <AlertHead badge="1" badgeStyle={{ background: '#E5484D', color: '#fff' }} title={collisionTitle(c, a.calls)}
                sub={boats.join(' og ')} open={isOpen} onClick={() => toggle(id)} />
              {isOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 30 }}>
                  <Line a={c.text} b={`${osloTime(c.from)}–${osloTime(c.to)}`} />
                  {planner && c.suggestions.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg-75)' }}><Sparkle size={15} />Anbefaling</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {c.suggestions.map(s => {
                          const boat = byId.get(s.call_id)?.boat.name;
                          const label = s.text.includes(': ') ? s.text.replace(/^[^:]+: (.)/, (_, ch: string) => ch.toUpperCase()) : s.text;
                          return (
                            <button key={s.kind + s.call_id} type="button" className="btn" disabled={patch.isPending} onClick={() => apply(s)}
                              style={{ minHeight: 40, fontSize: 13, padding: '0 14px' }}>
                              {label.replace(/^(Flytt|Utsett)/, `$1 ${boat}`)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <button type="button" className="btn" onClick={() => goTo(c.calls[c.calls.length - 1])} style={{ alignSelf: 'flex-start', minHeight: 36, fontSize: 13 }}>
                    Åpne anløpet
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {a.flagged.map(c => {
          const id = `f${c.id}`;
          const isOpen = open === id;
          const red = c.boat.flag === 'red';
          return (
            <div key={id} className={red ? 'alert-red' : 'alert-yellow'} style={{ borderRadius: 20, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, ...(red ? { background: 'rgba(120,42,38,.3)' } : {}) }}>
              <AlertHead badge="!" badgeStyle={red ? { background: '#E5484D', color: '#fff' } : { background: '#F7B955', color: '#1A231E' }}
                title={`${red ? 'Rødt flagg' : 'Gult varsel'}: ${c.boat.name}`}
                sub={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{dayRelative(c.service_date)} {osloTime(c.eta)} · <QuayMark quay={c.quay} compact /></span>}
                open={isOpen} onClick={() => toggle(id)} />
              {isOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 30 }}>
                  <Line a={c.boat.flag_reason ?? FLAG_STYLE[c.boat.flag].label} b={`Snittrating ${fr(c.boat.avg_total)} · ${c.boat.rating_count} kaibøker`} />
                  <button type="button" className="btn" onClick={() => goTo(c.id)} style={{ alignSelf: 'flex-start', minHeight: 36, fontSize: 13 }}>Åpne anløpet</button>
                </div>
              )}
            </div>
          );
        })}

        {a.notifications.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 6px 0' }}>
            <span className="sub">Til deg</span>
            {a.unread > 0 && (
              <button type="button" className="tab" style={{ minHeight: 30, fontSize: 13 }} onClick={() => read.mutate({ all: true })}>Merk alle som lest</button>
            )}
          </div>
        )}
        {a.notifications.slice(0, 12).map(n => (
          <button key={n.id} type="button" onClick={() => { if (!n.read_at) read.mutate({ ids: [n.id] }); goTo(n.port_call_id, n.kind === 'mention' ? 'chat' : undefined); }}
            style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 18, padding: '10px 14px', border: '1px solid rgba(var(--tint), .06)', background: n.read_at ? 'rgba(var(--tint), .03)' : 'rgba(128,239,222,.12)', display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 14 }}>{n.text}</span>
            <span className="n" style={{ fontSize: 12, color: 'rgba(var(--tint), .6)' }}>{dayRelative(n.created_at.slice(0, 10))} {osloTime(n.created_at)}</span>
          </button>
        ))}

        {!a.collisions.length && !a.flagged.length && !a.notifications.length && (
          <p style={{ margin: 0, padding: '12px 16px', borderRadius: 18, background: 'rgba(91,214,138,.1)', color: 'var(--ok-fg)', fontSize: 14 }}>Ingen aktive varsler.</p>
        )}
      </section>
    </div>
  );
}

function AlertHead({ badge, badgeStyle, title, sub, open, onClick }: {
  badge: string; badgeStyle: React.CSSProperties; title: string; sub: ReactNode; open: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open}
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left', width: '100%' }}>
      <span className="n" style={{ width: 20, height: 20, flex: 'none', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, marginTop: 2, ...badgeStyle }}>{badge}</span>
      <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 15 }}>{title}</span>
        <span style={{ fontSize: 12, color: 'rgba(var(--tint), .6)' }}>{sub}</span>
      </span>
      <Chevron size={16} style={{ marginTop: 3, transform: open ? 'rotate(180deg)' : undefined }} />
    </button>
  );
}

const Line = ({ a, b }: { a: string; b: string }) => (
  <div style={{ borderLeft: '1px solid rgba(var(--tint), .35)', paddingLeft: 12, display: 'flex', flexDirection: 'column' }}>
    <span style={{ fontSize: 14 }}>{a}</span>
    <span className="n" style={{ fontSize: 12, color: 'rgba(var(--tint), .6)' }}>{b}</span>
  </div>
);
