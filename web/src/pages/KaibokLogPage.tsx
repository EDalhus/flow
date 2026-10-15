import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { QuayLogView } from '../../../shared/api.ts';
import { CATEGORY_LABEL } from '../../../shared/domain/types.ts';
import { ArrowUpRight, Camera, Star } from '../components/Icons.tsx';
import { Page } from '../components/Topbar.tsx';
import { Loading, QuayMark, SearchBox, Segmented, Stars } from '../components/ui.tsx';
import { ddmm, fr, osloTime, serviceDate } from '../lib/format.ts';
import { useQuayLogs } from '../lib/queries.ts';
import './kaibok.css';

type Filter = 'alle' | 'avvik' | 'ok';

export function KaibokLogPage() {
  const [filter, setFilter] = useState<Filter>('alle');
  const [q, setQ] = useState('');
  const [params, setParams] = useSearchParams();
  const logs = useQuayLogs(60, filter, q.trim());
  const items = logs.data?.items ?? [];
  const stats = logs.data?.stats;
  const sel = items.find(l => l.id === params.get('id')) ?? items[0];
  const avg = stats?.avg != null ? fr(stats.avg) : '–';

  return (
    <Page>
      <div style={{ flex: '999 1 700px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title">Kaibok</h1>
            <span className="muted">Ferdigstilte anløp · siste 60 dager</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Segmented<Filter> label="Filter" value={filter} onChange={setFilter}
              options={[{ value: 'alle', label: 'Alle' }, { value: 'avvik', label: 'Med avvik' }, { value: 'ok', label: 'Uten avvik' }]} />
            <SearchBox value={q} onChange={setQ} placeholder="Båt eller person" label="Søk etter båt eller person" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          {[
            ['Kaibøker levert', String(stats?.count ?? '–'), ''],
            ['Med avvik', String(stats?.with_deviation ?? '–'), stats?.deviation_share != null ? ` · ${Math.round(stats.deviation_share * 100)} %` : ''],
            ['Snittvurdering', avg.split(',')[0], avg.includes(',') ? `,${avg.split(',')[1]} av 5` : ''],
          ].map(([label, big, dim]) => (
            <div key={label} className="glass" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 4, borderRadius: 22 }}>
              <span style={{ fontSize: 13, color: 'var(--fg-62)' }}>{label}</span>
              <span className="n" style={{ fontSize: 44, fontWeight: 200, lineHeight: 1.05, letterSpacing: '-0.02em' }}>
                {big}<span style={{ color: 'var(--fg-45)', fontSize: 24 }}>{dim}</span>
              </span>
            </div>
          ))}
        </div>

        <section className="panel-light" aria-label="Kaibøker" style={{ overflow: 'hidden' }}>
          <div className="krow hide-s" style={{ cursor: 'default', fontSize: 12, color: 'var(--fg-55)', borderTop: 'none' }}>
            <span>Dato</span><span>Båt</span><span>Ansvarlig</span><span>Avvik</span><span>Vurdering</span><span>Bilder</span>
          </div>
          <div className="scroll" style={{ maxHeight: 'calc(100vh - 400px)', minHeight: 200 }}>
            {logs.isPending && <Loading />}
            {items.map(l => (
              <button key={l.id} type="button" className="krow" aria-pressed={sel?.id === l.id} onClick={() => setParams({ id: l.id }, { replace: true })}
                style={sel?.id === l.id ? { background: 'rgba(var(--tint), .08)' } : undefined}>
                <span className="n" style={{ fontSize: 15 }}>{ddmm(l.delivered_at)}</span>
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 16 }}>{l.boat.name}</span>
                  <span style={{ fontSize: 12 }}><QuayMark quay={l.quay} compact /></span>
                </span>
                <span className="hide-s" style={{ fontSize: 14, color: 'var(--fg-85)' }}>{l.responsible?.short_name ?? l.delivered_by?.short_name ?? '–'}</span>
                <span className="hide-s" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {l.had_deviation
                    ? (l.categories.length ? l.categories : ['annet' as const]).map(c => (
                      <span key={c} style={{ fontSize: 12, borderRadius: 999, padding: '2px 9px', background: 'rgba(255,107,94,.15)', color: 'var(--bad-fg)' }}>{CATEGORY_LABEL[c]}</span>
                    ))
                    : <span style={{ fontSize: 13, color: 'var(--fg-55)' }}>Ingen avvik</span>}
                </span>
                <span className="n hide-s" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 15 }}><Star size={13} />{fr(l.avg)}</span>
                <span className="n hide-s" style={{ fontSize: 14, color: 'rgba(var(--tint), .7)' }}>{l.photos.length ? `${l.photos.length} stk` : '–'}</span>
              </button>
            ))}
            {logs.isSuccess && !items.length && <p className="empty">Ingen kaibøker matcher.</p>}
          </div>
        </section>
      </div>

      {sel && <LogDetail log={sel} />}
    </Page>
  );
}

function LogDetail({ log: l }: { log: QuayLogView }) {
  const d = serviceDate(l.delivered_at);
  const crew = l.crew.map(u => u.short_name).join(', ');
  const rows: [string, number][] = [
    ['Punktlighet', l.ratings.punctuality],
    ['Samarbeidsvilje (mannskap)', l.ratings.cooperation],
    ['Utstyr / kran', l.ratings.equipment],
  ];
  return (
    <aside className="glass scroll" aria-labelledby="kb-h" style={{ flex: '1 1 360px', maxWidth: 400, padding: 20, display: 'flex', flexDirection: 'column', gap: 18, maxHeight: 'calc(100vh - 120px)', position: 'sticky', top: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="n" style={{ fontSize: 13, color: 'var(--fg-62)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {`${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`} · <QuayMark quay={l.quay} compact /> · levert av {l.delivered_by?.short_name ?? 'ukjent'} {osloTime(l.delivered_at)}
          </span>
        </span>
        <h2 id="kb-h" style={{ margin: 0, fontSize: 32, fontWeight: 300, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{l.boat.name}</h2>
        <span style={{ fontSize: 14, color: 'var(--fg-75)' }}>{l.responsible ? `Ansvarlig ${l.responsible.short_name}` : 'Ingen ansvarlig'}{crew ? ` · ${crew}` : ''}</span>
      </div>

      {l.had_deviation ? (
        <div style={{ borderRadius: 22, padding: 16, background: 'rgba(120,42,38,.4)', border: '1px solid rgba(255,107,94,.2)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="dot" style={{ width: 8, height: 8, background: '#E5484D' }} />Avvik registrert</span>
          {l.categories.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {l.categories.map(c => <span key={c} style={{ fontSize: 13, borderRadius: 999, padding: '4px 11px', background: 'rgba(var(--tint), .1)' }}>{CATEGORY_LABEL[c]}</span>)}
            </div>
          )}
          {l.description && <p style={{ margin: 0, fontSize: 15 }}>{l.description}</p>}
          {l.photos.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
              {l.photos.map((p, i) => (
                <a key={p.id} href={p.url} target="_blank" rel="noreferrer" aria-label={`Bilde ${i + 1}`}
                  style={{ aspectRatio: '1 / 1', borderRadius: 14, overflow: 'hidden', background: 'rgba(var(--tint), .06)', border: '1px solid rgba(var(--tint), .08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-62)' }}>
                  {p.thumb_url ? <img src={p.thumb_url} alt={`Avviksbilde ${i + 1}`} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Camera size={20} />}
                </a>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ borderRadius: 18, padding: '14px 16px', background: 'rgba(91,214,138,.1)', border: '1px solid rgba(91,214,138,.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="dot" style={{ width: 8, height: 8, background: '#5BD68A' }} />Ingen avvik
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 400, color: 'var(--fg-62)' }}>Vurdering · snitt {fr(l.avg)}</h3>
        {rows.map(([label, v]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 14 }}>{label}</span>
            <Stars value={v} />
          </div>
        ))}
      </div>

      {l.boat_note && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 400, color: 'var(--fg-62)' }}>Notat til båtprofilen</h3>
          <p style={{ margin: 0, fontSize: 15 }}>{l.boat_note}</p>
        </div>
      )}
      <Link to={`/baater?id=${l.boat.id}`} className="btn" style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', fontSize: 14, padding: '0 16px' }}>
        Se båtprofil <ArrowUpRight size={14} strokeWidth={2} />
      </Link>
    </aside>
  );
}
