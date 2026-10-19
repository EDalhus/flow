import { useState } from 'react';
import { usePrefill } from '../lib/prefill.ts';
import type { TruckOrderView } from '../../../shared/api.ts';
import { Check, Close, Plus } from '../components/Icons.tsx';
import { Page } from '../components/Topbar.tsx';
import { Loading, Segmented, StatStrip } from '../components/ui.tsx';
import { errorText } from '../lib/api.ts';
import { addDays, dayHeading, dayShort, fr, osloTime, todayOslo } from '../lib/format.ts';
import { useCreateTruckOrder, useMe, usePickupTruck, useProducts, useTruckOrders } from '../lib/queries.ts';
import { canPlan, canQuayLog } from '../lib/roles.ts';
import './moduler.css';
import { tr, tx } from '../lib/i18n.ts';
import { SoNo } from '../components/Orders.tsx';

type Filter = 'aapne' | 'alle';

/** Biler: kundebiler som henter pall og BB. Bare forventet dag – klokkeslett er for usikkert. */
export function BilerPage() {
  const today = todayOslo();
  const me = useMe();
  const orders = useTruckOrders();
  const pickup = usePickupTruck();
  const [filter, setFilter] = useState<Filter>('aapne');
  const [showNew, setShowNew] = useState(false);
  const [prefill, clearPrefill] = usePrefill(['kunde', 'reg', 'so']);

  const all = (orders.data ?? []).filter(o => !o.cancelled_at);
  const visible = all.filter(o => filter === 'alle' || !o.picked_up_at);
  const overdue = visible.filter(o => !o.picked_up_at && o.expected_date < today);
  const days = [...new Set(visible.filter(o => !overdue.includes(o)).map(o => o.expected_date))].sort();
  const todayOpen = all.filter(o => o.expected_date === today && !o.picked_up_at);
  const weekOpen = all.filter(o => !o.picked_up_at && o.expected_date <= addDays(today, 6));
  const canPick = canPlan(me.data) || canQuayLog(me.data);

  const group = (title: string, list: TruckOrderView[], tone?: 'bad') => (
    <section key={title} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span className="eyebrow" style={tone === 'bad' ? { color: 'var(--bad-fg)' } : undefined}>{title}</span>
        <span className="muted n" style={{ fontSize: 13 }}>{list.length === 1 ? tr('1 bil') : tr('{n} biler', { n: list.length })} · {fr(list.reduce((t, o) => t + o.tonnes, 0))} t</span>
      </div>
      <div className="panel-light" style={{ overflow: 'hidden' }}>
        {list.map(o => (
          <div key={o.id} className="mrow" style={o.picked_up_at ? { opacity: .55 } : undefined}>
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontSize: 17, display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <SoNo n={o.so_number} style={{ color: 'var(--teal)', fontSize: 15 }} />{o.customer}
              </span>
              <span style={{ fontSize: 13, color: 'var(--fg-55)' }}>
                {[o.carrier, o.reg_no].filter(Boolean).join(' · ') || tr('Transportør ikke satt')}
              </span>
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 14 }}>
              {o.goods.map(g => <span key={g.id}>{tx(g.label)}</span>)}
            </span>
            <span className="n hide-s" style={{ fontSize: 15 }}>{fr(o.tonnes)} t</span>
            <span style={{ justifySelf: 'end' }}>
              {o.picked_up_at ? (
                <button type="button" className="btn" disabled={!canPick || pickup.isPending} onClick={() => pickup.mutate({ id: o.id, undo: true })}
                  title={tr('Angre henting')} style={{ minHeight: 38, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Check size={14} /> {tr('Hentet {tid}', { tid: osloTime(o.picked_up_at) })}
                </button>
              ) : (
                <button type="button" className="btn btn-teal" disabled={!canPick || pickup.isPending} onClick={() => pickup.mutate({ id: o.id })}
                  style={{ minHeight: 38, fontSize: 12, color: '#F2F5F3' }}>
                  {tr('Hentet')}
                </button>
              )}
            </span>
            {o.notes && <span style={{ gridColumn: '1 / -1', fontSize: 13, color: 'var(--fg-62)' }}>{o.notes}</span>}
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <Page>
      <div style={{ flex: '999 1 700px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title">{tr('Biler')}</h1>
            <span className="muted">{tr('Kundebiler som henter pall og BB · forventet dag')}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Segmented<Filter> label={tr('Vis')} value={filter} onChange={setFilter}
              options={[{ value: 'aapne', label: tr('Ikke hentet') }, { value: 'alle', label: tr('Alle') }]} />
            {canPlan(me.data) && (
              <button type="button" className="btn btn-w" onClick={() => setShowNew(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Plus size={16} /> {tr('Ny henting')}
              </button>
            )}
          </div>
        </div>

        <StatStrip items={[
          { label: tr('Ventes i dag'), value: String(todayOpen.length), note: `${fr(todayOpen.reduce((t, o) => t + o.tonnes, 0))} t` },
          { label: tr('Neste 7 dager'), value: String(weekOpen.length), note: `${fr(weekOpen.reduce((t, o) => t + o.tonnes, 0))} t` },
          { label: tr('Forfalt'), value: String(all.filter(o => !o.picked_up_at && o.expected_date < today).length), note: tr('ikke hentet') },
        ]} />

        {orders.isPending && <Loading />}
        {overdue.length > 0 && group(tr('Forfalt – ikke hentet'), overdue, 'bad')}
        {days.map(d => group(dayHeading(d, today), visible.filter(o => o.expected_date === d && !overdue.includes(o))))}
        {orders.isSuccess && !visible.length && <p className="empty">{tr('Ingen biler ventes.')}</p>}
      </div>

      {(showNew || prefill) && <NewTruckDrawer key={prefill?.n} initial={prefill ?? {}} onClose={() => { setShowNew(false); clearPrefill(); }} />}
    </Page>
  );
}

type Line = { sku_id: string; quantity: string };

function NewTruckDrawer({ onClose, initial }: { onClose: () => void; initial: Record<string, string> }) {
  const today = todayOslo();
  const products = useProducts();
  const create = useCreateTruckOrder();
  const [customer, setCustomer] = useState(initial.kunde ?? '');
  const [carrier, setCarrier] = useState('');
  const [regNo, setRegNo] = useState(initial.reg ?? '');
  const [so, setSo] = useState(initial.so ?? '');
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([{ sku_id: '', quantity: '24' }]);

  const skus = (products.data ?? []).flatMap(p => p.skus.map(s => ({ ...s, name: p.name })));
  const label = (s: (typeof skus)[number]) => (s.unit === 'BB' ? `${s.name} – BB` : `${s.name} – ${tr('pall')} ${s.bags_per_unit} × ${s.bag_kg} kg`);
  const goods = lines.map(l => ({ sku: skus.find(s => s.id === (l.sku_id || skus[0]?.id)), qty: Number(l.quantity) || 0 }));
  const tonnes = goods.reduce((t, g) => t + (g.sku ? (g.qty * g.sku.kg_per_unit) / 1000 : 0), 0);
  const soOk = /^20\d{5}$/.test(so);
  const valid = soOk && customer.trim() && goods.some(g => g.sku && g.qty > 0);

  const save = () => valid && create.mutate({
    customer: customer.trim(), carrier: carrier || null, reg_no: regNo || null, so_number: so, expected_date: date, notes: notes || null,
    goods: goods.filter(g => g.sku && g.qty > 0).map(g => ({ sku_id: g.sku!.id, quantity: g.qty })),
  }, { onSuccess: onClose });

  return (
    <aside className="glass scroll drawer" aria-labelledby="truck-h"
      style={{ flex: '1 1 360px', maxWidth: 420, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 'calc(100vh - 120px)', position: 'sticky', top: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 id="truck-h" style={{ margin: 0, fontSize: 24, fontWeight: 300 }}>{tr('Ny henting')}</h2>
        <button type="button" className="icon-btn pill" onClick={onClose} aria-label={tr('Lukk skjema')} style={{ width: 40, height: 40 }}><Close size={16} /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10 }}>
        <label className="field"><span>{tr('SO-nummer')}</span>
          <input className="inp n" value={so} onChange={e => setSo(e.target.value.replace(/\D/g, '').slice(0, 7))} inputMode="numeric" placeholder="20XXXXX" autoFocus
            aria-invalid={!!so && !soOk} style={so && !soOk ? { borderColor: 'var(--bad-fg)' } : undefined} />
        </label>
        <label className="field"><span>{tr('Kunde')}</span><input className="inp" value={customer} onChange={e => setCustomer(e.target.value)} /></label>
      </div>
      {so && !soOk && <span className="sub" style={{ marginTop: -8, color: 'var(--bad-fg)' }}>{tr('SO-nummeret må være 20 og fem siffer, f.eks. 2043644.')}</span>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>{tr('Transportør')}</span><input className="inp" value={carrier} onChange={e => setCarrier(e.target.value)} /></label>
        <label className="field"><span>{tr('Reg.nr.')}</span><input className="inp" value={regNo} onChange={e => setRegNo(e.target.value.toUpperCase())} /></label>
      </div>
      <label className="field"><span>{tr('Forventet dag')}</span>
        <select className="inp" value={date} onChange={e => setDate(e.target.value)}>
          {Array.from({ length: 30 }, (_, i) => addDays(today, i)).map(d => <option key={d} value={d}>{dayShort(d)}</option>)}
        </select>
      </label>
      <div className="field"><span>{tr('Varer')}</span>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 6 }}>
            <select className="inp" aria-label={tr('Vare')} style={{ flex: 1 }} value={l.sku_id || skus[0]?.id || ''}
              onChange={e => setLines(lines.map((x, j) => (j === i ? { ...x, sku_id: e.target.value } : x)))}>
              {skus.map(s => <option key={s.id} value={s.id}>{label(s)}</option>)}
            </select>
            <input className="inp n" aria-label={tr('Antall')} inputMode="numeric" style={{ width: 80 }} value={l.quantity}
              onChange={e => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value.replace(/\D/g, '') } : x)))} />
            {lines.length > 1 && (
              <button type="button" className="icon-btn pill" aria-label={tr('Fjern vare')} style={{ width: 44, height: 44 }}
                onClick={() => setLines(lines.filter((_, j) => j !== i))}><Close size={14} /></button>
            )}
          </div>
        ))}
        <button type="button" className="btn" onClick={() => setLines([...lines, { sku_id: '', quantity: '1' }])} style={{ alignSelf: 'flex-start', minHeight: 38, fontSize: 13 }}>
          + {tr('Legg til vare')}
        </button>
        <span className="sub n">{tr('Totalt {n} t', { n: fr(tonnes) })}</span>
      </div>
      <label className="field"><span>{tr('Notat')}</span><textarea className="inp" rows={2} value={notes} onChange={e => setNotes(e.target.value)} style={{ padding: 10 }} /></label>
      {create.isError && <div className="error-box">{errorText(create.error)}</div>}
      <button type="button" className="btn btn-w" disabled={!valid || create.isPending} onClick={save}>{tr('Lagre henting')}</button>
    </aside>
  );
}
