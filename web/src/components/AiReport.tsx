import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { AiReport as Report } from '../../../shared/api.ts';
import { addDays, todayOslo } from '../../../shared/time.ts';
import { api, errorText } from '../lib/api.ts';
import { locale, tr } from '../lib/i18n.ts';
import { printReport } from '../lib/printReport.ts';
import { Sparkle } from './Icons.tsx';
import { Markdown } from './Markdown.tsx';

// Rapport med forklaringer (Claude): velg måned eller periode, få tall og hva som har endret seg mot perioden før.

type Period = { key: string; label: string; from: string; to: string };

function periods(): Period[] {
  const today = todayOslo();
  const [y, m] = today.split('-').map(Number);
  const fmt = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const out: Period[] = [];
  for (let i = 1; i <= 12; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const from = d.toISOString().slice(0, 10);
    const to = addDays(new Date(Date.UTC(y, m - i, 1)).toISOString().slice(0, 10), -1);
    const label = fmt.format(d);
    out.push({ key: from, label: label[0].toUpperCase() + label.slice(1), from, to });
  }
  return [
    { key: 'mnd', label: tr('Denne måneden hittil'), from: `${today.slice(0, 8)}01`, to: today },
    ...out,
    { key: 'ytd', label: tr('Hittil i år'), from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
}

export function AiReport() {
  const list = periods();
  const [key, setKey] = useState(list[1].key);
  const p = list.find(x => x.key === key)!;
  const m = useMutation({ mutationFn: (fresh: boolean) => api<Report>('/ask/report', { body: { from: p.from, to: p.to, fresh } }) });
  const r = m.data && m.data.from === p.from && m.data.to === p.to ? m.data : null;
  const range = `${p.from.split('-').reverse().join('.')}–${p.to.split('-').reverse().join('.')}`;
  return (
    <section className="glass" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }} aria-labelledby="ai-report-h">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 id="ai-report-h" style={{ margin: 0, fontSize: 22, fontWeight: 300, display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <Sparkle size={18} /> {tr('Rapport med forklaringer')}
        </h2>
        <select className="inp inp-round" value={key} onChange={e => { setKey(e.target.value); m.reset(); }} aria-label={tr('Periode')}>
          {list.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        <button type="button" className="btn btn-w" disabled={m.isPending} onClick={() => m.mutate(false)}>{m.isPending ? tr('Lager rapport …') : tr('Lag rapport')}</button>
      </div>
      {!r && !m.isPending && !m.isError && <p className="muted" style={{ margin: 0, fontSize: 14 }}>{tr('Tonn, kunder, produkter, avvik og punktlighet for perioden, sammenlignet med perioden før – med forklaringer på hva som har endret seg.')}</p>}
      {m.isPending && <p className="sub loading" style={{ margin: 0 }}>{tr('Flow henter tallene og skriver rapporten … (ca. 20–40 sekunder)')}</p>}
      {m.isError && <div className="error-box">{errorText(m.error)}</div>}
      {r && (
        <>
          <span className="sub">{p.label} · {range}</span>
          <Markdown text={r.text} go={() => {}} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn" onClick={() => printReport(`${tr('Rapport')} · ${p.label}`, `Flatholmen havn 81B · ${range}`, r.text,
              `${tr('Laget av Claude fra dataene i Flow')} · ${new Date(r.created_at).toLocaleString(locale())}`)}>{tr('Last ned PDF')}</button>
            <button type="button" className="btn" disabled={m.isPending} onClick={() => m.mutate(true)}>{tr('Lag på nytt')}</button>
            <span className="sub" style={{ fontSize: 11 }}>{tr('Laget av Claude fra dataene i Flow. Kan ta feil – sjekk tallene før du bruker dem.')}</span>
          </div>
        </>
      )}
    </section>
  );
}
