import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { usePrefill } from '../lib/prefill.ts';
import type { OrderView, PortCallView } from '../../../shared/api.ts';
import { isoWeek } from '../../../shared/time.ts';
import { Plus } from '../components/Icons.tsx';
import { NewOrderDrawer, OrderPanel, OrderStatusBadge, SoNo } from '../components/Orders.tsx';
import { Page } from '../components/Topbar.tsx';
import { CallIssues, Loading, QuayMark, SearchBox, Segmented, StatusBadge } from '../components/ui.tsx';
import { addDays, dayHeading, dayShort, fr, goodsShort, timeRange, todayOslo, typeLabel } from '../lib/format.ts';
import { tr, tx } from '../lib/i18n.ts';
import { useOrders, usePortCalls } from '../lib/queries.ts';
import './anlop.css';

type Filter = 'idag' | 'uke' | 'kollisjon';
type View = 'anlop' | 'ordre';

/**
 * Anløp og salgsordre. SO-en (fra Dynamics 365) er det som er solgt; anløpet er båten som henter eller leverer.
 * «Båter» viser anløpene med SO-ene i lasterekkefølge; «Salgsordre» viser alle åpne SO-er, også de som venter på båt.
 */
export function AnlopPage() {
  const today = todayOslo();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const view: View = params.get('vis') === 'ordre' ? 'ordre' : 'anlop';
  const setView = (v: View) => setParams(p => { if (v === 'ordre') p.set('vis', 'ordre'); else p.delete('vis'); return p; }, { replace: true });
  // Med søk vises de neste 60 dagene, ellers en uke.
  const calls = usePortCalls(today, addDays(today, q.trim() ? 60 : 7));
  const orders = useOrders();
  const [filter, setFilter] = useState<Filter>('uke');
  const [showNew, setShowNew] = useState(false);
  const [prefill, clearPrefill] = usePrefill(['so', 'kunde', 'anlop']);
  useEffect(() => { if (prefill) { setShowNew(true); setParams(p => { p.set('vis', 'ordre'); p.delete('so'); return p; }, { replace: true }); } }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps
  // Fra det globale søket: /anlop?q=båtnavn, /anlop?so=2043644
  const urlQ = params.get('q');
  useEffect(() => { if (urlQ) { setQ(urlQ); setFilter('uke'); } }, [urlQ]);
  const soKey = params.get('so');
  const openSo = (key: string | null) => { setShowNew(false); setParams(p => { if (key) p.set('so', key); else p.delete('so'); return p; }, { replace: true }); };

  const list = calls.data?.calls ?? [];
  const needle = q.trim().toLowerCase();
  const matchCall = (c: PortCallView) => !needle || c.boat.name.toLowerCase().includes(needle)
    || c.orders.some(o => o.so_number.includes(needle) || o.customer.toLowerCase().includes(needle));
  // Ferdige anløp (kaibok levert) ligger i Kaibok, ikke her.
  const done = list.filter(c => c.status === 'ferdig').length;
  const visible = list.filter(c => c.status !== 'ferdig' && matchCall(c) &&
    (filter === 'uke' || (filter === 'idag' && c.service_date === today) || (filter === 'kollisjon' && c.collisions.length > 0)));
  const days = [...new Set(visible.map(c => c.service_date))].sort();
  const left = list.filter(c => c.service_date === today && c.status !== 'ferdig').length;
  const waiting = (orders.data ?? []).filter(o => o.status === 'venter' || o.status === 'delvis').length;

  return (
    <Page>
      <div style={{ flex: '999 1 760px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title">{tr('Anløp')}</h1>
            <span className="muted">
              Flatholmen · {tr('uke {n}', { n: isoWeek(today).week })} · {tr('{n} gjenstår i dag', { n: left })}
              {waiting > 0 && <> · <button type="button" onClick={() => setView('ordre')} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--warn-fg)', cursor: 'pointer' }}>{tr('{n} SO venter på båt', { n: waiting })}</button></>}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Segmented<View> label={tr('Visning')} value={view} onChange={setView} options={[{ value: 'anlop', label: tr('Båter') }, { value: 'ordre', label: tr('Salgsordre') }]} />
            {view === 'anlop' && (
              <Segmented<Filter> label={tr('Periode')} value={filter} onChange={setFilter}
                options={[{ value: 'idag', label: tr('I dag') }, { value: 'uke', label: tr('Neste 7 dager') }, { value: 'kollisjon', label: tr('Kollisjoner') }]} />
            )}
            <SearchBox value={q} onChange={setQ} placeholder={tr('Båt, SO eller kunde')} label={tr('Søk etter båt, SO-nummer eller kunde')} />
            <button type="button" className="btn btn-w" onClick={() => { openSo(null); setShowNew(true); }} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 46 }}>
              <Plus size={16} strokeWidth={2.2} />{tr('Ny SO')}
            </button>
          </div>
        </div>

        {view === 'ordre' ? (
          <OrderList orders={orders.data} loading={orders.isPending} needle={needle} selected={soKey} onOpen={openSo} />
        ) : (
          <>
            {calls.isPending && <Loading />}
            {/* Én boks per dag, som på Biler. Anløp uten klokkeslett står sist i dagen. */}
            {days.map(d => {
              const items = visible.filter(c => c.service_date === d)
                .sort((x, y) => Number(!x.time_known) - Number(!y.time_known) || x.eta.localeCompare(y.eta));
              const tonnes = items.reduce((t, c) => t + c.tonnes_in + c.tonnes_out, 0);
              return (
                <section key={d} aria-label={dayHeading(d, today)} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                    <span className="eyebrow">{dayHeading(d, today)}</span>
                    <span className="muted n" style={{ fontSize: 13 }}>{tr('{n} anløp', { n: items.length })} · {fr(tonnes)} t</span>
                  </div>
                  <div className="panel-light" style={{ overflowX: 'auto', overflowY: 'hidden' }}>
                    <div className="arow-list">
                      {items.map((c, i) => <Row key={c.id} call={c} first={i === 0} onSo={openSo} onOpen={() => nav(`/?id=${c.id}`)} />)}
                    </div>
                  </div>
                </section>
              );
            })}
            {calls.isSuccess && !days.length && <p className="empty">{needle ? tr('Ingen anløp matcher søket.') : tr('Ingen kommende anløp.')}</p>}
            {done > 0 && (
              <Link to="/kaibok" className="muted" style={{ fontSize: 13 }}>{tr('{n} ferdige anløp i perioden ligger i Kaibok →', { n: done })}</Link>
            )}
          </>
        )}
      </div>

      {soKey ? (
        <OrderPanel id={soKey} onClose={() => openSo(null)} onOpenCall={id => nav(`/?id=${id}`)} />
      ) : showNew && (
        <NewOrderDrawer key={prefill?.n} initialCall={prefill?.anlop} initialSo={prefill?.so} initialCustomer={prefill?.kunde} onClose={() => { setShowNew(false); clearPrefill(); }} onCreated={o => { setShowNew(false); openSo(o.so_number); }} />
      )}
    </Page>
  );
}

function Row({ call: c, first, onSo, onOpen }: { call: PortCallView; first: boolean; onSo: (so: string) => void; onOpen: () => void }) {
  return (
    <div className="arow arow-link" onClick={onOpen} style={{ cursor: 'pointer', borderTop: first ? 'none' : '1px solid rgba(var(--tint), .06)' }}>
      <span className="n" style={c.time_known ? { fontSize: 15 } : { fontSize: 13, color: 'var(--fg-45)' }}>{timeRange(c)}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <Link to={`/?id=${c.id}`} onClick={e => e.stopPropagation()} aria-label={`${c.boat.name}, ${timeRange(c)} – ${tr('åpne i kartet')}`}
          style={{ fontSize: 16, color: 'inherit', textDecoration: 'none' }}>{c.boat.name}</Link>
        <span style={{ fontSize: 13, color: 'var(--fg-55)', display: 'flex', gap: 6, alignItems: 'center' }}>
          {typeLabel(c.type)}<span aria-hidden="true">·</span><QuayMark quay={c.quay} compact />
        </span>
      </span>
      {/* SO-ene i lasterekkefølge. */}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        {c.orders.map(o => (
          <span key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 14, minWidth: 0 }}>
            {c.orders.length > 1 && <span className="n" style={{ fontSize: 11, color: 'var(--fg-45)', width: 12 }}>{o.load_seq}.</span>}
            <button type="button" onClick={e => { e.stopPropagation(); onSo(o.so_number); }}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--teal)', font: 'inherit', flex: 'none' }}><SoNo n={o.so_number} /></button>
            <span style={{ color: 'var(--fg-75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.customer} · {goodsShort(o.goods)}</span>
          </span>
        ))}
        {!c.orders.length && <span style={{ fontSize: 13, color: 'var(--fg-45)' }}>{tr('Ingen salgsordre ennå')}</span>}
      </span>
      <span style={{ fontSize: 14, color: 'var(--fg-75)' }}>
        {c.responsible && <>{c.responsible.short_name}<span style={{ color: 'var(--fg-45)' }}> · </span></>}
        <span style={{ color: c.responsible ? 'var(--fg-45)' : undefined }}>{c.crew.length === 1 ? tr('1 rolle') : tr('{n} roller', { n: c.crew.length })}</span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
        <StatusBadge status={c.status} basis={c.status_basis} />
        <CallIssues call={c} />
      </span>
    </div>
  );
}

/** Alle åpne SO-er: først de som venter på båt, så de som er på båt (etter dag), så nylig ferdige/kansellerte. */
function OrderList({ orders, loading, needle, selected, onOpen }: {
  orders: OrderView[] | undefined; loading: boolean; needle: string; selected: string | null; onOpen: (so: string) => void;
}) {
  const all = (orders ?? []).filter(o => !needle || o.so_number.includes(needle) || o.customer.toLowerCase().includes(needle)
    || o.calls.some(c => c.boat_name.toLowerCase().includes(needle)));
  const day = (o: OrderView) => o.calls[0]?.service_date ?? o.wanted_date ?? '9999';
  const groups: [string, OrderView[]][] = [
    [tr('Venter på båt'), all.filter(o => o.status === 'venter' || o.status === 'delvis')],
    [tr('På båt'), all.filter(o => o.status === 'planlagt').sort((a, b) => day(a).localeCompare(day(b)))],
    [tr('Ferdig eller kansellert siste 14 dager'), all.filter(o => o.status === 'ferdig' || o.status === 'kansellert')],
  ];
  if (loading) return <Loading />;
  if (!all.length) return <p className="empty">{needle ? tr('Ingen SO-er matcher søket.') : tr('Ingen åpne salgsordre.')}</p>;
  return (
    <>
      {groups.filter(([, l]) => l.length).map(([title, l]) => (
        <section key={title} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="eyebrow">{title} · {l.length}</span>
          <div className="panel-light" style={{ overflow: 'hidden' }}>
            {l.map((o, i) => (
              <button key={o.id} type="button" className="orow" onClick={() => onOpen(o.so_number)} aria-pressed={selected === o.so_number || selected === o.id}
                style={{ borderTop: i ? '1px solid rgba(var(--tint), .06)' : 'none', ...(selected === o.so_number ? { background: 'rgba(128,239,222,.12)' } : {}) }}>
                <SoNo n={o.so_number} style={{ fontSize: 15 }} />
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontSize: 15 }}>{o.customer}</span>
                  <span style={{ fontSize: 13, color: 'var(--fg-55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.lines.map(x => tx(x.label)).join(' · ')}</span>
                </span>
                <span style={{ fontSize: 14, color: 'var(--fg-75)' }}>
                  {o.calls.length
                    ? o.calls.map(c => <span key={c.id} style={{ display: 'block' }}>{c.boat_name} · {dayShort(c.service_date)} {c.time_known ? timeRange(c) : ''}</span>)
                    : <span style={{ color: 'var(--fg-55)' }}>{o.wanted_date ? tr('Ønsket {dag}', { dag: dayShort(o.wanted_date) }) : '–'}</span>}
                </span>
                <span className="n hide-s" style={{ fontSize: 14 }}>{fr(o.tonnes)} t</span>
                <OrderStatusBadge status={o.status} />
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
