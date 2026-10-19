import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { usePrefill } from '../lib/prefill.ts';
import type { BoatView } from '../../../shared/api.ts';
import { FLAGS, FLAG_LABEL, type Flag } from '../../../shared/domain/types.ts';
import { Phone, Plus } from '../components/Icons.tsx';
import { Page } from '../components/Topbar.tsx';
import { BigNumber, FlagBadge, Loading, RatingBars, SearchBox } from '../components/ui.tsx';
import { errorText } from '../lib/api.ts';
import { FLAG_STYLE, ddmm, dayRelative, fr, osloTime, serviceDate, telHref } from '../lib/format.ts';
import { useBoat, useBoats, useFlagOverride, useMe } from '../lib/queries.ts';
import { canFlag, canPlan } from '../lib/roles.ts';
import { BoatForm } from '../components/BoatForm.tsx';
import { BoatPhotos } from '../components/BoatPhotos.tsx';
import { tr, tx } from '../lib/i18n.ts';
import { Translated } from '../components/Translated.tsx';

type Filter = 'alle' | 'red' | 'yellow' | 'green';

const nextText = (b: BoatView) => {
  const n = b.next_call;
  if (!n) return null;
  return `${dayRelative(serviceDate(n.eta))}${n.time_known ? ` ${osloTime(n.eta)}` : ''} · ${n.quay_name}${n.status === 'ved_kai' ? ` (${tr('ved kai nå')})` : ''}`;
};

export function BaaterPage() {
  const boats = useBoats();
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<'ny' | 'rediger' | null>(null);
  const [prefill] = usePrefill(['navn', 'mmsi']);
  useEffect(() => { if (prefill) setEditing('ny'); }, [prefill]);
  const [filter, setFilter] = useState<Filter>('alle');
  const [q, setQ] = useState('');
  const list = boats.data ?? [];
  const needle = q.trim().toLowerCase();
  const visible = list.filter(b => (filter === 'alle' || b.flag === filter) && (!needle || b.name.toLowerCase().includes(needle) || b.agent?.name.toLowerCase().includes(needle)));
  const selId = params.get('id') ?? visible[0]?.id ?? null;
  const cnt = (f: Flag) => list.filter(b => b.flag === f).length;

  return (
    <Page>
      <div style={{ flex: '999 1 640px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title">{tr('Båter')}</h1>
            <span className="muted">{tr('Kaiboka · {n} fartøy · {r} rødt flagg · {g} gult varsel', { n: list.length, r: cnt('red'), g: cnt('yellow') })}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div role="group" aria-label={tr('Filtrer på flagg')} className="pill seg">
              {([['alle', 'Alle', '#F2F5F3'], ['red', 'Rødt', '#FF6B5E'], ['yellow', 'Gult', '#F7B955'], ['green', 'Grønt', '#5BD68A']] as const).map(([k, l, c]) => (
                <button key={k} type="button" className="tab" aria-pressed={filter === k} onClick={() => setFilter(k)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="dot" style={{ width: 7, height: 7, background: c }} />{tr(l)}
                </button>
              ))}
            </div>
            <SearchBox value={q} onChange={setQ} placeholder={tr('Båt eller agent')} label={tr('Søk etter båt eller agent')} />
            {canPlan(me.data) && (
              <button type="button" className="btn btn-w" onClick={() => setEditing('ny')} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 46 }}>
                <Plus size={16} strokeWidth={2.2} />{tr('Ny båt')}
              </button>
            )}
          </div>
        </div>

        <div className="scroll" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(230px, 100%), 1fr))', gap: 12, maxHeight: 'calc(100vh - 200px)', paddingRight: 4 }}>
          {boats.isPending && <Loading />}
          {visible.map(b => {
            const on = b.id === selId;
            const next = nextText(b);
            return (
              <button key={b.id} type="button" aria-pressed={on} onClick={() => setParams({ id: b.id }, { replace: true })}
                style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 24, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, backdropFilter: 'blur(18px)', transition: 'background .2s',
                  ...(on ? { background: 'linear-gradient(160deg, rgba(var(--tint), .16), rgba(var(--tint), .05))', border: '1px solid rgba(var(--tint), .24)' } : { background: 'rgba(var(--glass-rgb), .6)', border: '1px solid rgba(var(--tint), .08)' }) }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, width: '100%' }}>
                  <span style={{ fontSize: 19, lineHeight: 1.2 }}>{b.name}</span>
                  <FlagBadge flag={b.flag} icon={false} />
                </span>
                <BigNumber value={b.rating_count ? b.avg_total : null} />
                <RatingBars variant="card" values={{ p: b.avg_punctuality, s: b.avg_cooperation, u: b.avg_equipment }} />
                <span style={{ fontSize: 13, color: 'var(--fg-62)' }}>
                  {next ? <span style={{ color: 'var(--aqua)' }}>{tr('Neste: {hva}', { hva: next })}</span> : b.rating_count ? tr('{n} kaibøker · sist {dato}', { n: b.rating_count, dato: ddmm(b.last_log_at!) }) : tr('Ingen kaibøker ennå')}
                </span>
              </button>
            );
          })}
          {boats.isSuccess && !visible.length && <p className="empty">{tr('Ingen båter matcher.')}</p>}
        </div>
      </div>

      {editing ? (
        <aside className="glass scroll" style={{ flex: '1 1 360px', maxWidth: 400, padding: 20, maxHeight: 'calc(100vh - 120px)', position: 'sticky', top: 20 }}>
          <BoatForm key={prefill?.n} initial={editing === 'ny' ? prefill ?? undefined : undefined} boat={editing === 'rediger' ? list.find(b => b.id === selId) : undefined} onClose={() => setEditing(null)}
            onSaved={id => { setEditing(null); setParams({ id }, { replace: true }); }} />
        </aside>
      ) : selId && <BoatProfile id={selId} onEdit={canPlan(me.data) ? () => setEditing('rediger') : undefined} />}
    </Page>
  );
}

function BoatProfile({ id, onEdit }: { id: string; onEdit?: () => void }) {
  const boat = useBoat(id);
  const me = useMe();
  const b = boat.data;
  if (!b) return <aside className="glass" style={{ flex: '1 1 360px', maxWidth: 400, padding: 20 }}><Loading /></aside>;
  const next = nextText(b);
  const contacts = [
    b.agent && [tr('Agent'), b.agent.name, b.agent.phone],
    b.ship_phone && [tr('Båtens mobil'), b.ship_contact ?? b.name, b.ship_phone],
  ].filter((x): x is [string, string, string] => !!x && !!x[2]);

  return (
    <aside className="glass scroll" aria-labelledby="prof-h" style={{ flex: '1 1 360px', maxWidth: 400, padding: 20, display: 'flex', flexDirection: 'column', gap: 18, maxHeight: 'calc(100vh - 120px)', position: 'sticky', top: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--fg-62)' }}>{tr('Båtprofil')}{b.mmsi ? ` · MMSI ${b.mmsi}` : ` · ${tr('mangler MMSI')}`}{b.imo ? ` · IMO ${b.imo}` : ''}</span>
          {onEdit && <button type="button" className="tab" onClick={onEdit} style={{ minHeight: 32, fontSize: 13 }}>{tr('Rediger')}</button>}
        </span>
        <h2 id="prof-h" style={{ margin: 0, fontSize: 32, fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{b.name}</h2>
        <FlagBadge flag={b.flag} style={{ alignSelf: 'flex-start', fontSize: 13, padding: '4px 11px', gap: 6 }} />
        {b.flag_reason && <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--fg-75)' }}>{tx(b.flag_reason)}</p>}
        {b.note && !(b.flag_reason && b.note.startsWith(b.flag_reason)) && <Translated as="p" text={b.note} style={{ margin: 0, fontSize: 14, color: 'var(--fg-62)' }} />}
      </div>

      {canFlag(me.data) && <FlagOverride boat={b} />}

      <BoatPhotos boat={b} />

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <BigNumber value={b.rating_count ? b.avg_total : null} size={64} />
        <span style={{ fontSize: 13, color: 'var(--fg-62)', paddingBottom: 8 }}>{b.rating_count ? tr('av 5 · snitt av {n} kaibøker', { n: b.rating_count }) : tr('ingen vurderinger ennå')}</span>
      </div>
      <RatingBars values={{ p: b.avg_punctuality, s: b.avg_cooperation, u: b.avg_equipment }} />

      {next && b.next_call && (
        <Link to={`/?id=${b.next_call.id}`} style={{ borderRadius: 18, padding: '12px 14px', background: 'rgba(128,239,222,.1)', border: '1px solid rgba(128,239,222,.2)', display: 'flex', flexDirection: 'column', textDecoration: 'none' }}>
          <span style={{ fontSize: 12, color: 'var(--fg-62)' }}>{tr('Neste anløp')}</span>
          <span>{next}</span>
        </Link>
      )}

      {contacts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 400, color: 'var(--fg-62)' }}>{tr('Kontakt')}</h3>
          {contacts.map(([kind, name, phone]) => (
            <a key={kind} className="tel" href={telHref(phone)} style={{ minHeight: 56, padding: '8px 8px 8px 14px', borderRadius: 18 }} aria-label={tr('Ring {hvem}, {navn}', { hvem: kind.toLowerCase(), navn: name })}>
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12, color: 'rgba(var(--tint), .6)' }}>{kind}</span>
                <span style={{ fontSize: 14 }}>{name}</span>
              </span>
              <span className="n" style={{ fontSize: 13, color: 'var(--fg-75)' }}>{phone}</span>
              <span style={{ width: 36, height: 36, flex: 'none', borderRadius: '50%', background: '#5BD68A', color: '#1A231E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Phone size={15} strokeWidth={2} /></span>
            </a>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 400, color: 'var(--fg-62)' }}>{tr('Siste kaibøker')}</h3>
        {b.recent_logs.map(l => (
          <div key={l.id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(var(--tint), .06)', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span className="n" style={{ fontSize: 12, color: 'rgba(var(--tint), .6)' }}>
              {ddmm(l.delivered_at)} · {l.delivered_by?.short_name} · {fr(l.avg)}/5{l.had_deviation && <span style={{ color: 'var(--bad-fg)' }}> · {tr('Avvik')}</span>}
            </span>
            <Translated text={l.had_deviation && l.description ? l.description : l.boat_note ?? '—'} style={{ fontSize: 14 }} />
          </div>
        ))}
        {!b.recent_logs.length && <p style={{ margin: 0, padding: '10px 0', fontSize: 14, color: 'var(--fg-62)' }}>{tr('Ingen kaibøker ennå. Første anløp fyller profilen.')}</p>}
      </div>
    </aside>
  );
}

function FlagOverride({ boat }: { boat: BoatView }) {
  const mut = useFlagOverride(boat.id);
  const [open, setOpen] = useState(false);
  const [flag, setFlag] = useState<Flag>(boat.flag);
  const [reason, setReason] = useState('');

  if (boat.flag_overridden && !open) {
    return (
      <div style={{ borderRadius: 16, padding: '10px 12px', background: 'rgba(var(--tint), .04)', border: '1px dashed rgba(var(--tint), .25)', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
        <span className="muted">{tr('Overstyrt av {navn} · automatisk ville vært «{flagg}»', { navn: boat.flag_override_by?.short_name ?? tr('ukjent'), flagg: tx(FLAG_LABEL[boat.flag_auto]) })}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn" style={{ minHeight: 36, fontSize: 13 }} onClick={() => { setFlag(boat.flag); setOpen(true); }}>{tr('Endre')}</button>
          <button type="button" className="btn" style={{ minHeight: 36, fontSize: 13 }} disabled={mut.isPending} onClick={() => mut.mutate(null)}>{tr('Bruk automatisk flagg')}</button>
        </div>
      </div>
    );
  }
  if (!open) {
    return <button type="button" className="btn" onClick={() => setOpen(true)} style={{ alignSelf: 'flex-start', minHeight: 36, fontSize: 13 }}>{tr('Overstyr flagg')}</button>;
  }
  return (
    <form onSubmit={e => { e.preventDefault(); mut.mutate({ flag, reason }, { onSuccess: () => { setOpen(false); setReason(''); } }); }}
      style={{ borderRadius: 18, padding: 12, background: 'rgba(var(--tint), .04)', border: '1px solid rgba(var(--tint), .07)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div role="group" aria-label={tr('Flagg')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {FLAGS.map(f => (
          <button key={f} type="button" aria-pressed={flag === f} onClick={() => setFlag(f)} className="badge"
            style={{ cursor: 'pointer', minHeight: 34, fontSize: 13, background: flag === f ? FLAG_STYLE[f].bg : 'transparent', color: FLAG_STYLE[f].c, border: `1px solid ${flag === f ? FLAG_STYLE[f].c : 'rgba(var(--tint), .12)'}` }}>
            {tx(FLAG_LABEL[f])}
          </button>
        ))}
      </div>
      <label className="field"><span>{tr('Begrunnelse (påkrevd)')}</span>
        <input className="inp" value={reason} onChange={e => setReason(e.target.value)} placeholder={tr('Hvorfor overstyres flagget?')} required minLength={3} />
      </label>
      {mut.isError && <div className="error-box" role="alert">{errorText(mut.error)}</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="submit" className="btn btn-w" disabled={reason.trim().length < 3 || mut.isPending} style={{ minHeight: 38, fontSize: 13 }}>{tr('Lagre')}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)} style={{ minHeight: 38, fontSize: 13 }}>{tr('Avbryt')}</button>
      </div>
    </form>
  );
}
