import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { BulkOrderView, PackingLineView } from '../../../shared/api.ts';
import { bulkDemand } from '../../../shared/domain/bulk.ts';
import type { SiloState } from '../../../shared/domain/production.ts';
import { ArrowLeft } from '../components/Icons.tsx';
import { fr, osloTime } from '../lib/format.ts';
import { useBulkOrders, useBulkQualities, useProduction } from '../lib/queries.ts';
import { useNow } from '../lib/useNow.ts';
import { ADVICE, Silo, lineSilo } from './ProduksjonPage.tsx';
import './moduler.css';

/** Nettbrett i hjullasteren: hva traktene og siloene trenger, i stor skrift. Bare visning, ingen knapper for lasting. */
export function HjullasterPage() {
  const now = useNow(1000);
  const t = now.getTime();
  const bulk = useBulkOrders();
  const qualities = useBulkQualities();
  const lines = useProduction();
  const [demo, setDemo] = useState(false);
  const sim = useSiloDemo(demo, lines.data ?? []);
  const open = (bulk.data ?? []).filter(o => o.status === 'bestilt' || o.status === 'lastes');
  const demand = bulkDemand(open);

  return (
    <main className="hl">
      <header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link to="/produksjon" className="icon-btn pill" aria-label="Tilbake" style={{ width: 52, height: 52 }}><ArrowLeft size={22} /></Link>
        <h1 style={{ margin: 0, fontSize: 34, fontWeight: 300 }}>Hjullaster</h1>
        <button type="button" className="btn" aria-pressed={demo} onClick={() => setDemo(!demo)} style={{ marginLeft: 'auto', minHeight: 44 }}>
          {demo ? 'Avslutt demo' : 'Demo: påfylling av silo'}
        </button>
        <span className="n muted" style={{ fontSize: 34, fontWeight: 300 }}>{osloTime(now.toISOString())}</span>
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
          {open.map(o => <TruckCard key={o.id} order={o} />)}
          {bulk.isSuccess && !open.length && <p className="muted" style={{ fontSize: 20, margin: 0 }}>Ingen bulkbiler i kø.</p>}
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }} aria-label="Pakkelinjer">
          {demo && (
            <div className="advice advice-stopp" style={{ fontSize: 17, padding: '12px 16px' }}>
              Demo: slik ser siloene ut i produksjon. Nivået synker mens linjen pakker, og når det blir lavt går salt inn i siloen.
            </div>
          )}
          {(lines.data ?? []).map(l => {
            const real = lineSilo(l, t);
            const d = demo ? sim[l.id] : undefined;
            const s: SiloState = d ? { ...real, level: d.level, remaining: l.silo_capacity_t, advice: demoAdvice(l, d.level) } : real;
            const o = l.active_order;
            const next = l.queue[0];
            return (
              <div key={l.id} className="hl-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 26 }}>{l.name}</span>
                  <span style={{ fontSize: 20 }}>{o?.product_name ?? <span className="muted">Står</span>}</span>
                </div>
                <div style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
                  <Silo line={l} s={s} height={170} pouring={d?.pouring} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                    <span className="n hl-big">{fr(s.level)}<span style={{ fontSize: 24 }}> / {l.silo_capacity_t} t</span></span>
                    {d?.pouring ? (
                      <div className="advice advice-stopp" style={{ fontSize: 22, padding: '12px 16px' }}>Salt går inn i siloen<span className="n"> · +{fr(d.added)} t</span></div>
                    ) : (
                      <div className={`advice advice-${s.advice}`} style={{ fontSize: 22, padding: '12px 16px' }}>
                        {ADVICE[s.advice]}{!d && s.fillNow > 0 && <span className="n"> · {fr(s.fillNow)} t</span>}
                      </div>
                    )}
                    {o && !d && <span className="n" style={{ fontSize: 17, color: 'var(--fg-75)' }}>Gjenstår av ordren {fr(s.remaining)} t{s.finishAt ? ` · ferdig ca. ${osloTime(s.finishAt)}` : ''}</span>}
                    {next && <span style={{ fontSize: 17, color: o && next.product_id !== o.product_id ? 'var(--warn-fg)' : 'var(--fg-62)' }}>Neste: {next.product_name} {fr(next.tonnes)} t</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}

/** Hvilken bil, hvem som har bestilt, og hvor mye av hver kvalitet. */
function TruckCard({ order: o }: { order: BulkOrderView }) {
  const byQuality = new Map<string, { name: string; color: string; tonnes: number }>();
  for (const s of o.steps) {
    const q = byQuality.get(s.quality_id) ?? { name: s.quality_name, color: s.color, tonnes: 0 };
    q.tonnes += s.tonnes;
    byQuality.set(s.quality_id, q);
  }
  return (
    <article className="glass" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, borderRadius: 24,
      ...(o.status === 'lastes' ? { borderColor: 'rgba(128,239,222,.45)' } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 26 }}>{o.truck}</span>
        <span className="muted n" style={{ fontSize: 18 }}>bestilt {osloTime(o.created_at)}</span>
      </div>
      <span style={{ fontSize: 20, color: 'var(--fg-75)' }}>Sjåfør: {o.driver?.name ?? 'ukjent'}{o.destination ? <span className="muted"> · til {o.destination}</span> : null}</span>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[...byQuality.values()].map(q => (
          <span key={q.name} style={{ ['--q' as string]: q.color, display: 'flex', alignItems: 'center', gap: 10, borderRadius: 16, padding: '12px 18px', fontSize: 22,
            border: `2px solid ${q.color}`, background: `color-mix(in srgb, ${q.color} 12%, transparent)` }}>
            <span className="qdot" /><span className="n">{fr(q.tonnes)} t</span> {q.name}
          </span>
        ))}
      </div>
    </article>
  );
}

const demoAdvice = (l: PackingLineView, level: number): SiloState['advice'] =>
  level <= l.silo_capacity_t * 0.25 ? 'fyll' : level <= l.silo_capacity_t * 0.5 ? 'snart' : 'ok';

type Sim = { level: number; pouring: boolean; added: number };

/**
 * Demo uten data: siloen tømmes mens linjen pakker (i høyt tempo), og når nivået er lavt
 * fylles den opp igjen med en strøm av salt. Ingenting lagres.
 */
function useSiloDemo(on: boolean, lines: PackingLineView[]): Record<string, Sim> {
  const [sim, setSim] = useState<Record<string, Sim>>({});
  const key = lines.map(l => l.id).join();
  useEffect(() => {
    if (!on) { setSim({}); return; }
    setSim(Object.fromEntries(lines.map((l, i) => [l.id, { level: l.silo_capacity_t * (0.8 - (i % 3) * 0.25), pouring: false, added: 0 }])));
    const dt = 0.1;
    const id = setInterval(() => setSim(prev => {
      const out: Record<string, Sim> = {};
      for (const l of lines) {
        const cap = l.silo_capacity_t;
        const p = prev[l.id] ?? { level: cap * 0.6, pouring: false, added: 0 };
        if (p.pouring) {
          const step = cap * 0.12 * dt;
          const level = Math.min(cap * 0.92, p.level + step);
          out[l.id] = { level, pouring: level < cap * 0.92, added: p.added + (level - p.level) };
        } else {
          const level = Math.max(0, p.level - cap * 0.035 * dt);
          out[l.id] = level <= cap * 0.22 ? { level, pouring: true, added: 0 } : { ...p, level };
        }
      }
      return out;
    }), dt * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key]);
  return sim;
}
