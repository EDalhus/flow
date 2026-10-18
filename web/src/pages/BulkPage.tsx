import { useState } from 'react';
import { Link } from 'react-router';
import type { BulkOrderView, BulkQuality } from '../../../shared/api.ts';
import { bulkDemand, bulkPhase, formatMinSec, parseMinSec } from '../../../shared/domain/bulk.ts';
import { ArrowUpRight, Close, Plus } from '../components/Icons.tsx';
import { Page } from '../components/Topbar.tsx';
import { Loading } from '../components/ui.tsx';
import { errorText } from '../lib/api.ts';
import { fr, osloTime } from '../lib/format.ts';
import { useBulkAction, useBulkOrders, useBulkQualities, useCreateBulkOrder } from '../lib/queries.ts';
import { useNow } from '../lib/useNow.ts';
import './moduler.css';
import { tr } from '../lib/i18n.ts';

/** Bulkbil: sjåførene bestiller salt i steg; hjullasteren ser køen og hva traktene trenger. */
export function BulkPage() {
  const orders = useBulkOrders();
  const qualities = useBulkQualities();
  const now = useNow(1000).getTime();
  const list = orders.data ?? [];
  const open = list.filter(o => o.status === 'bestilt' || o.status === 'lastes');
  const done = list.filter(o => o.status === 'ferdig' || o.status === 'avlyst');
  const demand = bulkDemand(open);

  return (
    <Page>
      <div style={{ flex: '999 1 640px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title">{tr('Bulkbil')}</h1>
            <span className="muted">{tr('Egne biler · salt i bulk, lastet i steg')}</span>
          </div>
          <Link to="/hjullaster" className="btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
            {tr('Hjullasterskjerm')} <ArrowUpRight size={15} />
          </Link>
        </div>

        <section aria-label={tr('Behov i traktene')} style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          {(qualities.data ?? []).map(q => (
            <div key={q.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="qdot" style={{ ['--q' as string]: q.color, width: 9, height: 9 }} />{q.name}</span>
              <span className="n" style={{ fontSize: 34, fontWeight: 300 }}>{fr(demand[q.id] ?? 0)}<span className="muted" style={{ fontSize: 15 }}> t</span></span>
            </div>
          ))}
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="eyebrow">{tr('I kø og lastes')} · {open.length}</span>
          {orders.isPending && <Loading />}
          {open.map(o => <BulkCard key={o.id} order={o} now={now} />)}
          {orders.isSuccess && !open.length && <p className="empty glass">{tr('Ingen bestillinger i kø.')}</p>}
        </section>

        {done.length > 0 && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="eyebrow">{tr('Ferdig i dag')} · {done.length}</span>
            <div className="panel-light" style={{ overflow: 'hidden' }}>
              {done.map(o => (
                <div key={o.id} className="mrow" style={{ gridTemplateColumns: '1fr 2fr auto' }}>
                  <span>{o.truck}<span style={{ display: 'block', fontSize: 13, color: 'var(--fg-55)' }}>{o.destination ?? o.driver?.short_name ?? ''}</span></span>
                  <span style={{ fontSize: 14 }}>{o.steps.map(s => `${fr(s.tonnes)} t ${s.quality_name}`).join(' + ')}</span>
                  <span className="n" style={{ fontSize: 14, color: 'var(--fg-62)' }}>{o.status === 'avlyst' ? tr('Fjernet') : tr('Ferdig {tid}', { tid: o.finished_at ? osloTime(o.finished_at) : '' })}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <OrderForm qualities={qualities.data ?? []} />
    </Page>
  );
}

/** Én bestilling med steg og fase. Lastingen styres ikke herfra; kontoret kan bare fjerne en bestilling. */
function BulkCard({ order: o, now }: { order: BulkOrderView; now: number }) {
  const act = useBulkAction();
  const phase = bulkPhase(o.status, o.steps, now);
  const current = phase.kind === 'laster' ? phase.step : phase.kind === 'pause' ? phase.next : null;
  const last = o.steps[o.steps.length - 1]?.seq;
  return (
    <article className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, borderRadius: 24,
      ...(phase.kind !== 'venter' ? { borderColor: 'rgba(128,239,222,.45)' } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 19 }}>{o.truck}
          <span className="muted" style={{ fontSize: 14, marginLeft: 10 }}>{[o.destination, o.driver?.short_name].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="n" style={{ fontSize: 16 }}>
          {phase.kind === 'venter' && <span className="muted">{tr('Venter · bestilt {tid}', { tid: osloTime(o.created_at) })}</span>}
          {phase.kind === 'laster' && <span style={{ color: 'var(--aqua)' }}>● {tr('Laster steg {n}', { n: phase.step })}</span>}
          {phase.kind === 'pause' && <span style={{ color: 'var(--warn-fg)' }}>{tr('Pause · steg {n} om {tid}', { n: phase.next, tid: formatMinSec((phase.untilMs - now) / 1000) })}</span>}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {o.steps.map(s => (
          <span key={s.id} style={{ ['--q' as string]: s.color, display: 'flex', alignItems: 'center', gap: 8, borderRadius: 16, padding: '8px 12px',
            fontSize: 14, opacity: s.finished_at ? .45 : 1,
            border: `2px solid ${s.seq === current ? s.color : 'var(--line)'}`, background: s.seq === current ? `color-mix(in srgb, ${s.color} 16%, transparent)` : 'rgba(var(--tint), .04)' }}>
            <span className="qdot" />
            {s.target && <span>{s.target === 'bil' ? tr('Bil') : tr('Henger')}:</span>}
            <span className="n">{fr(s.tonnes)} t</span> {s.quality_name}
            {s.pause_after_sec > 0 && s.seq !== last && <span className="muted n" style={{ fontSize: '.8em' }}>· {tr('pause {tid}', { tid: formatMinSec(s.pause_after_sec) })}</span>}
            {s.finished_at && <span className="muted" style={{ fontSize: '.8em' }}>✓</span>}
          </span>
        ))}
        <button type="button" className="btn" disabled={act.isPending} style={{ marginLeft: 'auto', minHeight: 38, fontSize: 14 }}
          onClick={() => confirm(tr('Fjerne bestillingen for {bil}? Bruk dette hvis den ble feil eller ikke blir hentet i dag.', { bil: o.truck })) && act.mutate({ id: o.id, action: 'cancel' })}>
          {tr('Fjern ordre')}
        </button>
      </div>
      {act.isError && <div className="error-box">{errorText(act.error)}</div>}
    </article>
  );
}

type Step = { quality_id: string; tonnes: string; target: 'bil' | 'henger'; pause: string };
const TRUCK_KEY = 'flow-bulkbil';
const BIL: Step = { quality_id: '', tonnes: '16', target: 'bil', pause: '2:00' };
const HENGER: Step = { quality_id: '', tonnes: '12', target: 'henger', pause: '0:00' };

/** Sjåførens bestilling: bilen er alltid med, hengeren legges til som et ekstra steg. */
function OrderForm({ qualities }: { qualities: BulkQuality[] }) {
  const create = useCreateBulkOrder();
  const [truck, setTruck] = useState(() => { try { return localStorage.getItem(TRUCK_KEY) ?? ''; } catch { return ''; } });
  const [destination, setDestination] = useState('');
  const [steps, setSteps] = useState<Step[]>([BIL]);
  const set = (i: number, p: Partial<Step>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));

  const parsed = steps.map((s, i) => ({
    quality_id: s.quality_id, tonnes: Number(s.tonnes.replace(',', '.')), target: s.target,
    pause_after_sec: i === steps.length - 1 ? 0 : parseMinSec(s.pause),
  }));
  const valid = truck.trim() && parsed.every(s => s.quality_id && s.tonnes > 0 && s.tonnes <= 60 && s.pause_after_sec != null);
  const total = parsed.reduce((t, s) => t + (s.tonnes || 0), 0);

  const save = () => {
    if (!valid) return;
    try { localStorage.setItem(TRUCK_KEY, truck.trim()); } catch { /* ikke lagret */ }
    create.mutate({ truck: truck.trim(), destination: destination || null, steps: parsed.map(s => ({ ...s, pause_after_sec: s.pause_after_sec ?? 0 })) }, {
      onSuccess: () => { setDestination(''); setSteps(steps.map(s => ({ ...s, quality_id: '' }))); },
    });
  };

  return (
    <aside className="glass" aria-labelledby="bulk-h" style={{ flex: '1 1 380px', maxWidth: 460, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 20 }}>
      <h2 id="bulk-h" style={{ margin: 0, fontSize: 24, fontWeight: 300 }}>{tr('Bestill lasting')}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>{tr('Bil')}</span><input className="inp" value={truck} onChange={e => setTruck(e.target.value)} placeholder={tr('Bil 2 · SU 12345')} /></label>
        <label className="field"><span>{tr('Til (valgfritt)')}</span><input className="inp" value={destination} onChange={e => setDestination(e.target.value)} /></label>
      </div>
      {steps.map((s, i) => (
        <div key={s.target} className="step-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 }}>
            <span className="eyebrow">{s.target === 'bil' ? tr('Bil') : tr('Henger')}</span>
            {s.target === 'henger' && (
              <button type="button" className="icon-btn" aria-label={tr('Fjern henger')} style={{ width: 32, height: 32 }} onClick={() => setSteps(steps.filter((_, j) => j !== i))}><Close size={14} /></button>
            )}
          </div>
          <div role="group" aria-label={tr('Kvalitet')} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {qualities.map(q => (
              <button key={q.id} type="button" className="qbtn" aria-pressed={s.quality_id === q.id} style={{ ['--q' as string]: q.color }} onClick={() => set(i, { quality_id: q.id })}>
                <span className="qdot" />{q.name}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: i < steps.length - 1 ? '90px 1fr' : '90px', gap: 10, alignItems: 'end' }}>
            <label className="field"><span>{tr('Tonn')}</span><input className="inp n" inputMode="decimal" value={s.tonnes} onChange={e => set(i, { tonnes: e.target.value })} /></label>
            {i < steps.length - 1 && (
              <label className="field"><span>{tr('Pause før henger (min:sek)')}</span>
                <input className="inp n" inputMode="numeric" value={s.pause} onChange={e => set(i, { pause: e.target.value })} placeholder="2:30"
                  aria-invalid={parseMinSec(s.pause) == null} style={parseMinSec(s.pause) == null ? { borderColor: 'var(--bad-fg)' } : undefined} />
              </label>
            )}
          </div>
        </div>
      ))}
      {steps.length === 1 && (
        <button type="button" className="btn" onClick={() => setSteps([...steps, HENGER])}
          style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 38, fontSize: 13 }}>
          <Plus size={14} /> {tr('Legg til henger')}
        </button>
      )}
      {create.isError && <div className="error-box">{errorText(create.error)}</div>}
      <button type="button" className="btn btn-w" disabled={!valid || create.isPending} onClick={save}>{tr('Bestill {n} t', { n: fr(total) })}</button>
    </aside>
  );
}
