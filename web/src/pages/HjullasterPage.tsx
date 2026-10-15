import { Link } from 'react-router';
import { bulkDemand } from '../../../shared/domain/bulk.ts';
import { ArrowLeft } from '../components/Icons.tsx';
import { fr, osloTime } from '../lib/format.ts';
import { useBulkOrders, useBulkQualities, useProduction, useSiloFill } from '../lib/queries.ts';
import { useNow } from '../lib/useNow.ts';
import { BulkCard } from './BulkPage.tsx';
import { ADVICE, Silo, lineSilo } from './ProduksjonPage.tsx';
import './moduler.css';

/** Nettbrett i hjullasteren: hva traktene og siloene trenger, i stor skrift. Ingen meny. */
export function HjullasterPage() {
  const now = useNow(1000);
  const t = now.getTime();
  const bulk = useBulkOrders();
  const qualities = useBulkQualities();
  const lines = useProduction();
  const fill = useSiloFill();
  const open = (bulk.data ?? []).filter(o => o.status === 'bestilt' || o.status === 'lastes');
  const demand = bulkDemand(open);

  return (
    <main className="hl">
      <header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link to="/produksjon" className="icon-btn pill" aria-label="Tilbake" style={{ width: 52, height: 52 }}><ArrowLeft size={22} /></Link>
        <h1 style={{ margin: 0, fontSize: 34, fontWeight: 300 }}>Hjullaster</h1>
        <span className="n muted" style={{ marginLeft: 'auto', fontSize: 34, fontWeight: 300 }}>{osloTime(now.toISOString())}</span>
      </header>

      <div className="hl-grid">
        <section className="hl-card" aria-label="Bulkbil">
          <span className="eyebrow" style={{ fontSize: 15 }}>Bulkbil · fyll traktene</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {(qualities.data ?? []).map(q => (
              <div key={q.id} style={{ borderRadius: 20, padding: '12px 16px', border: `2px solid ${demand[q.id] ? q.color : 'var(--line)'}`, opacity: demand[q.id] ? 1 : .5 }}>
                <div style={{ fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}><span className="qdot" style={{ ['--q' as string]: q.color }} />{q.name}</div>
                <div className="n hl-big" style={{ fontSize: 48 }}>{fr(demand[q.id] ?? 0)}<span style={{ fontSize: 20 }}> t</span></div>
              </div>
            ))}
          </div>
          {open.map(o => <BulkCard key={o.id} order={o} now={t} large />)}
          {bulk.isSuccess && !open.length && <p className="muted" style={{ fontSize: 20, margin: 0 }}>Ingen bulkbiler i kø.</p>}
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }} aria-label="Pakkelinjer">
          {(lines.data ?? []).map(l => {
            const s = lineSilo(l, t);
            const o = l.active_order;
            const next = l.queue[0];
            return (
              <div key={l.id} className="hl-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 26 }}>{l.name}</span>
                  <span style={{ fontSize: 20 }}>{o?.product_name ?? <span className="muted">Står</span>}</span>
                </div>
                <div style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
                  <Silo line={l} s={s} height={170} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                    <span className="n hl-big">{fr(s.level)}<span style={{ fontSize: 24 }}> / {l.silo_capacity_t} t</span></span>
                    <div className={`advice advice-${s.advice}`} style={{ fontSize: 22, padding: '12px 16px' }}>
                      {ADVICE[s.advice]}{s.fillNow > 0 && <span className="n"> · {fr(s.fillNow)} t</span>}
                    </div>
                    {o && <span className="n" style={{ fontSize: 17, color: 'var(--fg-75)' }}>Gjenstår av ordren {fr(s.remaining)} t{s.finishAt ? ` · ferdig ca. ${osloTime(s.finishAt)}` : ''}</span>}
                    {next && <span style={{ fontSize: 17, color: o && next.product_id !== o.product_id ? 'var(--warn-fg)' : 'var(--fg-62)' }}>Neste: {next.product_name} {fr(next.tonnes)} t</span>}
                  </div>
                </div>
                {o && (
                  <div style={{ display: 'flex', gap: 10 }}>
                    {[5, 10, 15].map(n => (
                      <button key={n} type="button" className="btn hl-btn" disabled={fill.isPending} onClick={() => fill.mutate({ line_id: l.id, tonnes: n })}>+{n} t</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}
