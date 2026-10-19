import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { BulkGroup, BulkOrderView, BulkRegistry } from '../../../shared/api.ts';
import { bulkDemand } from '../../../shared/domain/bulk.ts';
import { BookingForm, PhaseBadge, StepChips, downloadCsv } from '../components/Bulk.tsx';
import { ArrowUpRight, Phone } from '../components/Icons.tsx';
import { Page } from '../components/Topbar.tsx';
import { Loading, Segmented } from '../components/ui.tsx';
import { errorText } from '../lib/api.ts';
import { addDays, dayShort, ddmm, fr, osloTime, telHref, todayOslo } from '../lib/format.ts';
import { tr } from '../lib/i18n.ts';
import {
  useBulkAction, useBulkLog, useBulkOrders, useBulkQualities, useBulkRegistry, useBulkReport, useBulkWeighings, useCreateBulkOrder, useSaveRegistry,
} from '../lib/queries.ts';
import './moduler.css';

type Tab = 'ko' | 'veiinger' | 'rapport' | 'register';

/**
 * Bulkutlevering (kontoret): kø med status fra sjåførene, dagens veiinger, rapporter og registre.
 * Sjåførene laster selv i sjåførvisningen (/sjafor) med egen innlogging.
 */
export function BulkPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('vis') as Tab) || 'ko';
  const setTab = (t: Tab) => setParams(p => { if (t === 'ko') p.delete('vis'); else p.set('vis', t); return p; }, { replace: true });
  const orders = useBulkOrders();
  const stopped = (orders.data ?? []).filter(o => o.stopped_at);

  return (
    <Page>
      <div style={{ flex: '999 1 640px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title">{tr('Bulkbil')}</h1>
            <span className="muted">{tr('Utlevering av salt i bulk · sjåførene laster selv i sjåførvisningen')}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Segmented<Tab> label={tr('Visning')} value={tab} onChange={setTab}
              options={[{ value: 'ko', label: tr('Kø') }, { value: 'veiinger', label: tr('Veiinger') }, { value: 'rapport', label: tr('Rapport') }, { value: 'register', label: tr('Register') }]} />
            <a href="/sjafor" target="_blank" rel="noreferrer" className="btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
              {tr('Sjåførvisning')} <ArrowUpRight size={15} />
            </a>
            <Link to="/hjullaster" className="btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
              {tr('Hjullasterskjerm')} <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>
        {stopped.map(o => (
          <div key={o.id} role="alert" style={{ borderRadius: 18, padding: '14px 18px', background: '#E5484D', color: '#fff', fontSize: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{tr('NØDSTOPP')}</strong>
            <span style={{ flex: 1 }}>{o.truck}{o.driver_profile ? ` · ${o.driver_profile.name}` : ''} · {tr('stoppet {tid}', { tid: osloTime(o.stopped_at!) })}</span>
            {o.driver_profile && <a href={telHref(`+${o.driver_profile.phone}`)} style={{ color: '#fff' }}>{tr('Ring sjåføren')}</a>}
          </div>
        ))}
        {tab === 'ko' && <Queue orders={orders.data} loading={orders.isPending} />}
        {tab === 'veiinger' && <Weighings />}
        {tab === 'rapport' && <Report />}
        {tab === 'register' && <Registry />}
      </div>
      {tab === 'ko' && <OfficeBooking />}
    </Page>
  );
}

// ---------------------------------------------------------------- kø

function Queue({ orders, loading }: { orders: BulkOrderView[] | undefined; loading: boolean }) {
  const qualities = useBulkQualities();
  const list = orders ?? [];
  const today = todayOslo();
  const day = (o: BulkOrderView) => (o.expected_at ?? o.created_at).slice(0, 10);
  const active = list.filter(o => o.status === 'lastes');
  const queue = list.filter(o => o.status === 'bestilt' && day(o) <= today);
  const ahead = list.filter(o => o.status === 'bestilt' && day(o) > today);
  const done = list.filter(o => o.status === 'ferdig' || o.status === 'avlyst');
  const demand = bulkDemand([...active, ...queue]);
  const group = (title: string, l: BulkOrderView[]) => l.length > 0 && (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span className="eyebrow">{title} · {l.length}</span>
      {l.map(o => <BulkCard key={o.id} order={o} />)}
    </section>
  );
  return (
    <>
      <section aria-label={tr('Behov i traktene')} style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
        {(qualities.data ?? []).map(q => (
          <div key={q.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="qdot" style={{ ['--q' as string]: q.color, width: 9, height: 9 }} />{q.name}</span>
            <span className="n" style={{ fontSize: 34, fontWeight: 300 }}>{fr(demand[q.id] ?? 0)}<span className="muted" style={{ fontSize: 15 }}> t</span></span>
          </div>
        ))}
      </section>
      {loading && <Loading />}
      {group(tr('Lastes nå'), active)}
      {group(tr('I kø i dag'), queue)}
      {group(tr('Bestilt fram i tid'), ahead)}
      {!loading && !active.length && !queue.length && !ahead.length && <p className="empty glass">{tr('Ingen bestillinger i kø.')}</p>}
      {group(tr('Ferdig i dag'), done)}
    </>
  );
}

function BulkCard({ order: o }: { order: BulkOrderView }) {
  const act = useBulkAction();
  const [showLog, setShowLog] = useState(false);
  const open = o.status === 'bestilt' || o.status === 'lastes';
  return (
    <article className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, borderRadius: 24, ...(o.stopped_at ? { borderColor: '#E5484D' } : o.status === 'lastes' ? { borderColor: 'rgba(128,239,222,.45)' } : {}), ...(o.status === 'avlyst' ? { opacity: .55 } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 19 }}>{o.truck}{o.hauler && !o.hauler.own && <span className="muted" style={{ fontSize: 14 }}> · {o.hauler.name}</span>}</span>
          <span style={{ fontSize: 14, color: 'var(--fg-75)' }}>
            {o.customer?.name ?? o.destination ?? '–'}
            {o.project_no && <span className="muted"> · {tr('prosjekt {nr}', { nr: o.project_no })}</span>}
            {o.so_number && <span className="muted"> · SO {o.so_number}</span>}
          </span>
          {(o.driver_profile || o.driver) && (
            <span style={{ fontSize: 13, color: 'var(--fg-62)', display: 'flex', gap: 8, alignItems: 'center' }}>
              {o.driver_profile?.name ?? o.driver?.name}
              {o.driver_profile && <a href={telHref(`+${o.driver_profile.phone}`)} aria-label={tr('Ring {navn}', { navn: o.driver_profile.name })} style={{ color: 'var(--aqua)', display: 'inline-flex' }}><Phone size={13} /></a>}
            </span>
          )}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <PhaseBadge o={o} style={{ fontSize: 13 }} />
          {o.delivery_no && <span className="n muted" style={{ fontSize: 12 }}>{tr('Følgeseddel nr. {n}', { n: o.delivery_no })}</span>}
        </span>
      </div>
      <StepChips o={o} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="tab" onClick={() => setShowLog(!showLog)} aria-expanded={showLog} style={{ minHeight: 34, fontSize: 13 }}>{tr('Logg')}</button>
        {o.status === 'ferdig' && o.delivery_no && (
          <a className="btn" href={`/api/bulk/orders/${o.id}/pdf`} target="_blank" rel="noreferrer" style={{ minHeight: 36, fontSize: 13, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
            {tr('Følgeseddel (PDF)')}
          </a>
        )}
        {o.stopped_at && (
          <button type="button" className="btn" disabled={act.isPending} style={{ minHeight: 36, fontSize: 13 }} onClick={() => act.mutate({ id: o.id, action: 'continue' })}>{tr('Fortsett lasting')}</button>
        )}
        {open && (
          <button type="button" className="btn" disabled={act.isPending} style={{ marginLeft: 'auto', minHeight: 36, fontSize: 13 }}
            onClick={() => confirm(tr('Fjerne bestillingen for {bil}? Bruk dette hvis den ble feil eller ikke blir hentet i dag.', { bil: o.truck })) && act.mutate({ id: o.id, action: 'cancel' })}>
            {tr('Fjern ordre')}
          </button>
        )}
      </div>
      {showLog && <BulkLog id={o.id} />}
      {act.isError && <div className="error-box">{errorText(act.error)}</div>}
    </article>
  );
}

const LOG_TEXT: Record<string, string> = {
  booked: 'Bestilt', started: 'Startet lasting', weighed: 'Steg ferdig – veid', stopped: 'NØDSTOPP', continued: 'Fortsatte lasting',
  finished: 'Ferdig – følgeseddel laget', cancelled: 'Fjernet',
};

function BulkLog({ id }: { id: string }) {
  const log = useBulkLog(id);
  if (log.isPending) return <Loading />;
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 13 }}>
      {(log.data ?? []).map(l => {
        const d = l.data as { weighed?: number; ordered?: number; target?: string; quality?: string };
        return (
          <li key={l.id} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 10, padding: '6px 0', borderTop: '1px solid var(--line-soft)' }}>
            <span className="n muted">{ddmm(l.at)} {osloTime(l.at)}</span>
            <span>
              {tr(LOG_TEXT[l.kind] ?? l.kind)}
              {l.kind === 'weighed' && ` · ${d.target === 'henger' ? tr('Henger') : tr('Bil')} ${d.quality ?? ''}: ${tr('bestilt {a} t, veid {b} t', { a: fr(d.ordered ?? 0), b: fr(d.weighed ?? 0, 2) })}`}
              <span className="muted"> · {l.by ?? 'Flow'}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Kontoret bestiller for en sjåfør (f.eks. på telefon), nå eller frem i tid. */
function OfficeBooking() {
  const reg = useBulkRegistry();
  const qualities = useBulkQualities();
  const create = useCreateBulkOrder();
  const [key, setKey] = useState(0);
  const r = reg.data;
  return (
    <aside className="glass" aria-labelledby="bulk-h" style={{ flex: '1 1 380px', maxWidth: 460, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 20 }}>
      <h2 id="bulk-h" style={{ margin: 0, fontSize: 24, fontWeight: 300 }}>{tr('Bestill lasting')}</h2>
      {!r ? <Loading /> : !r.vehicles.length || !r.customers.length
        ? <p className="muted" style={{ margin: 0 }}>{tr('Legg inn biler og kunder under Register først.')}</p>
        : <BookingForm key={key} vehicles={r.vehicles.filter(v => v.active)} customers={r.customers.filter(c => c.active)} qualities={qualities.data ?? []}
            drivers={r.drivers.filter(d => d.active)} pending={create.isPending} error={create.isError ? errorText(create.error) : null}
            onSubmit={b => create.mutate(b, { onSuccess: () => setKey(k => k + 1) })} />}
    </aside>
  );
}

// ---------------------------------------------------------------- veiinger

function Weighings() {
  const [day, setDay] = useState(todayOslo());
  const w = useBulkWeighings(day, day);
  const rows = w.data ?? [];
  const sum = (k: 'ordered' | 'weighed') => rows.reduce((t, r) => t + (r[k] ?? 0), 0);
  const csv = () => downloadCsv(`veiinger-${day}.csv`, [
    [tr('Tid'), tr('Følgeseddel'), tr('Bil'), tr('Sjåfør'), tr('Transportør'), tr('Kunde'), tr('Prosjekt'), 'SO', tr('Kvalitet'), tr('Bil/henger'), tr('Bestilt (t)'), tr('Veid (t)')],
    ...rows.map(r => [osloTime(r.at), r.delivery_no, r.vehicle, r.driver, r.hauler, r.customer, r.project_no, r.so_number, r.quality_name, r.target, r.ordered, r.weighed]),
  ]);
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={() => setDay(addDays(day, -1))} aria-label={tr('Forrige dag')}>‹</button>
        <input className="inp n" type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} style={{ width: 170 }} />
        <button type="button" className="btn" onClick={() => setDay(addDays(day, 1))} aria-label={tr('Neste dag')} disabled={day >= todayOslo()}>›</button>
        <span className="muted" style={{ flex: 1 }}>{tr('{n} veiinger · {t} t veid', { n: rows.length, t: fr(sum('weighed'), 2) })}</span>
        <button type="button" className="btn" disabled={!rows.length} onClick={csv}>{tr('Last ned (Excel/CSV)')}</button>
      </div>
      {w.isPending ? <Loading /> : !rows.length ? <p className="empty glass">{tr('Ingen veiinger denne dagen.')}</p> : (
        <div className="panel-light" style={{ overflowX: 'auto' }}>
          <table className="btable">
            <thead><tr>
              <th>{tr('Tid')}</th><th>{tr('Nr.')}</th><th>{tr('Bil')}</th><th>{tr('Sjåfør')}</th><th>{tr('Kunde')}</th><th>{tr('Prosjekt')}</th>
              <th>{tr('Kvalitet')}</th><th className="r">{tr('Bestilt')}</th><th className="r">{tr('Veid')}</th><th className="r">{tr('Avvik')}</th>
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const diff = r.weighed != null ? r.weighed - r.ordered : null;
                return (
                  <tr key={r.step_id}>
                    <td className="n">{osloTime(r.at)}</td><td className="n">{r.delivery_no ?? '–'}</td>
                    <td>{r.vehicle}{r.target ? <span className="muted"> · {r.target === 'henger' ? tr('henger') : tr('bil')}</span> : null}</td>
                    <td>{r.driver ?? '–'}{r.hauler && <span className="muted"> · {r.hauler}</span>}</td><td>{r.customer ?? '–'}</td><td>{r.project_no ?? '–'}</td>
                    <td><span className="qdot" style={{ ['--q' as string]: r.color, display: 'inline-block', width: 9, height: 9, marginRight: 6 }} />{r.quality_name}</td>
                    <td className="r n">{fr(r.ordered)}</td><td className="r n" style={{ fontWeight: 500 }}>{fr(r.weighed, 2)}</td>
                    <td className="r n" style={{ color: diff != null && Math.abs(diff) > 0.5 ? 'var(--bad-fg)' : 'var(--fg-62)' }}>{diff == null ? '–' : `${diff > 0 ? '+' : ''}${fr(diff, 2)}`}</td>
                  </tr>
                );
              })}
              <tr className="sum"><td colSpan={7}>{tr('Sum')}</td><td className="r n">{fr(sum('ordered'))}</td><td className="r n">{fr(sum('weighed'), 2)}</td><td /></tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- rapport

const GROUPS: { value: BulkGroup; label: string }[] = [
  { value: 'kvalitet', label: 'Kvalitet' }, { value: 'kunde', label: 'Kunde' }, { value: 'bil', label: 'Bil' }, { value: 'sjafor', label: 'Sjåfør' },
  { value: 'transportor', label: 'Transportør' }, { value: 'prosjekt', label: 'Prosjekt' }, { value: 'dag', label: 'Dag' },
];
type Period = 'dag' | 'uke' | 'maned' | 'ar' | 'egen';

function Report() {
  const today = todayOslo();
  const [period, setPeriod] = useState<Period>('maned');
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const [group, setGroup] = useState<BulkGroup>('kvalitet');
  const range = period === 'dag' ? { from: today, to: today } : period === 'uke' ? { from: addDays(today, -6), to: today }
    : period === 'maned' ? { from: addDays(today, -29), to: today } : period === 'ar' ? { from: `${today.slice(0, 4)}-01-01`, to: today } : custom;
  const r = useBulkReport(range.from, range.to, group);
  const rows = r.data?.rows ?? [];
  const max = Math.max(1, ...rows.map(x => x.weighed));
  const label = tr(GROUPS.find(g => g.value === group)!.label);
  const name = (l: string) => (group === 'dag' ? dayShort(l) : l);
  const csv = () => r.data && downloadCsv(`bulk-${group}-${range.from}-${range.to}.csv`, [
    [label, tr('Lastinger'), tr('Bestilt (t)'), tr('Veid (t)'), tr('Snitt lastetid (min)')],
    ...rows.map(x => [group === 'dag' ? x.label : x.label, x.loads, x.ordered, x.weighed, x.minutes_avg]),
    [tr('Sum'), r.data.total.loads, r.data.total.ordered, r.data.total.weighed, r.data.total.minutes_avg],
  ]);
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Segmented<Period> label={tr('Periode')} value={period} onChange={setPeriod}
          options={[{ value: 'dag', label: tr('I dag') }, { value: 'uke', label: tr('7 dager') }, { value: 'maned', label: tr('30 dager') }, { value: 'ar', label: tr('Hittil i år') }, { value: 'egen', label: tr('Velg') }]} />
        {period === 'egen' && (
          <>
            <input className="inp n" type="date" value={custom.from} onChange={e => setCustom({ ...custom, from: e.target.value })} style={{ width: 160 }} aria-label={tr('Fra')} />
            <input className="inp n" type="date" value={custom.to} onChange={e => setCustom({ ...custom, to: e.target.value })} style={{ width: 160 }} aria-label={tr('Til')} />
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="sub">{tr('Per')}</span>
        <Segmented<BulkGroup> label={tr('Gruppering')} value={group} onChange={setGroup} options={GROUPS.map(g => ({ value: g.value, label: tr(g.label) }))} />
        <button type="button" className="btn" style={{ marginLeft: 'auto' }} disabled={!rows.length} onClick={csv}>{tr('Last ned (Excel/CSV)')}</button>
      </div>
      {r.data && (
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          {[[tr('Lastinger'), String(r.data.total.loads)], [tr('Veid'), `${fr(r.data.total.weighed)} t`], [tr('Bestilt'), `${fr(r.data.total.ordered)} t`],
            [tr('Snitt lastetid'), r.data.total.minutes_avg != null ? `${r.data.total.minutes_avg} min` : '–']].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column' }}><span className="sub">{k}</span><span className="n" style={{ fontSize: 30, fontWeight: 300 }}>{v}</span></div>
          ))}
        </div>
      )}
      {r.isPending ? <Loading /> : !rows.length ? <p className="empty glass">{tr('Ingen ferdige lastinger i perioden.')}</p> : (
        <div className="panel-light" style={{ overflowX: 'auto' }}>
          <table className="btable">
            <thead><tr><th>{label}</th><th className="r">{tr('Lastinger')}</th><th className="r">{tr('Bestilt (t)')}</th><th className="r">{tr('Veid (t)')}</th><th style={{ width: '30%' }} /><th className="r">{tr('Snitt lastetid')}</th></tr></thead>
            <tbody>
              {rows.map(x => (
                <tr key={x.key}>
                  <td>{name(x.label)}</td><td className="r n">{x.loads}</td><td className="r n">{fr(x.ordered)}</td><td className="r n" style={{ fontWeight: 500 }}>{fr(x.weighed, 2)}</td>
                  <td><span style={{ display: 'block', height: 8, borderRadius: 4, background: 'var(--teal)', width: `${(x.weighed / max) * 100}%` }} /></td>
                  <td className="r n">{x.minutes_avg != null ? `${x.minutes_avg} min` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- register

type Kind = 'drivers' | 'vehicles' | 'customers' | 'haulers';

function Registry() {
  const reg = useBulkRegistry();
  const [kind, setKind] = useState<Kind>('drivers');
  const [edit, setEdit] = useState<string | 'ny' | null>(null);
  const r = reg.data;
  if (!r) return <Loading />;
  const hauler = (id: string) => r.haulers.find(h => h.id === id)?.name ?? '–';
  const list: { id: string; title: string; sub: string; active: boolean }[] =
    kind === 'drivers' ? r.drivers.map(d => ({ id: d.id, title: d.name, sub: `+${d.phone} · ${d.hauler.name}${d.last_login_at ? ` · ${tr('sist innlogget {dato}', { dato: ddmm(d.last_login_at) })}` : ''}`, active: d.active }))
    : kind === 'vehicles' ? r.vehicles.map(v => ({ id: v.id, title: v.reg_no, sub: `${hauler(v.hauler_id)}${v.description ? ` · ${v.description}` : ''} · ${v.has_trailer ? tr('med henger') : tr('uten henger')}`, active: v.active }))
    : kind === 'customers' ? r.customers.map(c => ({ id: c.id, title: c.name, sub: [c.requires_project && tr('krever prosjektnr.'), c.email].filter(Boolean).join(' · ') || '–', active: c.active }))
    : r.haulers.map(h => ({ id: h.id, title: h.name, sub: [h.own && tr('egne biler'), h.phone].filter(Boolean).join(' · ') || '–', active: h.active }));
  const addLabel = { drivers: tr('Ny sjåfør'), vehicles: tr('Ny bil'), customers: tr('Ny kunde'), haulers: tr('Nytt transportfirma') }[kind];
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <section style={{ flex: '999 1 420px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Segmented<Kind> label={tr('Register')} value={kind} onChange={k => { setKind(k); setEdit(null); }}
            options={[{ value: 'drivers', label: tr('Sjåfører') }, { value: 'vehicles', label: tr('Biler') }, { value: 'customers', label: tr('Kunder') }, { value: 'haulers', label: tr('Transportfirma') }]} />
          <button type="button" className="btn btn-w" style={{ marginLeft: 'auto' }} onClick={() => setEdit('ny')}>+ {addLabel}</button>
        </div>
        <div className="glass" style={{ overflow: 'hidden' }}>
          {list.map(x => (
            <button key={x.id} type="button" onClick={() => setEdit(x.id)} aria-pressed={edit === x.id}
              style={{ width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, padding: '12px 18px', background: edit === x.id ? 'rgba(var(--tint), .06)' : 'transparent', border: 'none', borderTop: '1px solid var(--line-soft)', color: 'var(--fg)', opacity: x.active ? 1 : .5 }}>
              <span style={{ fontSize: 16 }}>{x.title}</span><span className="muted" style={{ fontSize: 13 }}>{x.sub}{x.active ? '' : ` · ${tr('deaktivert')}`}</span>
            </button>
          ))}
          {!list.length && <p className="empty">{tr('Ingen ennå.')}</p>}
        </div>
      </section>
      {edit && (
        <aside className="glass" style={{ flex: '1 1 340px', maxWidth: 420, padding: 20, position: 'sticky', top: 20 }}>
          <RegistryForm key={`${kind}-${edit}`} kind={kind} id={edit === 'ny' ? undefined : edit} reg={r} onDone={() => setEdit(null)} />
        </aside>
      )}
    </div>
  );
}

function RegistryForm({ kind, id, reg, onDone }: { kind: Kind; id?: string; reg: BulkRegistry; onDone: () => void }) {
  const save = useSaveRegistry();
  const d = kind === 'drivers' ? reg.drivers.find(x => x.id === id) : undefined;
  const v = kind === 'vehicles' ? reg.vehicles.find(x => x.id === id) : undefined;
  const c = kind === 'customers' ? reg.customers.find(x => x.id === id) : undefined;
  const h = kind === 'haulers' ? reg.haulers.find(x => x.id === id) : undefined;
  const [f, setF] = useState<Record<string, string | boolean>>({
    name: d?.name ?? c?.name ?? h?.name ?? '', phone: d ? `+${d.phone}` : h?.phone ?? '', hauler_id: d?.hauler.id ?? v?.hauler_id ?? reg.haulers[0]?.id ?? '',
    pin: '', reg_no: v?.reg_no ?? '', description: v?.description ?? '', has_trailer: v?.has_trailer ?? true, requires_project: c?.requires_project ?? false,
    email: c?.email ?? '', notes: c?.notes ?? '', own: h?.own ?? false, active: (d ?? v ?? c ?? h)?.active ?? true,
  });
  const text = (k: string, label: string, extra: Record<string, unknown> = {}) => (
    <label className="field"><span>{label}</span><input className="inp" value={String(f[k] ?? '')} onChange={e => setF({ ...f, [k]: e.target.value })} {...extra} /></label>
  );
  const check = (k: string, label: string) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}>
      <input type="checkbox" checked={!!f[k]} onChange={e => setF({ ...f, [k]: e.target.checked })} style={{ width: 18, height: 18, accentColor: '#F2F5F3' }} />{label}
    </label>
  );
  const haulerSelect = (
    <label className="field"><span>{tr('Transportfirma')}</span>
      <select className="inp" value={String(f.hauler_id)} onChange={e => setF({ ...f, hauler_id: e.target.value })}>
        {reg.haulers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
    </label>
  );
  const body: Record<string, unknown> =
    kind === 'drivers' ? { name: f.name, phone: f.phone, hauler_id: f.hauler_id, active: f.active, ...(f.pin ? { pin: f.pin } : {}) }
    : kind === 'vehicles' ? { reg_no: f.reg_no, hauler_id: f.hauler_id, description: f.description || null, has_trailer: f.has_trailer, active: f.active }
    : kind === 'customers' ? { name: f.name, requires_project: f.requires_project, email: f.email || null, notes: f.notes || null, active: f.active }
    : { name: f.name, own: f.own, phone: f.phone || null, active: f.active };
  const title = { drivers: d ? d.name : tr('Ny sjåfør'), vehicles: v ? v.reg_no : tr('Ny bil'), customers: c ? c.name : tr('Ny kunde'), haulers: h ? h.name : tr('Nytt transportfirma') }[kind];
  return (
    <form onSubmit={e => { e.preventDefault(); save.mutate({ kind, id, body }, { onSuccess: onDone }); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 300 }}>{title}</h2>
      {kind === 'drivers' && <>
        {text('name', tr('Navn'))}
        {text('phone', tr('Telefon (brukes til innlogging)'), { inputMode: 'tel', placeholder: '+47 …' })}
        {haulerSelect}
        {text('pin', id ? tr('Ny PIN (4–6 siffer) – tom = behold') : tr('PIN (4–6 siffer)'), { inputMode: 'numeric', maxLength: 6 })}
        <span className="sub">{tr('Sjåføren logger inn på {url} med telefonnummer og PIN.', { url: `${location.origin}/sjafor` })}</span>
      </>}
      {kind === 'vehicles' && <>{text('reg_no', tr('Reg.nr.'))}{haulerSelect}{text('description', tr('Beskrivelse (valgfritt)'), { placeholder: tr('F.eks. Bil 2, Scania') })}{check('has_trailer', tr('Har henger'))}</>}
      {kind === 'customers' && <>{text('name', tr('Navn'))}{check('requires_project', tr('Krever prosjektnummer'))}{text('email', tr('E-post for følgeseddel (valgfritt)'), { type: 'email' })}{text('notes', tr('Merknad'))}</>}
      {kind === 'haulers' && <>{text('name', tr('Navn'))}{check('own', tr('Egne biler'))}{text('phone', tr('Telefon'))}</>}
      {id && check('active', tr('Aktiv'))}
      {save.isError && <div className="error-box">{errorText(save.error)}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-w" disabled={save.isPending}>{save.isPending ? tr('Lagrer …') : tr('Lagre')}</button>
        <button type="button" className="btn" onClick={onDone}>{tr('Avbryt')}</button>
      </div>
    </form>
  );
}

