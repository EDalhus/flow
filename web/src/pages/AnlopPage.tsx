import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { CollisionView, PortCallView } from '../../../shared/api.ts';
import { CREW_ROLES, CREW_ROLE_LABEL, FLAG_LABEL, type CrewRole } from '../../../shared/domain/types.ts';
import type { PortCallCreateInput } from '../../../shared/schemas.ts';
import { isoWeek, osloToUtc } from '../../../shared/time.ts';
import { Close, Minus, Plus } from '../components/Icons.tsx';
import { Page } from '../components/Topbar.tsx';
import { BoatFlagLine, Loading, SearchBox, Segmented, StatusBadge } from '../components/ui.tsx';
import { api, errorText } from '../lib/api.ts';
import { FLAG_STYLE, addDays, crewSummary, dayHeading, dayShort, fr, goodsShort, hmFromIso, nb, timeRange, todayOslo, typeLabel } from '../lib/format.ts';
import { useBoats, useCreatePortCall, useMe, usePortCalls, useProducts, useQuays, useUsers, type Sku } from '../lib/queries.ts';
import { canPlan } from '../lib/roles.ts';
import './anlop.css';

type Filter = 'idag' | 'uke' | 'kollisjon';

export function AnlopPage() {
  const today = todayOslo();
  const calls = usePortCalls(today, addDays(today, 7));
  const me = useMe();
  const [filter, setFilter] = useState<Filter>('uke');
  const [q, setQ] = useState('');
  const [params] = useSearchParams();
  const [showNew, setShowNew] = useState(params.get('ny') === '1');
  const [fresh, setFresh] = useState<string | null>(null);

  const list = calls.data?.calls ?? [];
  const needle = q.trim().toLowerCase();
  const visible = list.filter(c =>
    (!needle || c.boat.name.toLowerCase().includes(needle)) &&
    (filter === 'uke' || (filter === 'idag' && c.service_date === today) || (filter === 'kollisjon' && c.collisions.length > 0)));
  const days = [...new Set(visible.map(c => c.service_date))].sort();
  const left = list.filter(c => c.service_date === today && c.status !== 'ferdig').length;

  return (
    <Page>
      <div style={{ flex: '999 1 760px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title">Anløp</h1>
            <span className="muted">Flatholmen · uke {isoWeek(today).week} · {left} gjenstår i dag</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Segmented<Filter> label="Periode" value={filter} onChange={setFilter}
              options={[{ value: 'idag', label: 'I dag' }, { value: 'uke', label: 'Neste 7 dager' }, { value: 'kollisjon', label: 'Kollisjoner' }]} />
            <SearchBox value={q} onChange={setQ} placeholder="Søk båt" label="Søk etter båt" />
            {canPlan(me.data) && (
              <button type="button" className="btn btn-w" onClick={() => setShowNew(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 46 }}>
                <Plus size={16} strokeWidth={2.2} />Nytt anløp
              </button>
            )}
          </div>
        </div>

        <section className="glass" aria-label="Anløpsliste" style={{ overflow: 'hidden' }}>
          <div className="arow hide-s" style={{ fontSize: 12, color: 'var(--fg-55)', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
            <span>Tid</span><span>Båt</span><span>Type</span><span>Kai</span><span>Varer</span><span>Mannskap</span><span>Status</span>
          </div>
          <div className="scroll" style={{ maxHeight: 'calc(100vh - 290px)', minHeight: 200 }}>
            {calls.isPending && <Loading />}
            {days.map(d => {
              const items = visible.filter(c => c.service_date === d);
              return (
                <div key={d}>
                  <div style={{ padding: '14px 18px 6px', fontSize: 13, color: 'var(--fg-62)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{dayHeading(d, today)}</span><span className="n">{items.length} anløp</span>
                  </div>
                  {items.map(c => <Row key={c.id} call={c} fresh={c.id === fresh} />)}
                </div>
              );
            })}
            {calls.isSuccess && !days.length && <p className="empty">Ingen anløp matcher søket.</p>}
          </div>
        </section>
      </div>

      {showNew && (
        <NewCallDrawer onClose={() => setShowNew(false)} existing={list}
          onCreated={c => { setShowNew(false); setFilter('uke'); setFresh(c.id); }} />
      )}
    </Page>
  );
}

function Row({ call: c, fresh }: { call: PortCallView; fresh: boolean }) {
  const crew = crewSummary(c);
  const boats = [...new Set(c.collisions.flatMap(x => x.with.map(w => w.boat_name)))];
  return (
    <Link to={`/?id=${c.id}`} className="arow arow-link" aria-label={`${c.boat.name}, ${timeRange(c)} – åpne i kartet`}
      style={{ borderTop: '1px solid rgba(255,255,255,.05)', ...(fresh ? { background: 'rgba(157,184,255,.08)' } : c.status === 'ferdig' ? { opacity: .55 } : {}) }}>
      <span className="n" style={{ fontSize: 15 }}>{timeRange(c)}</span>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          {c.boat.name}
          {fresh && <span style={{ fontSize: 11, borderRadius: 999, padding: '1px 8px', background: '#9DB8FF', color: '#0B0E11' }}>Ny</span>}
        </span>
        <BoatFlagLine boat={c.boat} />
      </span>
      <span style={{ fontSize: 14, color: 'rgba(243,245,246,.8)' }}>{typeLabel(c.type)}</span>
      <span style={{ fontSize: 14 }}>{c.quay.name}</span>
      <span style={{ fontSize: 14, color: 'rgba(243,245,246,.8)' }}>{goodsShort(c.goods) || '–'}</span>
      <span style={{ display: 'flex', flexDirection: 'column', fontSize: 13, lineHeight: 1.35 }}>
        <span style={{ color: crew.ansWarn ? '#F7C873' : undefined }}>{crew.ansText}</span>
        <span style={{ color: 'var(--fg-55)' }}>{crew.crewText}</span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
        <StatusBadge status={c.status} basis={c.status_basis} />
        {c.collisions.length > 0 && <span style={{ fontSize: 12, color: '#FF9A91' }}>{boats.length ? `Kolliderer med ${boats.join(', ')}` : c.collisions[0].text}</span>}
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------- nytt anløp

type Line = { sku_id: string; quantity: string };

const skuLabel = (name: string, s: Sku) =>
  s.unit === 'BB' ? `${name} – BB` : `${name} – 25 kg × ${s.bags_per_unit} · ${s.pallet_type === 'srs' ? 'SRS-pall' : 'Europall'}`;

function NewCallDrawer({ onClose, onCreated, existing }: { onClose: () => void; onCreated: (c: PortCallView) => void; existing: PortCallView[] }) {
  const me = useMe();
  const boats = useBoats();
  const quays = useQuays();
  const products = useProducts();
  const users = useUsers();
  const create = useCreatePortCall();
  const today = todayOslo();

  const sellers = (users.data ?? []).filter(u => u.roles.includes('salg'));
  const [boatId, setBoatId] = useState('');
  const [type, setType] = useState<'levering' | 'henting'>('levering');
  const [quayId, setQuayId] = useState('');
  const [date, setDate] = useState(today);
  const [eta, setEta] = useState('12:00');
  const [etd, setEtd] = useState('15:00');
  const [lines, setLines] = useState<Line[]>([{ sku_id: '', quantity: '200' }]);
  const [roles, setRoles] = useState<Record<CrewRole, number>>({ truck: 1, anhuker: 1, kaikran: 0 });
  const [crane, setCrane] = useState(true);
  const [sellerId, setSellerId] = useState('');
  const [check, setCheck] = useState<{ collisions: CollisionView[] } | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  // Standardvalg når oppslagene er lastet.
  const boatList = useMemo(() => [...(boats.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'nb')), [boats.data]);
  const boat = boatList.find(b => b.id === boatId) ?? boatList[0];
  const quay = quayId || quays.data?.[0]?.id || '';
  const seller = sellerId || (me.data?.roles.includes('salg') ? me.data.id : sellers[0]?.id ?? '');
  const allSkus = (products.data ?? []).flatMap(p => p.skus.map(s => ({ ...s, name: p.name })));
  const goods = lines.map(l => ({ sku: allSkus.find(s => s.id === (l.sku_id || allSkus[0]?.id)), qty: Number(l.quantity) || 0 }));

  const etaIso = osloToUtc(date, eta || '00:00');
  const etdIso = osloToUtc(date, etd || '00:00');
  const timesOk = /^\d{2}:\d{2}$/.test(eta) && /^\d{2}:\d{2}$/.test(etd) && etdIso > etaIso;
  const crew = CREW_ROLES.flatMap(r => Array.from({ length: roles[r] }, () => ({ crew_role: r })));
  const total = crew.length;

  const draft: PortCallCreateInput | null = boat && quay && timesOk ? {
    boat_id: boat.id, type, quay_id: quay, eta: etaIso, etd: etdIso, boat_crane: crane, seller_id: seller || null,
    goods: goods.filter(g => g.sku && g.qty > 0).map(g => ({ sku_id: g.sku!.id, quantity: g.qty })),
    crew: crew.map(s => ({ ...s, user_id: null })),
  } : null;

  // Kollisjonssjekk mot API-et mens skjemaet fylles ut.
  const key = JSON.stringify(draft && { ...draft, goods: [] });
  useEffect(() => {
    if (!draft) { setCheck(null); return; }
    const t = setTimeout(() => {
      api<{ collisions: CollisionView[] }>('/port-calls/check', { body: draft })
        .then(r => { setCheck(r); setCheckError(null); })
        .catch(e => setCheckError(errorText(e)));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const applySuggestion = (s: CollisionView['suggestions'][number]) => {
    if (s.kind === 'move_quay') setQuayId(s.quay_id);
    else { setEta(hmFromIso(s.eta)); setEtd(hmFromIso(s.etd)); }
  };

  const tonnes = goods.reduce((sum, g) => sum + (g.sku ? (g.qty * g.sku.kg_per_unit) / 1000 : 0), 0);
  const canSave = !!draft && (draft.goods?.length ?? 0) > 0 && total > 0 && !create.isPending;
  const save = () => draft && canSave && create.mutate(draft, { onSuccess: onCreated });

  const f = boat ? FLAG_STYLE[boat.flag] : null;
  const dates = Array.from({ length: 21 }, (_, i) => addDays(today, i));
  const boatsById = new Map(existing.map(c => [c.id, c.boat.name]));

  return (
    <aside className="glass scroll drawer" aria-labelledby="new-h"
      style={{ flex: '1 1 380px', maxWidth: 420, padding: 20, display: 'flex', flexDirection: 'column', gap: 16, maxHeight: 'calc(100vh - 120px)', marginTop: 4, position: 'sticky', top: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 id="new-h" style={{ margin: 0, fontSize: 24, fontWeight: 300 }}>Nytt anløp</h2>
        <button type="button" className="icon-btn pill" onClick={onClose} aria-label="Lukk skjema" style={{ width: 40, height: 40 }}><Close size={16} /></button>
      </div>

      <label className="field"><span>Båt</span>
        <select className="inp" value={boat?.id ?? ''} onChange={e => setBoatId(e.target.value)}>
          {boatList.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      {boat && f && (
        <div className={boat.flag === 'red' ? 'alert-red' : boat.flag === 'yellow' ? 'alert-yellow' : ''}
          style={{ display: 'flex', alignItems: 'center', gap: 10, borderRadius: 16, padding: '10px 12px', ...(boat.flag === 'green' || boat.flag === 'none' ? { background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)' } : {}) }}>
          <span className="dot" style={{ width: 8, height: 8, background: f.dot }} />
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.35, fontSize: 13 }}>
            <span>{FLAG_LABEL[boat.flag]}{boat.rating_count ? ` · ${fr(boat.avg_total)} av 5 · ${boat.rating_count} kaibøker` : ''}</span>
            <span style={{ color: 'rgba(243,245,246,.65)' }}>{boat.note ?? boat.flag_reason}</span>
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        <div className="field"><span>Type</span>
          <Segmented label="Type" value={type} onChange={setType} stretch options={[{ value: 'levering', label: 'Levering' }, { value: 'henting', label: 'Henting' }]} />
        </div>
        <div className="field"><span>Kai</span>
          <Segmented label="Kai" value={quay} onChange={setQuayId} stretch options={(quays.data ?? []).map(qy => ({ value: qy.id, label: qy.name }))} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 10 }}>
        <label className="field"><span>Dag</span>
          <select className="inp" value={date} onChange={e => setDate(e.target.value)}>
            {dates.map(d => <option key={d} value={d}>{dayShort(d)}</option>)}
          </select>
        </label>
        <label className="field"><span>ETA</span><input className="inp n" type="time" value={eta} onChange={e => setEta(e.target.value)} /></label>
        <label className="field"><span>ETD</span><input className="inp n" type="time" value={etd} onChange={e => setEtd(e.target.value)} /></label>
      </div>

      <div className="field"><span>Varer</span>
        {lines.map((l, i) => {
          const g = goods[i];
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <label style={{ flex: 1 }}><span className="sr">Produkt</span>
                  <select className="inp" value={l.sku_id || allSkus[0]?.id || ''} onChange={e => setLines(lines.map((x, j) => (j === i ? { ...x, sku_id: e.target.value } : x)))}>
                    <optgroup label="Bigbag (BB) 1000 kg">
                      {allSkus.filter(s => s.unit === 'BB').map(s => <option key={s.id} value={s.id}>{skuLabel(s.name, s)}</option>)}
                    </optgroup>
                    <optgroup label="Sekk på pall">
                      {allSkus.filter(s => s.unit === 'pall').map(s => <option key={s.id} value={s.id}>{skuLabel(s.name, s)}</option>)}
                    </optgroup>
                  </select>
                </label>
                {lines.length > 1 && (
                  <button type="button" className="icon-btn pill" aria-label="Fjern varelinje" onClick={() => setLines(lines.filter((_, j) => j !== i))} style={{ width: 44, height: 44 }}><Close size={14} /></button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ width: 120 }}><span className="sr">Antall</span>
                  <input className="inp n" type="number" min={1} inputMode="numeric" value={l.quantity} placeholder="Antall"
                    onChange={e => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                </label>
                <span style={{ fontSize: 14, color: 'rgba(243,245,246,.7)' }}>
                  {g.sku?.unit === 'pall' ? 'paller' : 'BB'}{g.sku && g.qty ? ` = ${nb((g.qty * g.sku.kg_per_unit) / 1000)} tonn` : ''}
                </span>
              </div>
            </div>
          );
        })}
        <button type="button" className="btn" onClick={() => setLines([...lines, { sku_id: '', quantity: '' }])} style={{ alignSelf: 'flex-start', minHeight: 38, fontSize: 13 }}>
          + Legg til vare{lines.length > 1 ? ` · totalt ${nb(tonnes)} t` : ''}
        </button>
      </div>

      <div className="field"><span>Roller som trengs</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {CREW_ROLES.map(r => (
            <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '2px 4px 2px 14px', borderRadius: 16, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)' }}>
              <span style={{ flex: 1 }}>{CREW_ROLE_LABEL[r]}</span>
              <button type="button" className="icon-btn pill" onClick={() => setRoles({ ...roles, [r]: Math.max(0, roles[r] - 1) })} aria-label={`Én ${CREW_ROLE_LABEL[r].toLowerCase()} mindre`} style={{ width: 40, height: 40 }}><Minus size={14} strokeWidth={2} /></button>
              <span className="n" style={{ width: 22, textAlign: 'center', fontSize: 17 }} aria-live="polite">{roles[r]}</span>
              <button type="button" className="icon-btn pill" onClick={() => setRoles({ ...roles, [r]: Math.min(10, roles[r] + 1) })} aria-label={`Én ${CREW_ROLE_LABEL[r].toLowerCase()} til`} style={{ width: 40, height: 40 }}><Plus size={14} strokeWidth={2} /></button>
            </div>
          ))}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '0 6px', fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={crane} onChange={e => setCrane(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#F3F5F6' }} />
            Båtens egen kran brukes
          </label>
          <span style={{ fontSize: 12, color: 'var(--fg-55)', padding: '0 6px' }}>
            {total === 1 ? 'Én rolle: personen som settes på blir automatisk ansvarlig.' : total > 1 ? 'Navn og ansvarlig settes av produksjonen.' : 'Legg til minst én rolle.'}
          </span>
        </div>
      </div>

      <label className="field"><span>Selger</span>
        <select className="inp" value={seller} onChange={e => setSellerId(e.target.value)}>
          {sellers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>

      <CheckBox timesOk={timesOk} check={check} error={checkError} boats={boatsById} onApply={applySuggestion} />
      {create.isError && <div className="error-box" role="alert">{errorText(create.error)}</div>}

      <button type="button" className="btn btn-w" onClick={save} disabled={!canSave} style={{ minHeight: 52 }}>
        {create.isPending ? 'Legger inn …' : 'Legg inn anløp'}
      </button>
    </aside>
  );
}

function CheckBox({ timesOk, check, error, boats, onApply }: {
  timesOk: boolean; check: { collisions: CollisionView[] } | null; error: string | null; boats: Map<string, string>;
  onApply: (s: CollisionView['suggestions'][number]) => void;
}) {
  let cls = 'alert-ok', title = 'Ingen kollisjoner – kai og mannskap er ledig';
  if (!timesOk) { cls = 'alert-yellow'; title = 'ETD må være etter ETA'; }
  else if (error) { cls = 'alert-yellow'; title = error; }
  else if (!check) { cls = ''; title = 'Sjekker kai og mannskap …'; }
  else if (check.collisions.length) { cls = 'alert-red'; title = 'Kolliderer med eksisterende anløp'; }
  const suggestions = timesOk && check ? check.collisions.flatMap(c => c.suggestions.filter(s => s.call_id === 'draft')) : [];
  const unique = suggestions.filter((s, i) => suggestions.findIndex(x => x.text === s.text) === i);
  return (
    <div role="status" className={cls}
      style={{ borderRadius: 16, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, ...(cls ? {} : { background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)' }) }}>
      <span>{title}</span>
      {timesOk && check?.collisions.map((c, i) => (
        <span key={i} style={{ fontSize: 13, color: 'rgba(243,245,246,.72)' }}>
          {c.with.map(w => w.boat_name || boats.get(w.id)).filter(Boolean).join(', ') || 'Kapasitet'}: {c.text}
        </span>
      ))}
      {unique.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {unique.map(s => <button key={s.text} type="button" className="btn" onClick={() => onApply(s)} style={{ minHeight: 36, fontSize: 13, padding: '0 12px' }}>{s.text}</button>)}
        </div>
      )}
    </div>
  );
}
