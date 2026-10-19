import { useState, type ReactNode } from 'react';
import { BoatPhotos } from './BoatPhotos.tsx';
import type { CollisionView, PortCallView, UserView } from '../../../shared/api.ts';
import { CREW_ROLE_LABEL, CREW_ROLES, type CrewRole } from '../../../shared/domain/types.ts';
import { api, errorText } from '../lib/api.ts';
import { dayRelative, ddmm, fr, hmFromIso, telHref, telShort, timeRange, typeLabel } from '../lib/format.ts';
import { osloToUtc } from '../../../shared/time.ts';
import { useAssignOrder, useBoat, useBoats, useCallLog, useLoadOrder, useMe, useOrders, usePatchPortCall, usePutCrew, useUsers } from '../lib/queries.ts';
import { useNavigate } from 'react-router';
import { CallOrders, OrderLog } from './Orders.tsx';
import { canCrew, canPlan, canQuayLog } from '../lib/roles.ts';
import { Chat } from './Chat.tsx';
import { Check, Chevron, Close, Phone, Plus, Sparkle } from './Icons.tsx';
import { BigNumber, FlagBadge, Loading, QuayMark, Rating, RatingBars, Segmented } from './ui.tsx';
import { tr, tx, getLang } from '../lib/i18n.ts';
import { Translated } from './Translated.tsx';
import { useQuery } from '@tanstack/react-query';
import { Markdown } from './Markdown.tsx';

export type DetailTab = 'oversikt' | 'chat' | 'profil' | 'logg';

export function CallDetail({ call, tab, onTab, onOpenKaibok, onOpenAlerts, onClose, extra }: {
  call: PortCallView; tab: DetailTab; onTab: (t: DetailTab) => void; onOpenKaibok: () => void; onOpenAlerts: () => void; onClose?: () => void;
  /** Ekstra linje under navnet, f.eks. tid til kaia fra AIS. */
  extra?: ReactNode;
}) {
  const boat = useBoat(call.boat.id);
  const users = useUsers();
  const me = useMe();
  const nav = useNavigate();
  const loadOrder = useLoadOrder(call.id);
  const editable = canPlan(me.data) && call.status !== 'ferdig' && call.status !== 'avlyst' && !call.has_quay_log;
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
            <button type="button" className="icon-btn pill" onClick={onClose} aria-label={tr('Lukk anløpet')} title={tr('Lukk (Esc)')} style={{ width: 36, height: 36, flex: 'none', marginRight: -6 }}>
              <Close size={14} />
            </button>
          )}
        </span>
        <h2 id="sel-h" style={{ margin: 0, fontSize: 30, fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1.15 }}>{call.boat.name}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 13 }}>
          <FlagBadge flag={call.boat.flag} style={{ fontSize: 13, padding: '3px 10px' }} />
          <Rating value={call.boat.rating_count ? call.boat.avg_total : null}
            suffix={<span style={{ color: 'var(--fg-62)' }}>· {call.boat.rating_count === 1 ? tr('1 kaibok') : tr('{n} kaibøker', { n: call.boat.rating_count })}</span>} />
        </div>
        {extra && <div style={{ marginTop: 8 }}>{extra}</div>}
      </div>

      <Segmented<DetailTab> label={tr('Anløpsdetaljer')} value={tab} onChange={onTab} stretch
        options={[{ value: 'oversikt', label: tr('Oversikt') }, { value: 'chat', label: `${tr('Chat')} · ${call.message_count}` }, { value: 'profil', label: tr('Båtprofil') }, { value: 'logg', label: tr('Endringer') }]} />

      {tab === 'oversikt' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {canPlan(me.data) && call.status !== 'ferdig' && call.status !== 'avlyst' && !call.has_quay_log && <><BoatEditor call={call} /><TimeEditor call={call} /></>}
          {call.collisions.length > 0 && <ClashButton collisions={call.collisions} onClick={onOpenAlerts} />}
          {me.data?.ai && call.status !== 'ferdig' && call.status !== 'avlyst' && <BoatBrief boatId={call.boat.id} />}
          <CrewEditor call={call} users={users.data ?? []} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h3 style={{ margin: '0 6px', fontSize: 13, fontWeight: 400, color: 'var(--fg-62)' }}>
              {call.orders.length > 1 ? tr('Salgsordre · lasterekkefølge') : tr('Salgsordre')}
            </h3>
            <CallOrders call={call} busy={loadOrder.isPending} onOpen={so => nav(`/anlop?so=${so}`)}
              onReorder={editable ? ids => loadOrder.mutate(ids) : undefined}>
              {editable && <AddOrder call={call} />}
            </CallOrders>
            {loadOrder.isError && <div className="error-box">{errorText(loadOrder.error)}</div>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
            {[
              boat.data?.agent?.phone && [tr('Agent'), boat.data.agent.name, boat.data.agent.phone],
              boat.data?.ship_phone && [tr('Båten'), boat.data.ship_contact ?? call.boat.name, boat.data.ship_phone],
              call.seller?.phone && [tr('Selger'), call.seller.name, call.seller.phone],
            ].filter((x): x is string[] => !!x).map(([kind, name, phone]) => (
              <a key={kind} className="tel" href={telHref(phone)} aria-label={tr('Ring {hvem}, {navn}, {tlf}', { hvem: kind.toLowerCase(), navn: name, tlf: phone })}
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
            <div style={{ borderRadius: 16, padding: '14px 16px', background: 'rgba(177,194,183,.12)', color: '#D6E0D9', fontSize: 14 }}>{tr('Ferdig – kaibok er levert for dette anløpet.')}</div>
          ) : canQuayLog(me.data) ? (
            <button type="button" className="btn btn-w" onClick={onOpenKaibok} style={{ minHeight: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 15 }}>
              <Check size={17} strokeWidth={2.2} />{tr('Ferdigstill og fyll ut kaibok')}
            </button>
          ) : null}
        </div>
      )}

      {tab === 'chat' && <Chat callId={call.id} chips={chips} />}

      {tab === 'logg' && <CallLog callId={call.id} onSo={so => nav(`/anlop?so=${so}`)} />}

      {tab === 'profil' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, padding: '0 6px' }}>
            <BigNumber value={call.boat.rating_count ? call.boat.avg_total : null} size={64} />
            <span style={{ fontSize: 13, color: 'var(--fg-62)', paddingBottom: 8 }}>
              {call.boat.rating_count ? tr('av 5 · snitt av {n} kaibøker', { n: call.boat.rating_count }) : tr('ingen vurderinger ennå')}
            </span>
          </div>
          {boat.data && (
            <div style={{ padding: '0 6px' }}>
              <RatingBars values={{ p: boat.data.avg_punctuality, s: boat.data.avg_cooperation, u: boat.data.avg_equipment }} />
            </div>
          )}
          {call.boat.flag_reason && <p style={{ margin: '0 6px', fontSize: 14, color: 'var(--fg-75)' }}>{tx(call.boat.flag_reason)}</p>}
          {boat.data && <div style={{ padding: '0 6px' }}><BoatPhotos boat={boat.data} /></div>}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ margin: '0 6px 4px', fontSize: 13, fontWeight: 400, color: 'var(--fg-62)' }}>{tr('Siste kaibøker')}</h3>
            {(boat.data?.recent_logs ?? []).slice(0, 5).map(l => (
              <div key={l.id} style={{ padding: '10px 6px', borderBottom: '1px solid rgba(var(--tint), .06)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="n" style={{ fontSize: 12, color: 'rgba(var(--tint), .6)' }}>
                  {ddmm(l.delivered_at)} · {l.delivered_by?.short_name} · {fr(l.avg)}/5
                  {l.had_deviation && <span style={{ color: 'var(--bad-fg)' }}> · {tr('Avvik')}</span>}
                </span>
                <Translated text={l.boat_note ?? l.description ?? '—'} style={{ fontSize: 14 }} />
              </div>
            ))}
            {boat.data && !boat.data.recent_logs.length && <p className="muted" style={{ margin: 0, padding: '10px 6px', fontSize: 14 }}>{tr('Ingen kaibøker ennå.')}</p>}
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
        <span style={{ fontSize: 14 }}>{boats.length ? tr('Kolliderer med {båter}', { båter: boats.join(', ') }) : tr('Kapasitet overskredet')}</span>
        <span style={{ fontSize: 12, color: 'rgba(var(--tint), .65)' }}>{collisions.map(c => tx(c.text)).join(' · ')}</span>
      </span>
      <span style={{ flex: 'none', fontSize: 13, borderRadius: 999, padding: '6px 12px', background: 'rgba(var(--tint), .1)' }}>{tr('Løs')}</span>
    </button>
  );
}

/** Mannskap med personvalg og ansvarlig, som i Main-tavla. Produksjonen setter navn. */
function CrewEditor({ call, users }: { call: PortCallView; users: UserView[] }) {
  const me = useMe();
  const put = usePutCrew();
  const [error, setError] = useState<string | null>(null);
  // Mannskap er valgfritt: sammenfoldet som standard, åpnes når noen vil legge til eller endre.
  const [open, setOpen] = useState(false);
  const [newRole, setNewRole] = useState<CrewRole>('truck');
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
  const named = call.crew.filter(s => s.user);
  const summary = call.crew.length
    ? `${named.length ? named.map(s => s.user!.short_name).join(', ') : tr('Ingen navn ennå')} · ${call.crew.length === 1 ? tr('1 rolle') : tr('{n} roller', { n: call.crew.length })}`
    : tr('Ikke satt opp');

  if (!call.crew.length && !editable) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderRadius: 16, background: 'rgba(var(--tint), .05)', padding: open ? '10px 10px 12px' : 0 }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', color: 'var(--fg)', cursor: 'pointer', padding: open ? '0 2px 4px' : '10px 12px', textAlign: 'left' }}>
        <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <span className="sub">{tr('Mannskap')}{call.responsible ? ` · ${tr('ansvarlig {navn}', { navn: call.responsible.short_name })}` : ''}</span>
          {!open && <span style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>}
        </span>
        <span style={{ fontSize: 13, color: 'var(--fg-62)', flex: 'none' }}>{open ? tr('Lukk') : editable ? (call.crew.length ? tr('Endre') : `+ ${tr('Legg til')}`) : tr('Vis')}</span>
        <Chevron size={15} style={{ flex: 'none', transform: open ? 'rotate(180deg)' : undefined }} />
      </button>

      {open && call.crew.map((s, i) => {
        const who = s.user?.id ?? '';
        const hit = hitRoles.has(s.crew_role) || (who && hitUsers.has(who));
        const isAns = !!who && call.responsible?.id === who;
        const options = users.filter(u => u.skills.includes(s.crew_role));
        return (
          <div key={s.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, minHeight: 46, padding: '3px 3px 3px 12px', borderRadius: 14,
            ...(hit ? { background: 'rgba(255,107,94,.12)', border: '1px solid rgba(255,107,94,.35)' } : { background: 'rgba(var(--tint), .04)', border: '1px solid rgba(var(--tint), .06)' }),
          }}>
            <label htmlFor={`crew-${s.id}`} style={{ width: 84, flex: 'none', fontSize: 13, color: 'rgba(var(--tint), .68)' }}>{tx(CREW_ROLE_LABEL[s.crew_role])}</label>
            <select id={`crew-${s.id}`} className="sel" value={who} disabled={!editable || put.isPending}
              onChange={e => save(slots.map((x, j) => (j === i ? { ...x, user_id: e.target.value || null } : x)))}>
              <option value="">{tr('Ingen valgt')}</option>
              {options.map(u => <option key={u.id} value={u.id}>{u.short_name}</option>)}
            </select>
            {who && (auto || !editable) && isAns && <span style={{ fontSize: 12, flex: 'none', minHeight: 36, padding: '0 10px', borderRadius: 999, background: '#F2F5F3', color: '#1A231E', display: 'flex', alignItems: 'center' }}>{tr('Ansvarlig')}</span>}
            {!auto && who && editable && (
              <button type="button" aria-pressed={isAns} aria-label={isAns ? tr('{navn} er ansvarlig', { navn: s.user?.short_name ?? '' }) : tr('Gjør {navn} til ansvarlig', { navn: s.user?.short_name ?? '' })}
                onClick={() => save(slots, isAns ? null : who)} disabled={put.isPending}
                style={{ fontSize: 12, cursor: 'pointer', flex: 'none', minHeight: 36, padding: '0 10px', borderRadius: 999,
                  ...(isAns ? { background: '#F2F5F3', color: '#1A231E', border: '1px solid #F2F5F3' } : { background: 'transparent', color: 'rgba(var(--tint), .62)', border: '1px dashed rgba(var(--tint), .3)' }) }}>
                {tr('Ansvarlig')}
              </button>
            )}
            {editable && (
              <button type="button" className="icon-btn" aria-label={tr('Fjern {rolle}', { rolle: tx(CREW_ROLE_LABEL[s.crew_role]).toLowerCase() })} disabled={put.isPending}
                onClick={() => save(slots.filter((_, j) => j !== i), isAns ? null : undefined)} style={{ width: 34, height: 34, flex: 'none' }}>
                <Close size={13} />
              </button>
            )}
          </div>
        );
      })}

      {open && editable && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select className="sel" aria-label={tr('Rolle som skal legges til')} value={newRole} onChange={e => setNewRole(e.target.value as CrewRole)} style={{ flex: 'none', width: 'auto' }}>
            {CREW_ROLES.map(r => <option key={r} value={r}>{tx(CREW_ROLE_LABEL[r])}</option>)}
          </select>
          <button type="button" className="btn" disabled={put.isPending} onClick={() => save([...slots, { crew_role: newRole, user_id: null }])}
            style={{ minHeight: 40, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plus size={13} /> {tr('Legg til rolle')}
          </button>
        </div>
      )}
      {open && call.boat_crane && <span style={{ margin: '2px 6px 0', fontSize: 12, color: 'rgba(var(--tint), .6)' }}>+ {tr('Båtens egen kran brukes')}</span>}
      {open && !editable && <span style={{ margin: '2px 6px 0', fontSize: 12, color: 'rgba(var(--tint), .55)' }}>{tr('Mannskap settes av produksjonen.')}</span>}
      {error && <div className="error-box" role="alert">{error}</div>}
    </div>
  );
}

/** Bytt båt på anløpet (rederiet sender en annen båt). Alle SO-ene følger med, og det føres i loggen deres. */
function BoatEditor({ call }: { call: PortCallView }) {
  const patch = usePatchPortCall();
  const boats = useBoats();
  const [open, setOpen] = useState(false);
  const [boatId, setBoatId] = useState(call.boat.id);
  const list = [...(boats.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'nb'));
  if (!open) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', borderRadius: 16, background: 'rgba(var(--tint), .05)' }}>
        <span style={{ fontSize: 14 }}><span className="sub">{tr('Båt')} </span>{call.boat.name}</span>
        <button type="button" className="btn" onClick={() => { setBoatId(call.boat.id); setOpen(true); }} style={{ minHeight: 34, fontSize: 13 }}>{tr('Bytt båt')}</button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 16, background: 'rgba(var(--tint), .05)' }}>
      <span style={{ fontSize: 13, color: 'var(--fg-75)' }}>{tr('Alle SO-ene på anløpet følger med til den nye båten. Skal bare én SO over på en annen båt, flytt den fra SO-en.')}</span>
      <select className="inp" aria-label={tr('Ny båt')} value={boatId} onChange={e => setBoatId(e.target.value)}>
        {list.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      {patch.isError && <div className="error-box">{errorText(patch.error)}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-w" disabled={boatId === call.boat.id || patch.isPending} style={{ minHeight: 38 }}
          onClick={() => patch.mutate({ id: call.id, version: call.version, boat_id: boatId }, { onSuccess: () => setOpen(false) })}>{tr('Lagre')}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)} style={{ minHeight: 38 }}>{tr('Avbryt')}</button>
      </div>
    </div>
  );
}

/** Legg en SO som venter på båt på dette anløpet, eller lag en ny SO til det. */
function AddOrder({ call }: { call: PortCallView }) {
  const orders = useOrders();
  const assign = useAssignOrder();
  const nav = useNavigate();
  const [pick, setPick] = useState('');
  const waiting = (orders.data ?? []).filter(o => o.status === 'venter' || o.status === 'delvis');
  const chosen = waiting.find(o => o.id === pick);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0' }}>
      {waiting.length > 0 && (
        <>
          <select className="sel" aria-label={tr('SO som venter på båt')} value={pick} onChange={e => setPick(e.target.value)} style={{ flex: '1 1 180px' }}>
            <option value="">{tr('Legg til SO som venter på båt …')}</option>
            {waiting.map(o => <option key={o.id} value={o.id}>SO {o.so_number} · {o.customer}{o.wanted_date ? ` · ${dayRelative(o.wanted_date)}` : ''}</option>)}
          </select>
          <button type="button" className="btn" disabled={!chosen || assign.isPending} style={{ minHeight: 38, fontSize: 13 }}
            onClick={() => chosen && assign.mutate({ id: chosen.id, version: chosen.version, placement: { kind: 'call', port_call_id: call.id } }, { onSuccess: () => setPick('') })}>
            {tr('Legg på båten')}
          </button>
        </>
      )}
      <button type="button" className="btn" style={{ minHeight: 38, fontSize: 13 }} onClick={() => nav(`/anlop?ny=1&anlop=${call.id}`)}>+ {tr('Ny SO')}</button>
      {assign.isError && <div className="error-box" style={{ width: '100%' }}>{errorText(assign.error)}</div>}
    </div>
  );
}

function CallLog({ callId, onSo }: { callId: string; onSo: (so: string) => void }) {
  const log = useCallLog(callId);
  if (log.isPending) return <Loading />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 6px' }}>
      <span className="sub">{tr('Alt som er endret på salgsordrene mens de lå på denne båten.')}</span>
      <OrderLog entries={log.data ?? []} showSo onSo={onSo} />
    </div>
  );
}

/** Klokkeslett settes når det blir kjent (ofte ca. en time før båten kommer), og kan fjernes igjen. */
function TimeEditor({ call }: { call: PortCallView }) {
  const patch = usePatchPortCall();
  const [open, setOpen] = useState(false);
  const [eta, setEta] = useState(call.time_known ? hmFromIso(call.eta) : '');
  const [etd, setEtd] = useState(call.time_known ? hmFromIso(call.etd) : '');
  const ok = /^\d{2}:\d{2}$/.test(eta) && /^\d{2}:\d{2}$/.test(etd) && etd > eta;
  const save = () => ok && patch.mutate(
    { id: call.id, version: call.version, eta: osloToUtc(call.service_date, eta), etd: osloToUtc(call.service_date, etd), time_known: true },
    { onSuccess: () => setOpen(false) },
  );
  const clear = () => patch.mutate({ id: call.id, version: call.version, time_known: false }, { onSuccess: () => setOpen(false) });

  if (!open) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', borderRadius: 16, background: 'rgba(var(--tint), .05)' }}>
        <span style={{ fontSize: 14 }}>
          <span className="sub">{tr('Klokkeslett')} </span>
          <span className="n">{call.time_known ? timeRange(call) : tr('ikke satt')}</span>
        </span>
        <button type="button" className="btn" onClick={() => setOpen(true)} style={{ minHeight: 34, fontSize: 13 }}>
          {call.time_known ? tr('Endre') : tr('Sett tid')}
        </button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 16, background: 'rgba(var(--tint), .05)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label className="field"><span>ETA</span><input className="inp n" type="time" value={eta} onChange={e => setEta(e.target.value)} autoFocus /></label>
        <label className="field"><span>ETD</span><input className="inp n" type="time" value={etd} onChange={e => setEtd(e.target.value)} /></label>
      </div>
      {patch.isError && <div className="error-box">{errorText(patch.error)}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-w" disabled={!ok || patch.isPending} onClick={save} style={{ minHeight: 38 }}>{tr('Lagre')}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)} style={{ minHeight: 38 }}>{tr('Avbryt')}</button>
        {call.time_known && <button type="button" className="btn" disabled={patch.isPending} onClick={clear} style={{ minHeight: 38, marginLeft: 'auto' }}>{tr('Fjern tid')}</button>}
      </div>
    </div>
  );
}

/** «Før båten kommer»: kort sammendrag fra Claude av båtens historikk, avvik og ting kaia bør passe på. */
function BoatBrief({ boatId }: { boatId: string }) {
  const q = useQuery({ queryKey: ['boat-brief', boatId, getLang()], queryFn: () => api<{ text: string | null }>(`/ask/boat/${boatId}`), staleTime: 3_600_000, retry: false });
  if (q.isError || (q.data && !q.data.text)) return null;
  return (
    <section style={{ borderRadius: 16, padding: '10px 14px', background: 'rgba(128,239,222,.06)', border: '1px solid rgba(128,239,222,.22)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="eyebrow" style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--aqua)' }}><Sparkle size={12} /> {tr('Før båten kommer')}</span>
      {q.data?.text ? <Markdown text={q.data.text} go={() => {}} /> : <span className="sub loading" style={{ fontSize: 13 }}>{tr('Ser på båtens historikk …')}</span>}
    </section>
  );
}

