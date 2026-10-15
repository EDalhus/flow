import { useState } from 'react';
import type { CollisionView, PortCallView, UserView } from '../../../shared/api.ts';
import { CREW_ROLE_LABEL, type CrewRole } from '../../../shared/domain/types.ts';
import { errorText } from '../lib/api.ts';
import { dayRelative, ddmm, fr, goodsParts, telHref, telShort, timeRange, typeLabel } from '../lib/format.ts';
import { useBoat, useMe, usePutCrew, useUsers } from '../lib/queries.ts';
import { canCrew, canQuayLog } from '../lib/roles.ts';
import { Chat } from './Chat.tsx';
import { Check, Close, Phone } from './Icons.tsx';
import { BigNumber, FlagBadge, QuayMark, Rating, RatingBars, Segmented } from './ui.tsx';

export type DetailTab = 'oversikt' | 'chat' | 'profil';

export function CallDetail({ call, tab, onTab, onOpenKaibok, onOpenAlerts, onClose }: {
  call: PortCallView; tab: DetailTab; onTab: (t: DetailTab) => void; onOpenKaibok: () => void; onOpenAlerts: () => void; onClose?: () => void;
}) {
  const boat = useBoat(call.boat.id);
  const users = useUsers();
  const me = useMe();
  const chips = [...new Set([call.seller?.short_name, call.responsible?.short_name,
    ...(users.data ?? []).filter(u => u.roles.includes('produksjon')).map(u => u.short_name)])]
    .filter((s): s is string => !!s && s !== me.data?.short_name).slice(0, 4);

  return (
    <section aria-labelledby="sel-h" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 6px' }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span className="n" style={{ fontSize: 13, color: 'var(--fg-62)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {typeLabel(call.type)} · <QuayMark quay={call.quay} compact /> · {dayRelative(call.service_date)} {timeRange(call)}
          </span>
          {onClose && (
            <button type="button" className="icon-btn pill" onClick={onClose} aria-label="Lukk anløpet" title="Lukk (Esc)" style={{ width: 36, height: 36, flex: 'none', marginRight: -6 }}>
              <Close size={14} />
            </button>
          )}
        </span>
        <h2 id="sel-h" style={{ margin: 0, fontSize: 30, fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1.15 }}>{call.boat.name}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 13 }}>
          <FlagBadge flag={call.boat.flag} style={{ fontSize: 13, padding: '3px 10px' }} />
          <Rating value={call.boat.rating_count ? call.boat.avg_total : null}
            suffix={<span style={{ color: 'var(--fg-62)' }}>· {call.boat.rating_count} {call.boat.rating_count === 1 ? 'kaibok' : 'kaibøker'}</span>} />
        </div>
      </div>

      <Segmented<DetailTab> label="Anløpsdetaljer" value={tab} onChange={onTab} stretch
        options={[{ value: 'oversikt', label: 'Oversikt' }, { value: 'chat', label: `Chat · ${call.message_count}` }, { value: 'profil', label: 'Båtprofil' }]} />

      {tab === 'oversikt' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {call.collisions.length > 0 && <ClashButton collisions={call.collisions} onClick={onOpenAlerts} />}
          <CrewEditor call={call} users={users.data ?? []} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h3 style={{ margin: '0 6px', fontSize: 13, fontWeight: 400, color: 'var(--fg-62)' }}>Varer</h3>
            {call.goods.map(g => {
              const [q, d] = goodsParts(g);
              return (
                <div key={g.id} style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '6px', borderBottom: '1px solid rgba(var(--tint), .06)' }}>
                  <span className="n" style={{ fontSize: 15, minWidth: 70 }}>{q}</span>
                  <span style={{ fontSize: 14, color: 'rgba(var(--tint), .8)' }}>{d}</span>
                </div>
              );
            })}
            {!call.goods.length && <span className="muted" style={{ padding: 6, fontSize: 14 }}>Ingen varer registrert.</span>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
            {[
              boat.data?.agent?.phone && ['Agent', boat.data.agent.name, boat.data.agent.phone],
              boat.data?.ship_phone && ['Båten', boat.data.ship_contact ?? call.boat.name, boat.data.ship_phone],
              call.seller?.phone && ['Selger', call.seller.name, call.seller.phone],
            ].filter((x): x is string[] => !!x).map(([kind, name, phone]) => (
              <a key={kind} className="tel" href={telHref(phone)} aria-label={`Ring ${kind.toLowerCase()}, ${name}, ${phone}`}
                style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1, padding: '9px 12px', minHeight: 64, minWidth: 0 }}>
                <span style={{ fontSize: 11, color: 'rgba(var(--tint), .6)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Phone size={11} strokeWidth={2.4} style={{ color: '#5BD68A' }} />{kind}
                </span>
                <span style={{ fontSize: 13, maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                <span className="n" style={{ fontSize: 12, color: '#80EFDE' }}>{telShort(phone)}</span>
              </a>
            ))}
          </div>

          {call.status === 'ferdig' ? (
            <div style={{ borderRadius: 16, padding: '14px 16px', background: 'rgba(177,194,183,.12)', color: '#D6E0D9', fontSize: 14 }}>Ferdig – kaibok er levert for dette anløpet.</div>
          ) : canQuayLog(me.data) ? (
            <button type="button" className="btn btn-w" onClick={onOpenKaibok} style={{ minHeight: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 15 }}>
              <Check size={17} strokeWidth={2.2} />Ferdigstill og fyll ut kaibok
            </button>
          ) : null}
        </div>
      )}

      {tab === 'chat' && <Chat callId={call.id} chips={chips} />}

      {tab === 'profil' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, padding: '0 6px' }}>
            <BigNumber value={call.boat.rating_count ? call.boat.avg_total : null} size={64} />
            <span style={{ fontSize: 13, color: 'var(--fg-62)', paddingBottom: 8 }}>
              {call.boat.rating_count ? `av 5 · snitt av ${call.boat.rating_count} kaibøker` : 'ingen vurderinger ennå'}
            </span>
          </div>
          {boat.data && (
            <div style={{ padding: '0 6px' }}>
              <RatingBars values={{ p: boat.data.avg_punctuality, s: boat.data.avg_cooperation, u: boat.data.avg_equipment }} />
            </div>
          )}
          {call.boat.flag_reason && <p style={{ margin: '0 6px', fontSize: 14, color: 'var(--fg-75)' }}>{call.boat.flag_reason}</p>}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ margin: '0 6px 4px', fontSize: 13, fontWeight: 400, color: 'var(--fg-62)' }}>Siste kaibøker</h3>
            {(boat.data?.recent_logs ?? []).slice(0, 5).map(l => (
              <div key={l.id} style={{ padding: '10px 6px', borderBottom: '1px solid rgba(var(--tint), .06)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="n" style={{ fontSize: 12, color: 'rgba(var(--tint), .6)' }}>
                  {ddmm(l.delivered_at)} · {l.delivered_by?.short_name} · {fr(l.avg)}/5
                  {l.had_deviation && <span style={{ color: 'var(--bad-fg)' }}> · Avvik</span>}
                </span>
                <span style={{ fontSize: 14 }}>{l.boat_note ?? l.description ?? '—'}</span>
              </div>
            ))}
            {boat.data && !boat.data.recent_logs.length && <p className="muted" style={{ margin: 0, padding: '10px 6px', fontSize: 14 }}>Ingen kaibøker ennå.</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function ClashButton({ collisions, onClick }: { collisions: CollisionView[]; onClick: () => void }) {
  const boats = [...new Set(collisions.flatMap(c => c.with.map(w => w.boat_name)))];
  return (
    <button type="button" onClick={onClick} className="alert-red"
      style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '8px 8px 8px 14px', borderRadius: 16 }}>
      <span className="dot" style={{ width: 8, height: 8, background: '#E5484D' }} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
        <span style={{ fontSize: 14 }}>{boats.length ? `Kolliderer med ${boats.join(', ')}` : 'Kapasitet overskredet'}</span>
        <span style={{ fontSize: 12, color: 'rgba(var(--tint), .65)' }}>{collisions.map(c => c.text).join(' · ')}</span>
      </span>
      <span style={{ flex: 'none', fontSize: 13, borderRadius: 999, padding: '6px 12px', background: 'rgba(var(--tint), .1)' }}>Løs</span>
    </button>
  );
}

/** Mannskap med personvalg og ansvarlig, som i Main-tavla. Produksjonen setter navn. */
function CrewEditor({ call, users }: { call: PortCallView; users: UserView[] }) {
  const me = useMe();
  const put = usePutCrew();
  const [error, setError] = useState<string | null>(null);
  const editable = canCrew(me.data) && call.status !== 'ferdig' && call.status !== 'avlyst';
  const auto = call.crew.length === 1;
  const hitRoles = new Set(call.collisions.flatMap(c => (c.kind === 'capacity' ? [c.role] : [])));
  const hitUsers = new Set(call.collisions.flatMap(c => (c.kind === 'person' ? [c.user_id] : [])));

  const save = (slots: { crew_role: CrewRole; user_id: string | null }[], responsible?: string | null) => {
    setError(null);
    put.mutate({ id: call.id, version: call.version, slots, ...(responsible !== undefined ? { responsible_user_id: responsible } : {}) },
      { onError: e => setError(errorText(e)) });
  };
  const slots = call.crew.map(s => ({ crew_role: s.crew_role, user_id: s.user?.id ?? null }));

  const ansText = call.responsible
    ? (auto ? 'Eneste på båten = ansvarlig' : `Ansvarlig: ${call.responsible.short_name}`)
    : (auto ? 'Velg person' : 'Velg ansvarlig');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, margin: '0 6px' }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 400, color: 'var(--fg-62)' }}>Mannskap</h3>
        {call.crew.length > 0 && <span style={{ fontSize: 13, color: call.responsible ? 'var(--fg-62)' : 'var(--warn-fg)' }}>{ansText}</span>}
      </div>
      {call.crew.map((s, i) => {
        const who = s.user?.id ?? '';
        const hit = hitRoles.has(s.crew_role) || (who && hitUsers.has(who));
        const isAns = !!who && call.responsible?.id === who;
        const options = users.filter(u => u.skills.includes(s.crew_role));
        return (
          <div key={s.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, minHeight: 46, padding: '3px 3px 3px 12px', borderRadius: 16,
            ...(hit ? { background: 'rgba(255,107,94,.12)', border: '1px solid rgba(255,107,94,.35)' }
              : who ? { background: 'rgba(var(--tint), .035)', border: '1px solid rgba(var(--tint), .06)' }
              : { background: 'rgba(247,185,85,.07)', border: '1px dashed rgba(247,185,85,.4)' }),
          }}>
            <label htmlFor={`crew-${s.id}`} style={{ width: 84, flex: 'none', fontSize: 13, color: 'rgba(var(--tint), .68)' }}>{CREW_ROLE_LABEL[s.crew_role]}</label>
            <select id={`crew-${s.id}`} className="sel" value={who} disabled={!editable || put.isPending}
              onChange={e => save(slots.map((x, j) => (j === i ? { ...x, user_id: e.target.value || null } : x)))}
              style={who ? undefined : { color: 'var(--warn-fg)' }}>
              <option value="">Velg person</option>
              {options.map(u => <option key={u.id} value={u.id}>{u.short_name}</option>)}
            </select>
            {auto && who && <span style={{ fontSize: 12, flex: 'none', minHeight: 40, padding: '0 12px', borderRadius: 999, background: '#F2F5F3', color: '#1A231E', display: 'flex', alignItems: 'center' }}>Ansvarlig</span>}
            {!auto && who && editable && (
              <button type="button" aria-pressed={isAns} aria-label={isAns ? `${s.user?.short_name} er ansvarlig` : `Gjør ${s.user?.short_name} til ansvarlig`}
                onClick={() => save(slots, isAns ? null : who)} disabled={put.isPending}
                style={{ fontSize: 12, cursor: 'pointer', flex: 'none', minHeight: 40, padding: '0 12px', borderRadius: 999,
                  ...(isAns ? { background: '#F2F5F3', color: '#1A231E', border: '1px solid #F2F5F3' } : { background: 'transparent', color: 'rgba(var(--tint), .62)', border: '1px dashed rgba(var(--tint), .3)' }) }}>
                Ansvarlig
              </button>
            )}
            {!auto && isAns && !editable && <span style={{ fontSize: 12, flex: 'none', minHeight: 40, padding: '0 12px', borderRadius: 999, background: '#F2F5F3', color: '#1A231E', display: 'flex', alignItems: 'center' }}>Ansvarlig</span>}
          </div>
        );
      })}
      {!call.crew.length && <span className="muted" style={{ margin: '0 6px', fontSize: 13 }}>Ingen roller satt opp.</span>}
      {call.boat_crane && <span style={{ margin: '2px 6px 0', fontSize: 12, color: 'rgba(var(--tint), .6)' }}>+ Båtens egen kran brukes</span>}
      {!editable && call.crew.some(s => !s.user) && call.status !== 'ferdig' && (
        <span style={{ margin: '2px 6px 0', fontSize: 12, color: 'rgba(var(--tint), .55)' }}>Navn og ansvarlig settes av produksjonen.</span>
      )}
      {error && <div className="error-box" role="alert">{error}</div>}
    </div>
  );
}
