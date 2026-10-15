import { useState } from 'react';
import { Link } from 'react-router';
import type { PackingLineView } from '../../../shared/api.ts';
import { siloState, type SiloState } from '../../../shared/domain/production.ts';
import { ArrowUpRight } from '../components/Icons.tsx';
import { Page } from '../components/Topbar.tsx';
import { Loading } from '../components/ui.tsx';
import { errorText } from '../lib/api.ts';
import { fr, osloTime } from '../lib/format.ts';
import { useCreateProductionOrder, useMe, useProduction, useProductionAction, useProducts, useSiloFill } from '../lib/queries.ts';
import { canCrew, canQuayLog } from '../lib/roles.ts';
import { useNow } from '../lib/useNow.ts';
import './moduler.css';

export const ADVICE: Record<SiloState['advice'], string> = {
  fyll: 'Fyll nå',
  snart: 'Fyll snart',
  ok: 'Nok i siloen',
  stopp: 'Stopp – nok til å fullføre ordren',
  ingen: 'Ingen ordre pakkes',
};

export const lineSilo = (l: PackingLineView, now: number) =>
  siloState({ capacity: l.silo_capacity_t, rateTph: l.rate_tph, order: l.active_order, filledForOrder: l.filled_for_order }, now);

/** Stående silo med beregnet nivå. Stiplet strek viser hva som trengs for å fullføre ordren. */
export function Silo({ line, s, height = 180 }: { line: PackingLineView; s: SiloState; height?: number }) {
  const cap = line.silo_capacity_t;
  const pct = Math.min(100, (s.level / cap) * 100);
  const need = Math.min(cap, s.remaining);
  const color = s.advice === 'fyll' ? '#FF6B5E' : s.advice === 'snart' ? '#F7B955' : '#80EFDE';
  return (
    <div className="silo" style={{ height, width: height * .47 }} role="img" aria-label={`Silo ${fr(s.level)} av ${cap} tonn`}>
      <div className="silo-fill" style={{ height: `${pct}%`, background: `linear-gradient(180deg, ${color}, color-mix(in srgb, ${color} 55%, #141B17))` }} />
      {line.active_order && <div className="silo-mark" style={{ bottom: `${(need / cap) * 100}%` }} title="Gjenstår av ordren" />}
    </div>
  );
}

export function ProduksjonPage() {
  const lines = useProduction();
  const now = useNow(15_000).getTime();
  return (
    <Page>
      <div style={{ flex: '999 1 700px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title">Produksjon</h1>
            <span className="muted">Pakkelinjer og silo · nivå beregnet fra påfylling og pakkehastighet</span>
          </div>
          <Link to="/hjullaster" className="btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
            Hjullasterskjerm <ArrowUpRight size={15} />
          </Link>
        </div>
        {lines.isPending && <Loading />}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 18 }}>
          {(lines.data ?? []).map(l => <LineCard key={l.id} line={l} now={now} />)}
        </div>
      </div>
      <NewOrderForm lines={lines.data ?? []} />
    </Page>
  );
}

function LineCard({ line: l, now }: { line: PackingLineView; now: number }) {
  const me = useMe();
  const act = useProductionAction();
  const fill = useSiloFill();
  const s = lineSilo(l, now);
  const o = l.active_order;
  const canRun = canCrew(me.data) || canQuayLog(me.data);
  return (
    <section className="glass" aria-label={l.name} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 300 }}>{l.name}</h2>
        <span className="sub n">Silo {l.silo_capacity_t} t · {l.rate_tph} t/t</span>
      </div>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end' }}>
        <Silo line={l} s={s} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, flex: 1 }}>
          {o ? (
            <>
              <span className="eyebrow">Pakker nå</span>
              <span style={{ fontSize: 22 }}>{o.product_name}</span>
              <span className="n" style={{ fontSize: 14, color: 'var(--fg-75)' }}>
                {fr(s.packed)} av {fr(o.tonnes)} t pakket · i silo {fr(s.level)} t
                {s.finishAt && <><br />Ferdig ca. {osloTime(s.finishAt)}</>}
              </span>
            </>
          ) : <span className="muted">Ingen ordre pakkes.</span>}
          <div className={`advice advice-${s.advice}`}>
            <strong style={{ fontWeight: 500 }}>{ADVICE[s.advice]}</strong>
            {s.fillNow > 0 && <span className="n">· {fr(s.fillNow)} t</span>}
          </div>
        </div>
      </div>
      {o && canRun && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[5, 10].map(t => (
            <button key={t} type="button" className="btn" disabled={fill.isPending} onClick={() => fill.mutate({ line_id: l.id, tonnes: t })}>+{t} t fylt</button>
          ))}
          {s.fillNow > 0 && ![5, 10].includes(s.fillNow) && (
            <button type="button" className="btn btn-w" disabled={fill.isPending} onClick={() => fill.mutate({ line_id: l.id, tonnes: s.fillNow })}>+{fr(s.fillNow)} t fylt</button>
          )}
          <button type="button" className="btn" disabled={act.isPending} onClick={() => act.mutate({ id: o.id, action: 'finish' })} style={{ marginLeft: 'auto' }}>Ordre ferdig</button>
        </div>
      )}
      {l.last_fill && <span className="sub">Sist fylt {fr(l.last_fill.tonnes)} t kl. {osloTime(l.last_fill.filled_at)}{l.last_fill.by ? ` av ${l.last_fill.by}` : ''}</span>}
      {(fill.isError || act.isError) && <div className="error-box">{errorText(fill.error ?? act.error)}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="eyebrow">Neste · {l.queue.length}</span>
        {l.queue.map((q, i) => (
          <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 14, background: 'rgba(var(--tint), .05)' }}>
            <span style={{ flex: 1 }}>{q.product_name} <span className="n muted">· {fr(q.tonnes)} t</span>
              {i === 0 && o && o.product_id !== q.product_id && <span style={{ fontSize: 12, color: 'var(--warn-fg)', marginLeft: 8 }}>kvalitetsbytte</span>}
            </span>
            {canRun && <button type="button" className="btn" style={{ minHeight: 34, fontSize: 13 }} disabled={act.isPending} onClick={() => act.mutate({ id: q.id, action: 'start' })}>Start</button>}
            {canCrew(me.data) && <button type="button" className="btn" style={{ minHeight: 34, fontSize: 13 }} disabled={act.isPending} onClick={() => act.mutate({ id: q.id, action: 'cancel' })}>Fjern</button>}
          </div>
        ))}
        {!l.queue.length && <span className="sub">Ingen ordre i kø.</span>}
        {l.done_today.length > 0 && <span className="sub">Ferdig i dag: {l.done_today.map(d => `${d.product_name} ${fr(d.tonnes)} t`).join(', ')}</span>}
      </div>
    </section>
  );
}

function NewOrderForm({ lines }: { lines: PackingLineView[] }) {
  const me = useMe();
  const products = useProducts();
  const create = useCreateProductionOrder();
  const [lineId, setLineId] = useState('');
  const [productId, setProductId] = useState('');
  const [tonnes, setTonnes] = useState('40');
  if (!canCrew(me.data)) return null;
  const line = lineId || lines[0]?.id || '';
  const product = productId || products.data?.[0]?.id || '';
  const t = Number(tonnes.replace(',', '.'));
  return (
    <aside className="glass" aria-labelledby="po-h" style={{ flex: '1 1 300px', maxWidth: 360, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 20 }}>
      <h2 id="po-h" style={{ margin: 0, fontSize: 22, fontWeight: 300 }}>Ny pakkeordre</h2>
      <label className="field"><span>Linje</span>
        <select className="inp" value={line} onChange={e => setLineId(e.target.value)}>{lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
      </label>
      <label className="field"><span>Kvalitet</span>
        <select className="inp" value={product} onChange={e => setProductId(e.target.value)}>{(products.data ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </label>
      <label className="field"><span>Tonn</span><input className="inp n" inputMode="decimal" value={tonnes} onChange={e => setTonnes(e.target.value)} /></label>
      {create.isError && <div className="error-box">{errorText(create.error)}</div>}
      <button type="button" className="btn btn-w" disabled={!line || !product || !(t > 0) || create.isPending}
        onClick={() => create.mutate({ line_id: line, product_id: product, tonnes: t })}>Legg i kø</button>
    </aside>
  );
}
