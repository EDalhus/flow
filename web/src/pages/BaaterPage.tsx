import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
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

type Filter = 'alle' | 'red' | 'yellow' | 'green';

const nextText = (b: BoatView) => {
  const n = b.next_call;
  if (!n) return null;
  return `${dayRelative(serviceDate(n.eta))} ${osloTime(n.eta)} · ${n.quay_name}${n.status === 'ved_kai' ? ' (ved kai nå)' : ''}`;
};

export function BaaterPage() {
  const boats = useBoats();
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<'ny' | 'rediger' | null>(null);
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
            <h1 className="page-title">Båter</h1>
            <span className="muted">Kaiboka · {list.length} fartøy · {cnt('red')} rødt flagg · {cnt('yellow')} gult varsel</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div role="group" aria-label="Filtrer på flagg" className="pill seg">
              {([['alle', 'Alle', '#F3F5F6'], ['red', 'Rødt', '#FF6B5E'], ['yellow', 'Gult', '#F7B955'], ['green', 'Grønt', '#5BD68A']] as const).map(([k, l, c]) => (
                <button key={k} type="button" className="tab" aria-pressed={filter === k} onClick={() => setFilter(k)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="dot" style={{ width: 7, height: 7, background: c }} />{l}
                </button>
              ))}
            </div>
            <SearchBox value={q} onChange={setQ} placeholder="Båt eller agent" label="Søk etter båt eller agent" />
            {canPlan(me.data) && (
              <button type="button" className="btn btn-w" onClick={() => setEditing('ny')} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 46 }}>
                <Plus size={16} strokeWidth={2.2} />Ny båt
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
                  ...(on ? { background: 'linear-gradient(160deg, rgba(255,255,255,.16), rgba(255,255,255,.05))', border: '1px solid rgba(255,255,255,.24)' } : { background: 'rgba(17,21,25,.6)', border: '1px solid rgba(255,255,255,.08)' }) }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, width: '100%' }}>
                  <span style={{ fontSize: 19, lineHeight: 1.2 }}>{b.name}</span>
                  <FlagBadge flag={b.flag} icon={false} />
                </span>
                <BigNumber value={b.rating_count ? b.avg_total : null} />
                <RatingBars variant="card" values={{ p: b.avg_punctuality, s: b.avg_cooperation, u: b.avg_equipment }} />
                <span style={{ fontSize: 13, color: 'var(--fg-62)' }}>{b.rating_count ? `${b.rating_count} kaibøker · sist ${ddmm(b.last_log_at!)}` : 'Ingen kaibøker ennå'}</span>
                {next && <span style={{ fontSize: 13, color: '#9DB8FF' }}>Neste: {next}</span>}
              </button>
            );
          })}
          {boats.isSuccess && !visible.length && <p className="empty">Ingen båter matcher.</p>}
        </div>
      </div>

      {editing ? (
        <aside className="glass scroll" style={{ flex: '1 1 360px', maxWidth: 400, padding: 20, maxHeight: 'calc(100vh - 120px)', position: 'sticky', top: 20 }}>
          <BoatForm boat={editing === 'rediger' ? list.find(b => b.id === selId) : undefined} onClose={() => setEditing(null)}
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
    b.agent && ['Agent', b.agent.name, b.agent.phone],
    b.ship_phone && ['Båtens mobil', b.ship_contact ?? b.name, b.ship_phone],
  ].filter((x): x is [string, string, string] => !!x && !!x[2]);

  return (
    <aside className="glass scroll" aria-labelledby="prof-h" style={{ flex: '1 1 360px', maxWidth: 400, padding: 20, display: 'flex', flexDirection: 'column', gap: 18, maxHeight: 'calc(100vh - 120px)', position: 'sticky', top: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--fg-62)' }}>Båtprofil{b.mmsi ? ` · MMSI ${b.mmsi}` : ' · mangler MMSI'}{b.imo ? ` · IMO ${b.imo}` : ''}</span>
          {onEdit && <button type="button" className="tab" onClick={onEdit} style={{ minHeight: 32, fontSize: 13 }}>Rediger</button>}
        </span>
        <h2 id="prof-h" style={{ margin: 0, fontSize: 32, fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{b.name}</h2>
        <FlagBadge flag={b.flag} style={{ alignSelf: 'flex-start', fontSize: 13, padding: '4px 11px', gap: 6 }} />
        {b.flag_reason && <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--fg-75)' }}>{b.flag_reason}</p>}
        {b.note && !(b.flag_reason && b.note.startsWith(b.flag_reason)) && <p style={{ margin: 0, fontSize: 14, color: 'var(--fg-62)' }}>{b.note}</p>}
      </div>

      {canFlag(me.data) && <FlagOverride boat={b} />}

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <BigNumber value={b.rating_count ? b.avg_total : null} size={64} />
        <span style={{ fontSize: 13, color: 'var(--fg-62)', paddingBottom: 8 }}>{b.rating_count ? `av 5 · snitt av ${b.rating_count} kaibøker` : 'ingen vurderinger ennå'}</span>
      </div>
      <RatingBars values={{ p: b.avg_punctuality, s: b.avg_cooperation, u: b.avg_equipment }} />

      {next && b.next_call && (
        <Link to={`/?id=${b.next_call.id}`} style={{ borderRadius: 18, padding: '12px 14px', background: 'rgba(157,184,255,.1)', border: '1px solid rgba(157,184,255,.2)', display: 'flex', flexDirection: 'column', textDecoration: 'none' }}>
          <span style={{ fontSize: 12, color: 'var(--fg-62)' }}>Neste anløp</span>
          <span>{next}</span>
        </Link>
      )}

      {contacts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 400, color: 'var(--fg-62)' }}>Kontakt</h3>
          {contacts.map(([kind, name, phone]) => (
            <a key={kind} className="tel" href={telHref(phone)} style={{ minHeight: 56, padding: '8px 8px 8px 14px', borderRadius: 18 }} aria-label={`Ring ${kind.toLowerCase()}, ${name}`}>
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12, color: 'rgba(243,245,246,.6)' }}>{kind}</span>
                <span style={{ fontSize: 14 }}>{name}</span>
              </span>
              <span className="n" style={{ fontSize: 13, color: 'var(--fg-75)' }}>{phone}</span>
              <span style={{ width: 36, height: 36, flex: 'none', borderRadius: '50%', background: '#5BD68A', color: '#0B0E11', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Phone size={15} strokeWidth={2} /></span>
            </a>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 400, color: 'var(--fg-62)' }}>Siste kaibøker</h3>
        {b.recent_logs.map(l => (
          <div key={l.id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span className="n" style={{ fontSize: 12, color: 'rgba(243,245,246,.6)' }}>
              {ddmm(l.delivered_at)} · {l.delivered_by?.short_name} · {fr(l.avg)}/5{l.had_deviation && <span style={{ color: '#FF8A80' }}> · Avvik</span>}
            </span>
            <span style={{ fontSize: 14 }}>{l.had_deviation && l.description ? l.description : l.boat_note ?? '—'}</span>
          </div>
        ))}
        {!b.recent_logs.length && <p style={{ margin: 0, padding: '10px 0', fontSize: 14, color: 'var(--fg-62)' }}>Ingen kaibøker ennå. Første anløp fyller profilen.</p>}
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
      <div style={{ borderRadius: 16, padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px dashed rgba(243,245,246,.25)', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
        <span className="muted">Overstyrt av {boat.flag_override_by?.short_name ?? 'ukjent'} · automatisk ville vært «{FLAG_LABEL[boat.flag_auto]}»</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn" style={{ minHeight: 36, fontSize: 13 }} onClick={() => { setFlag(boat.flag); setOpen(true); }}>Endre</button>
          <button type="button" className="btn" style={{ minHeight: 36, fontSize: 13 }} disabled={mut.isPending} onClick={() => mut.mutate(null)}>Bruk automatisk flagg</button>
        </div>
      </div>
    );
  }
  if (!open) {
    return <button type="button" className="btn" onClick={() => setOpen(true)} style={{ alignSelf: 'flex-start', minHeight: 36, fontSize: 13 }}>Overstyr flagg</button>;
  }
  return (
    <form onSubmit={e => { e.preventDefault(); mut.mutate({ flag, reason }, { onSuccess: () => { setOpen(false); setReason(''); } }); }}
      style={{ borderRadius: 18, padding: 12, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div role="group" aria-label="Flagg" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {FLAGS.map(f => (
          <button key={f} type="button" aria-pressed={flag === f} onClick={() => setFlag(f)} className="badge"
            style={{ cursor: 'pointer', minHeight: 34, fontSize: 13, background: flag === f ? FLAG_STYLE[f].bg : 'transparent', color: FLAG_STYLE[f].c, border: `1px solid ${flag === f ? FLAG_STYLE[f].c : 'rgba(255,255,255,.12)'}` }}>
            {FLAG_LABEL[f]}
          </button>
        ))}
      </div>
      <label className="field"><span>Begrunnelse (påkrevd)</span>
        <input className="inp" value={reason} onChange={e => setReason(e.target.value)} placeholder="Hvorfor overstyres flagget?" required minLength={3} />
      </label>
      {mut.isError && <div className="error-box" role="alert">{errorText(mut.error)}</div>}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="submit" className="btn btn-w" disabled={reason.trim().length < 3 || mut.isPending} style={{ minHeight: 38, fontSize: 13 }}>Lagre</button>
        <button type="button" className="btn" onClick={() => setOpen(false)} style={{ minHeight: 38, fontSize: 13 }}>Avbryt</button>
      </div>
    </form>
  );
}
