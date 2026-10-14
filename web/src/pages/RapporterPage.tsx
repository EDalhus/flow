import { useState } from 'react';
import type { ProductReportRow, WeeklyReport } from '../../../shared/api.ts';
import { CATEGORY_LABEL } from '../../../shared/domain/types.ts';
import { TrendUp } from '../components/Icons.tsx';
import { Page } from '../components/Topbar.tsx';
import { Loading, Segmented } from '../components/ui.tsx';
import { arrow, nb, pct } from '../lib/format.ts';
import { useProductReport, useProducts, useQualityReport, useWeeklyReport } from '../lib/queries.ts';
import './rapporter.css';

type Dir = 'begge' | 'inn' | 'ut';
type View = 'graf' | 'tabell';

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const m = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / (m / 2)) * (m / 2);
};
const sum = (a: number[], from = 0, to = a.length) => a.slice(from, to).reduce((s, x) => s + (x ?? 0), 0);

export function RapporterPage() {
  const [prod, setProd] = useState('');
  const [dir, setDir] = useState<Dir>('begge');
  const [view, setView] = useState<View>('graf');
  const [hover, setHover] = useState<number | null>(null);
  const products = useProducts();
  const weekly = useWeeklyReport(undefined, prod, dir);
  const prodReport = useProductReport(dir);
  const quality = useQualityReport();

  const w = weekly.data;
  const name = prod ? products.data?.find(p => p.id === prod)?.name ?? 'varen' : 'alle varer';
  const dirWord = dir === 'inn' ? 'inn' : dir === 'ut' ? 'ut' : 'inn og ut';

  return (
    <Page>
      <div style={{ width: '100%', maxWidth: 1600, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title">Rapporter</h1>
            <span className="muted">
              {w ? `Flatholmen · ${w.year} mot ${w.prev_year} · uke 1–${w.last_actual_week} faktisk${w.last_actual_week < w.weeks_in_year ? `, uke ${w.last_actual_week + 1}–${w.weeks_in_year} prognose` : ''}` : 'Flatholmen'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="sub">Vare</span>
              <select className="inp inp-round" value={prod} onChange={e => { setProd(e.target.value); setHover(null); }}>
                <option value="">Alle varer</option>
                <optgroup label="Varer">{(products.data ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
              </select>
            </label>
            <Segmented<Dir> label="Retning" value={dir} onChange={setDir} options={[{ value: 'begge', label: 'Inn + ut' }, { value: 'inn', label: 'Inn' }, { value: 'ut', label: 'Ut' }]} />
            <Segmented<View> label="Visning" value={view} onChange={setView} options={[{ value: 'graf', label: 'Grafer' }, { value: 'tabell', label: 'Tabell' }]} />
          </div>
        </div>

        {!w ? <Loading /> : (
          <>
            <Kpis w={w} dirWord={dirWord} />
            <Outlook w={w} name={name} dirWord={dirWord} />
            {view === 'graf'
              ? <MainChart w={w} name={name} dirWord={dirWord} dir={dir} prodSelected={!!prod} hover={hover} onHover={setHover} />
              : <WeekTable w={w} name={name} dirWord={dirWord} />}
          </>
        )}

        {prodReport.data && (
          <ProductTable rows={prodReport.data.rows} last={prodReport.data.last_actual_week} dirWord={dirWord} selected={prod}
            onPick={id => { setProd(prod === id ? '' : id); setHover(null); }} />
        )}

        {quality.data && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))', gap: 12 }}>
            <Punctuality points={quality.data.punctuality} />
            <section className="glass" aria-labelledby="c3" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div><h2 id="c3" className="ttl">Avvik per kategori</h2>
                <span className="sub">{sum(quality.data.deviations.categories.map(c => c.count))} avvik registrert i kaiboka · siste 8 uker</span></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {quality.data.deviations.categories.map(c => (
                  <HBar key={c.category} label={CATEGORY_LABEL[c.category]} value={String(c.count)} share={c.count / Math.max(1, quality.data!.deviations.categories[0].count)} height={12} labelWidth={120} />
                ))}
                {!quality.data.deviations.categories.length && <span className="sub">Ingen avvik siste 8 uker.</span>}
              </div>
            </section>
            <section className="glass" aria-labelledby="c4" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div><h2 id="c4" className="ttl">Snittvurdering per båt</h2><span className="sub">Fra kaibøkene, 1–5</span></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {quality.data.boat_ratings.map(b => (
                  <HBar key={b.id} label={b.name} value={b.avg_total.toFixed(1).replace('.', ',')} share={b.avg_total / 5} height={9} labelWidth={110} />
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </Page>
  );
}

function Kpis({ w, dirWord }: { w: WeeklyReport; dirWord: string }) {
  const t = w.totals;
  const per = (tn: number, n: number) => (n ? `${nb(tn / n)} t` : '–');
  const kpis = [
    { label: `Tonn ${dirWord} hittil i år`, big: nb(t.ytd_tonnes), unit: ' t', cmp: `${arrow(t.ytd_tonnes, t.ytd_tonnes_prev)}${pct(t.ytd_tonnes, t.ytd_tonnes_prev)} mot ${w.prev_year} (${nb(t.ytd_tonnes_prev)} t)` },
    { label: 'Anløp hittil i år', big: nb(t.ytd_calls), unit: '', cmp: `${arrow(t.ytd_calls, t.ytd_calls_prev)}${pct(t.ytd_calls, t.ytd_calls_prev)} mot ${w.prev_year} (${t.ytd_calls_prev})` },
    { label: 'Snitt per anløp', big: t.ytd_calls ? nb(t.ytd_tonnes / t.ytd_calls) : '–', unit: ' t', cmp: `i fjor ${per(t.ytd_tonnes_prev, t.ytd_calls_prev)}` },
    {
      label: w.last_actual_week < w.weeks_in_year ? `Prognose uke ${w.last_actual_week + 1}–${w.weeks_in_year}` : 'Prognose',
      big: nb(t.forecast_tonnes), unit: ` t · ${t.forecast_calls} anløp`,
      cmp: `${arrow(t.forecast_tonnes, t.forecast_tonnes_prev)}${pct(t.forecast_tonnes, t.forecast_tonnes_prev)} mot samme uker i fjor`,
    },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: 12 }}>
      {kpis.map(k => (
        <div key={k.label} className="glass" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="sub">{k.label}</span>
          <span className="n" style={{ fontSize: 38, fontWeight: 200, lineHeight: 1.1, letterSpacing: '-0.02em' }}>{k.big}<span style={{ color: 'var(--fg-45)', fontSize: 18 }}>{k.unit}</span></span>
          <span className="n" style={{ fontSize: 13, color: 'var(--fg-75)' }}>{k.cmp}</span>
        </div>
      ))}
    </div>
  );
}

function Outlook({ w, name, dirWord }: { w: WeeklyReport; name: string; dirWord: string }) {
  const o = w.outlook;
  const last = w.last_actual_week;
  const empty = w.totals.forecast_tonnes + w.totals.forecast_tonnes_prev < 1;
  const up = o.next4_tonnes >= o.next4_tonnes_prev;
  const diff = o.busiest_calls - o.busiest_calls_prev;
  const versus = diff === 0 ? 'like mange anløp som' : diff > 0 ? `${diff} flere anløp enn` : `${-diff} færre anløp enn`;
  const title = empty ? `Ingen varer ${dirWord} for ${name}` : `${up ? 'Økende' : 'Lavere'} trykk de neste fire ukene – ${name}`;
  const text = empty
    ? `${name.charAt(0).toUpperCase() + name.slice(1)} går ikke ${dirWord} over kaia i perioden – velg «Inn + ut» eller en annen vare.`
    : `Uke ${last + 1}–${Math.min(last + 4, w.weeks_in_year)} ventes ${nb(o.next4_tonnes)} t (${pct(o.next4_tonnes, o.next4_tonnes_prev)} mot i fjor).` +
      (o.busiest_week ? ` Travleste uke ventes å bli uke ${o.busiest_week} med ca. ${o.busiest_calls} anløp og ${nb(o.busiest_tonnes)} t – ${versus} samme uke i fjor (${pct(o.busiest_tonnes, o.busiest_tonnes_prev)} tonn).` : '');
  return (
    <div style={{ borderRadius: 22, padding: '16px 20px', background: 'rgba(157,184,255,.1)', border: '1px solid rgba(157,184,255,.22)', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <span style={{ width: 36, height: 36, flex: 'none', borderRadius: '50%', background: 'rgba(157,184,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C9D8FF' }}>
        <TrendUp size={18} style={up ? undefined : { transform: 'scaleY(-1)' }} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 16 }}>{title}</span>
        <span style={{ fontSize: 14, color: 'var(--fg-75)' }}>{text}</span>
        <span style={{ fontSize: 12, color: 'var(--fg-55)' }}>
          Prognose = fjorårets tall for samme uke × årets trend siste 8 uker ({pct(w.trend.tonnes, 1)} mot {w.prev_year}). Tallene er eksempeldata.
        </span>
      </div>
    </div>
  );
}

function MainChart({ w, name, dirWord, dir, prodSelected, hover, onHover }: {
  w: WeeklyReport; name: string; dirWord: string; dir: Dir; prodSelected: boolean; hover: number | null; onHover: (i: number | null) => void;
}) {
  const n = w.weeks.length;
  const cur = w.weeks.map(x => x.tonnes ?? x.forecast_tonnes ?? 0);
  const curC = w.weeks.map(x => x.calls ?? x.forecast_calls ?? 0);
  const prev = w.weeks.map(x => x.tonnes_prev);
  const prevC = w.weeks.map(x => x.calls_prev);
  const tMax = niceMax(Math.max(...cur, ...prev) * 1.05);
  const aMax = Math.max(4, Math.ceil(Math.max(...curC, ...prevC) / 2) * 2);
  const hw = hover ?? (w.outlook.busiest_week ? w.outlook.busiest_week - 1 : Math.max(0, w.last_actual_week - 1));
  const line = (arr: number[], max: number) => arr.map((v, i) => `${(i + 0.5).toFixed(1)},${(100 - (v / max) * 100).toFixed(1)}`).join(' ');
  const per = (t: number, c: number) => (c ? `${nb(t / c)} t` : '–');
  const nowPos = `${(w.last_actual_week / n) * 100}%`;
  const fc = (i: number) => w.weeks[i].kind === 'prognose';
  const anlWord = dir === 'inn' ? 'Anløp med levering' : dir === 'ut' ? 'Anløp med henting' : prodSelected ? `Anløp med ${name}` : 'Anløp';

  const readout = [
    { label: `Uke ${hw + 1}${fc(hw) ? ' · prognose' : ''}`, v: `${nb(cur[hw])} t`, cmp: `i fjor ${nb(prev[hw])} t · ${pct(cur[hw], prev[hw])}` },
    { label: 'Anløp', v: String(curC[hw]), cmp: `i fjor ${prevC[hw]}` },
    { label: 'Tonn per anløp', v: per(cur[hw], curC[hw]), cmp: `i fjor ${per(prev[hw], prevC[hw])}` },
    { label: 'Andel av året', v: `${Math.round((cur[hw] / Math.max(1, sum(cur))) * 100)} %`, cmp: 'av årets tonn' },
  ];
  const bars = (values: number[], max: number) => values.map((v, i) => {
    const on = i === hw;
    const fill = fc(i)
      ? { background: `rgba(157,184,255,${on ? '.5' : '.28'})`, border: '1px dashed #9DB8FF', borderBottom: 'none' }
      : { background: on ? '#C9D8FF' : '#9DB8FF' };
    return (
      <div key={i} className="wk" onMouseEnter={() => onHover(i)} style={on ? { background: 'rgba(255,255,255,.06)', borderRadius: 4 } : undefined}>
        <div style={{ width: '100%', borderRadius: '3px 3px 0 0', height: `${((v / max) * 100).toFixed(1)}%`, ...fill }} />
      </div>
    );
  });

  return (
    <section className="glass" aria-labelledby="c-main" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div><h2 id="c-main" className="ttl" style={{ fontSize: 20 }}>Varer og anløp per uke</h2>
          <span className="sub">{name.charAt(0).toUpperCase() + name.slice(1)} · {dirWord} · hold over en uke for detaljer</span></div>
        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'rgba(243,245,246,.7)', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 10, borderRadius: 2, background: '#9DB8FF' }} />{w.year}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 10, borderRadius: 2, background: 'rgba(157,184,255,.28)', border: '1px dashed #9DB8FF' }} />Prognose</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 2, background: '#E8ECEF' }} />{w.prev_year}</span>
        </div>
      </div>

      <div role="status" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))', gap: 10, padding: '12px 14px', borderRadius: 16, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)' }}>
        {readout.map(r => (
          <div key={r.label} style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="sub">{r.label}</span>
            <span className="n" style={{ fontSize: 18 }}>{r.v}</span>
            <span className="n" style={{ fontSize: 12, color: 'rgba(243,245,246,.6)' }}>{r.cmp}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} onMouseLeave={() => onHover(null)}>
        <ChartArea height={210} axis={[`${nb(tMax)} t`, nb(tMax / 2), '0 t']} nowPos={nowPos} showNowLabel>
          {bars(cur, tMax)}
          <Line points={line(prev, tMax)} n={n} />
        </ChartArea>
        <span className="sub" style={{ marginLeft: 62 }}>Tonn {dirWord}</span>
        <ChartArea height={120} axis={[String(aMax), '0']} nowPos={nowPos}>
          {bars(curC, aMax)}
          <Line points={line(prevC, aMax)} n={n} />
        </ChartArea>
        <span className="sub" style={{ marginLeft: 62 }}>{anlWord}</span>
        <div className="n" style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--fg-55)' }}>
          <div style={{ width: 52, flex: 'none', textAlign: 'right' }}>Uke</div>
          <div style={{ flex: 1, position: 'relative', height: 14 }}>
            {Array.from({ length: Math.ceil(n / 4) }, (_, i) => 1 + i * 4).map(wk => (
              <span key={wk} style={{ position: 'absolute', transform: 'translateX(-50%)', left: `${((wk - 0.5) / n) * 100}%` }}>{wk}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ChartArea({ height, axis, nowPos, showNowLabel, children }: { height: number; axis: string[]; nowPos: string; showNowLabel?: boolean; children: React.ReactNode[] }) {
  const [barsEl, lineEl] = [children.slice(0, -1), children[children.length - 1]];
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: showNowLabel ? 0 : 6 }}>
      <div className="n" style={{ width: 52, flex: 'none', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height, textAlign: 'right', fontSize: 11, color: 'rgba(243,245,246,.5)' }}>
        {axis.map(a => <span key={a}>{a}</span>)}
      </div>
      <div style={{ flex: 1, position: 'relative', height, borderBottom: '1px solid rgba(255,255,255,.2)', backgroundImage: 'linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px)', backgroundSize: `100% ${height / (axis.length - 1)}px` }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', gap: 2, alignItems: 'flex-end' }}>{barsEl}</div>
        {lineEl}
        <div style={{ position: 'absolute', top: showNowLabel ? -8 : -4, bottom: -4, width: 0, borderLeft: '1px dashed rgba(243,245,246,.55)', pointerEvents: 'none', left: nowPos }} />
        {showNowLabel && <span className="n" style={{ position: 'absolute', top: -22, transform: 'translateX(-50%)', fontSize: 11, background: '#F3F5F6', color: '#0B0E11', borderRadius: 999, padding: '0 7px', left: nowPos }}>Nå</span>}
      </div>
    </div>
  );
}

const Line = ({ points, n }: { points: string; n: number }) => (
  <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
    <polyline points={points} fill="none" stroke="#E8ECEF" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
  </svg>
);

function WeekTable({ w, name, dirWord }: { w: WeeklyReport; name: string; dirWord: string }) {
  return (
    <section className="glass" style={{ padding: '18px 20px' }}>
      <h2 className="ttl" style={{ marginBottom: 8 }}>Per uke – {name}, {dirWord}</h2>
      <div className="scroll" style={{ maxHeight: 520 }}>
        <table className="rtable">
          <thead><tr><th>Uke</th><th className="r">Tonn {w.prev_year}</th><th className="r">Tonn {w.year}</th><th className="r">Anløp {w.prev_year}</th><th className="r">Anløp {w.year}</th><th>Type</th></tr></thead>
          <tbody>
            {w.weeks.map(r => (
              <tr key={r.week}>
                <td>Uke {r.week}</td>
                <td className="r n">{nb(r.tonnes_prev)}</td>
                <td className="r n">{nb(r.tonnes ?? r.forecast_tonnes ?? 0)}</td>
                <td className="r n">{r.calls_prev}</td>
                <td className="r n">{r.calls ?? r.forecast_calls}</td>
                <td style={{ color: 'rgba(243,245,246,.6)' }}>{r.kind === 'faktisk' ? 'Faktisk' : 'Prognose'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProductTable({ rows, last, dirWord, selected, onPick }: { rows: ProductReportRow[]; last: number; dirWord: string; selected: string; onPick: (id: string) => void }) {
  const tot = rows.reduce((a, r) => ({ y: a.y + r.ytd_tonnes, y5: a.y5 + r.ytd_tonnes_prev, p: a.p + r.forecast_tonnes, p5: a.p5 + r.forecast_tonnes_prev }), { y: 0, y5: 0, p: 0, p5: 0 });
  const weeks = rows[0]?.series.length ?? 52;
  const chg = (a: number, b: number) => (b > 0.5 ? `${arrow(a, b)}${pct(a, b)}` : '–');
  return (
    <section className="glass" aria-labelledby="c-prod" style={{ padding: '18px 8px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ padding: '0 14px' }}>
        <h2 id="c-prod" className="ttl" style={{ fontSize: 20 }}>Varer {dirWord}</h2>
        <span className="sub">Hittil i år mot samme uker i fjor, og prognose for resten av året. Velg en vare for å se den i grafen.</span>
      </div>
      <div className="scroll" style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 940 }}>
          <div className="prow" style={{ cursor: 'default', fontSize: 12, color: 'var(--fg-55)', borderTop: 'none' }}>
            <span>Vare</span><span>Emballasje</span><span className="r">Hittil i år</span><span className="r">I fjor samme</span><span className="r">Endring</span>
            <span className="r">Prognose uke {last + 1}–{weeks}</span><span className="r">Mot i fjor</span><span>Uke 1–{weeks}</span>
          </div>
          {rows.map(r => {
            const mx = Math.max(1, ...r.series_prev, ...r.series);
            const pts = (arr: number[], from: number, to: number) => arr.slice(from, to).map((v, k) => `${(from + k + 0.5).toFixed(1)},${(24 - (v / mx) * 22).toFixed(1)}`).join(' ');
            return (
              <button key={r.product_id} type="button" className="prow" aria-pressed={selected === r.product_id} onClick={() => onPick(r.product_id)}
                style={selected === r.product_id ? { background: 'rgba(157,184,255,.12)' } : undefined}>
                <span style={{ fontSize: 15 }}>{r.name}</span>
                <span style={{ fontSize: 13, color: 'rgba(243,245,246,.65)' }}>{r.packaging}</span>
                <span className="n r">{r.ytd_tonnes > 0.5 ? nb(r.ytd_tonnes) : '–'}</span>
                <span className="n r" style={{ color: 'rgba(243,245,246,.7)' }}>{r.ytd_tonnes_prev > 0.5 ? nb(r.ytd_tonnes_prev) : '–'}</span>
                <span className="n r">{chg(r.ytd_tonnes, r.ytd_tonnes_prev)}</span>
                <span className="n r">{r.forecast_tonnes > 0.5 ? nb(r.forecast_tonnes) : '–'}</span>
                <span className="n r">{chg(r.forecast_tonnes, r.forecast_tonnes_prev)}</span>
                <svg viewBox={`0 0 ${weeks} 24`} preserveAspectRatio="none" role="img" aria-label={`${r.name}: ${chg(r.ytd_tonnes, r.ytd_tonnes_prev)} hittil i år`} style={{ width: 130, height: 26, overflow: 'visible' }}>
                  <polyline points={pts(r.series_prev, 0, weeks)} fill="none" stroke="rgba(232,236,239,.55)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
                  <polyline points={pts(r.series, 0, last)} fill="none" stroke="#9DB8FF" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
                  <polyline points={pts(r.series, Math.max(0, last - 1), weeks)} fill="none" stroke="#9DB8FF" strokeWidth="1.6" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
                </svg>
              </button>
            );
          })}
          <div className="prow" style={{ cursor: 'default', fontWeight: 500 }}>
            <span>Sum alle varer</span><span />
            <span className="n r">{nb(tot.y)}</span>
            <span className="n r" style={{ color: 'rgba(243,245,246,.7)' }}>{nb(tot.y5)}</span>
            <span className="n r">{chg(tot.y, tot.y5)}</span>
            <span className="n r">{nb(tot.p)}</span>
            <span className="n r">{chg(tot.p, tot.p5)}</span>
            <span />
          </div>
        </div>
      </div>
      <span className="sub" style={{ padding: '4px 14px 8px' }}>Tonn. BB = 1 000 kg · pall 25 kg × 40 = 1 000 kg · pall 25 kg × 42 = 1 050 kg.</span>
    </section>
  );
}

function Punctuality({ points }: { points: { week: number; share: number | null; calls: number; on_time: number }[] }) {
  const [hl, setHl] = useState<number | null>(null);
  const x = (i: number) => ((i + 0.5) / points.length) * 100;
  const y = (v: number) => 100 - ((Math.max(50, Math.min(100, v)) - 50) / 50) * 100;
  const valid = points.map((p, i) => ({ ...p, i })).filter(p => p.share != null);
  return (
    <section className="glass" aria-labelledby="c2" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div><h2 id="c2" className="ttl">Punktlighet</h2><span className="sub">Andel anløp innenfor ±30 min av ETA · siste {points.length} uker</span></div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div className="n" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: 140, fontSize: 11, color: 'rgba(243,245,246,.5)', textAlign: 'right', width: 34 }}>
          <span>100 %</span><span>75 %</span><span>50 %</span>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ position: 'relative', height: 140, borderBottom: '1px solid rgba(255,255,255,.18)', backgroundImage: 'linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px)', backgroundSize: '100% 70px' }}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
              <polyline points={valid.map(p => `${x(p.i).toFixed(2)},${y(p.share! * 100).toFixed(2)}`).join(' ')} fill="none" stroke="#9DB8FF" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            {valid.map(p => (
              <div key={p.week} onMouseEnter={() => setHl(p.i)} onMouseLeave={() => setHl(null)}
                style={{ position: 'absolute', top: 0, bottom: 0, width: `${100 / points.length}%`, transform: 'translateX(-50%)', left: `${x(p.i)}%` }}>
                <span style={{ position: 'absolute', left: '50%', width: 9, height: 9, margin: '-4.5px 0 0 -4.5px', borderRadius: '50%', background: '#9DB8FF', boxShadow: '0 0 0 2px #14191E', top: `${y(p.share! * 100)}%` }} />
                {hl === p.i && (
                  <span className="tip n" style={{ left: '50%', top: `${y(p.share! * 100)}%` }}>
                    Uke {p.week}: {Math.round(p.share! * 100)} % ({p.on_time} av {p.calls})
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="n" style={{ position: 'relative', height: 14, fontSize: 11, color: 'var(--fg-55)' }}>
            {points.map((p, i) => <span key={p.week} style={{ position: 'absolute', transform: 'translateX(-50%)', left: `${x(i)}%` }}>{p.week}</span>)}
          </div>
        </div>
      </div>
    </section>
  );
}

function HBar({ label, value, share, height, labelWidth }: { label: string; value: string; share: number; height: number; labelWidth: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `${labelWidth}px 1fr 28px`, alignItems: 'center', gap: 10, fontSize: 14 }}>
      <span>{label}</span>
      <span style={{ height, borderRadius: '0 4px 4px 0', background: 'rgba(255,255,255,.04)' }}>
        <span style={{ display: 'block', height: '100%', borderRadius: '0 4px 4px 0', background: '#9DB8FF', width: `${Math.max(0, Math.min(1, share)) * 100}%` }} />
      </span>
      <span className="n" style={{ textAlign: 'right' }}>{value}</span>
    </div>
  );
}
