import { useState } from 'react';
import { Link } from 'react-router';
import type { BulkOrderView, BulkQuality } from '../../../shared/api.ts';
import { bulkDemand, bulkPhase, formatMinSec, parseMinSec } from '../../../shared/domain/bulk.ts';
import { ArrowUpRight, Close, Plus } from '../components/Icons.tsx';
import { Page } from '../components/Topbar.tsx';
import { Loading, Segmented } from '../components/ui.tsx';
import { errorText } from '../lib/api.ts';
import { fr, osloTime } from '../lib/format.ts';
import { useBulkAction, useBulkOrders, useBulkQualities, useCreateBulkOrder } from '../lib/queries.ts';
import { useNow } from '../lib/useNow.ts';
import './moduler.css';

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
            <h1 className="page-title">Bulkbil</h1>
            <span className="muted">Egne biler · salt i bulk, lastet i steg</span>
          </div>
          <Link to="/hjullaster" className="btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
            Hjullasterskjerm <ArrowUpRight size={15} />
          </Link>
        </div>

        <section aria-label="Behov i traktene" style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          {(qualities.data ?? []).map(q => (
            <div key={q.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="qdot" style={{ ['--q' as string]: q.color, width: 9, height: 9 }} />{q.name}</span>
              <span className="n" style={{ fontSize: 34, fontWeight: 300 }}>{fr(demand[q.id] ?? 0)}<span className="muted" style={{ fontSize: 15 }}> t</span></span>
            </div>
          ))}
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="eyebrow">I kø og lastes · {open.length}</span>
          {orders.isPending && <Loading />}
          {open.map(o => <BulkCard key={o.id} order={o} now={now} />)}
          {orders.isSuccess && !open.length && <p className="empty glass">Ingen bestillinger i kø.</p>}
        </section>

        {done.length > 0 && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span className="eyebrow">Ferdig i dag · {done.length}</span>
            <div className="panel-light" style={{ overflow: 'hidden' }}>
              {done.map(o => (
                <div key={o.id} className="mrow" style={{ gridTemplateColumns: '1fr 2fr auto' }}>
                  <span>{o.truck}<span style={{ display: 'block', fontSize: 13, color: 'var(--fg-55)' }}>{o.destination ?? o.driver?.short_name ?? ''}</span></span>
                  <span style={{ fontSize: 14 }}>{o.steps.map(s => `${fr(s.tonnes)} t ${s.quality_name}`).join(' + ')}</span>
                  <span className="n" style={{ fontSize: 14, color: 'var(--fg-62)' }}>{o.status === 'avlyst' ? 'Avlyst' : `Ferdig ${o.finished_at ? osloTime(o.finished_at) : ''}`}</span>
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

/** Én bestilling med steg, fase og knapper. Brukes også på hjullasterskjermen (large). */
export function BulkCard({ order: o, now, large }: { order: BulkOrderView; now: number; large?: boolean }) {
  const act = useBulkAction();
  const phase = bulkPhase(o.status, o.steps, now);
  const current = phase.kind === 'laster' ? phase.step : phase.kind === 'pause' ? phase.next : null;
  const last = o.steps[o.steps.length - 1]?.seq;
  return (
    <article className="glass" style={{ padding: large ? 20 : 16, display: 'flex', flexDirection: 'column', gap: 12, borderRadius: 24,
      ...(phase.kind !== 'venter' ? { borderColor: 'rgba(128,239,222,.45)' } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: large ? 26 : 19 }}>{o.truck}
          <span className="muted" style={{ fontSize: 14, marginLeft: 10 }}>{[o.destination, o.driver?.short_name].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="n" style={{ fontSize: large ? 22 : 16 }}>
          {phase.kind === 'venter' && <span className="muted">Venter · bestilt {osloTime(o.created_at)}</span>}
          {phase.kind === 'laster' && <span style={{ color: 'var(--aqua)' }}>● Laster steg {phase.step}</span>}
          {phase.kind === 'pause' && <span style={{ color: 'var(--warn-fg)' }}>Pause · steg {phase.next} om {formatMinSec((phase.untilMs - now) / 1000)}</span>}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {o.steps.map(s => (
          <span key={s.id} style={{ ['--q' as string]: s.color, display: 'flex', alignItems: 'center', gap: 8, borderRadius: 16, padding: large ? '12px 16px' : '8px 12px',
            fontSize: large ? 20 : 14, opacity: s.finished_at ? .45 : 1,
            border: `2px solid ${s.seq === current ? s.color : 'var(--line)'}`, background: s.seq === current ? `color-mix(in srgb, ${s.color} 16%, transparent)` : 'rgba(var(--tint), .04)' }}>
            <span className="qdot" />
            <span className="n">{s.seq}. {fr(s.tonnes)} t</span> {s.quality_name}
            {s.target && <span className="muted" style={{ fontSize: '.8em' }}>· {s.target}</span>}
            {s.pause_after_sec > 0 && s.seq !== last && <span className="muted n" style={{ fontSize: '.8em' }}>· pause {formatMinSec(s.pause_after_sec)}</span>}
            {s.finished_at && <span className="muted" style={{ fontSize: '.8em' }}>✓</span>}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {phase.kind === 'venter' && (
          <button type="button" className={`btn btn-w${large ? ' hl-btn' : ''}`} disabled={act.isPending} onClick={() => act.mutate({ id: o.id, action: 'start' })}>Start lasting</button>
        )}
        {(phase.kind === 'laster' || phase.kind === 'pause') && (
          <button type="button" className={`btn btn-w${large ? ' hl-btn' : ''}`} disabled={act.isPending} onClick={() => act.mutate({ id: o.id, action: 'next' })}>
            {phase.kind === 'pause' ? `Start steg ${phase.next} nå` : phase.step === last ? 'Ferdig lastet' : `Steg ${phase.step} ferdig`}
          </button>
        )}
        {!large && (
          <button type="button" className="btn" disabled={act.isPending} onClick={() => confirm(`Avlyse ${o.truck}?`) && act.mutate({ id: o.id, action: 'cancel' })}>Avlys</button>
        )}
      </div>
      {act.isError && <div className="error-box">{errorText(act.error)}</div>}
    </article>
  );
}

type Step = { quality_id: string; tonnes: string; target: 'henger' | 'bil' | ''; pause: string };
const TRUCK_KEY = 'flow-bulkbil';

/** Sjåførens bestilling: velg kvalitet og tonn per steg, og pause mellom stegene. */
function OrderForm({ qualities }: { qualities: BulkQuality[] }) {
  const create = useCreateBulkOrder();
  const [truck, setTruck] = useState(() => { try { return localStorage.getItem(TRUCK_KEY) ?? ''; } catch { return ''; } });
  const [destination, setDestination] = useState('');
  const [steps, setSteps] = useState<Step[]>([{ quality_id: '', tonnes: '16', target: 'henger', pause: '2:00' }, { quality_id: '', tonnes: '12', target: 'bil', pause: '0:00' }]);
  const set = (i: number, p: Partial<Step>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));

  const parsed = steps.map((s, i) => ({
    quality_id: s.quality_id, tonnes: Number(s.tonnes.replace(',', '.')), target: s.target || null,
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
      <h2 id="bulk-h" style={{ margin: 0, fontSize: 24, fontWeight: 300 }}>Bestill lasting</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>Bil</span><input className="inp" value={truck} onChange={e => setTruck(e.target.value)} placeholder="Bil 2 · SU 12345" /></label>
        <label className="field"><span>Til (valgfritt)</span><input className="inp" value={destination} onChange={e => setDestination(e.target.value)} /></label>
      </div>
      {steps.map((s, i) => (
        <div key={i} className="step-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="eyebrow">Steg {i + 1}</span>
            {steps.length > 1 && (
              <button type="button" className="icon-btn" aria-label={`Fjern steg ${i + 1}`} style={{ width: 32, height: 32 }} onClick={() => setSteps(steps.filter((_, j) => j !== i))}><Close size={14} /></button>
            )}
          </div>
          <div role="group" aria-label={`Kvalitet steg ${i + 1}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {qualities.map(q => (
              <button key={q.id} type="button" className="qbtn" aria-pressed={s.quality_id === q.id} style={{ ['--q' as string]: q.color }} onClick={() => set(i, { quality_id: q.id })}>
                <span className="qdot" />{q.name}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 10, alignItems: 'end' }}>
            <label className="field"><span>Tonn</span><input className="inp n" inputMode="decimal" value={s.tonnes} onChange={e => set(i, { tonnes: e.target.value })} /></label>
            <div className="field"><span>Til</span>
              <Segmented<Step['target']> label="Lastes på" value={s.target} onChange={v => set(i, { target: v })} stretch
                options={[{ value: 'henger', label: 'Henger' }, { value: 'bil', label: 'Bil' }, { value: '', label: '–' }]} />
            </div>
          </div>
          {i < steps.length - 1 && (
            <label className="field"><span>Pause før neste steg (min:sek)</span>
              <input className="inp n" inputMode="numeric" value={s.pause} onChange={e => set(i, { pause: e.target.value })} placeholder="2:30"
                aria-invalid={parseMinSec(s.pause) == null} style={parseMinSec(s.pause) == null ? { borderColor: 'var(--bad-fg)' } : undefined} />
            </label>
          )}
        </div>
      ))}
      {steps.length < 4 && (
        <button type="button" className="btn" onClick={() => setSteps([...steps, { quality_id: '', tonnes: '10', target: '', pause: '0:00' }])}
          style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 38, fontSize: 13 }}>
          <Plus size={14} /> Legg til steg
        </button>
      )}
      {create.isError && <div className="error-box">{errorText(create.error)}</div>}
      <button type="button" className="btn btn-w" disabled={!valid || create.isPending} onClick={save}>Bestill {fr(total)} t</button>
    </aside>
  );
}
