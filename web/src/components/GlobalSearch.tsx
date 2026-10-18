import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { BoatDetail, ExternalVessel, SearchResult } from '../../../shared/api.ts';
import { api, errorText } from '../lib/api.ts';
import { FLAG_STYLE, STATUS_STYLE, addDays, dayRelative, fr, osloTime, telHref, titleCase, todayOslo, typeLabel } from '../lib/format.ts';
import { tr, tx } from '../lib/i18n.ts';
import { useMe } from '../lib/queries.ts';
import { canBoats } from '../lib/roles.ts';
import { ArrowLeft, Close, Search } from './Icons.tsx';

// Søk øverst på alle sider: sider, båter, anløp, biler, bulkbiler, folk – og fartøy fra AIS
// (Kystverket via BarentsWatch), også båter som ikke er i båtregisteret.

/** Bulkbil-status (norsk; vises med tr()). */
export const BULK_STATUS: Record<string, string> = { bestilt: 'Bestilt', lastes: 'Lastes', ferdig: 'Ferdig', avlyst: 'Fjernet' };

const ORDER_STATUS: Record<string, string> = { venter: 'Venter på båt', planlagt: 'På båt', delvis: 'Delvis på båt', ferdig: 'Ferdig', kansellert: 'Kansellert' };

const PAGES = [
  { label: 'Kart', to: '/' }, { label: 'Anløp', to: '/anlop' }, { label: 'Kaibok', to: '/kaibok' }, { label: 'Salgsordre', to: '/anlop?vis=ordre' }, { label: 'Båtregister', to: '/baater' },
  { label: 'Biler', to: '/biler' }, { label: 'Bulkbil', to: '/bulk' }, { label: 'Produksjon', to: '/produksjon' },
  { label: 'Hjullasterskjerm', to: '/hjullaster' }, { label: 'Rapporter', to: '/rapporter' }, { label: 'Innstillinger', to: '/innstillinger' }, { label: 'Preferanser', to: '/innstillinger' },
];

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function GlobalSearch() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [vessel, setVessel] = useState<ExternalVessel | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const term = useDebounced(q.trim(), 250);
  const res = useQuery({
    queryKey: ['search', term],
    queryFn: () => api<SearchResult>(`/search?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  // Klikk utenfor eller Esc lukker; «/» eller Ctrl/Cmd+K hopper til søket.
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select');
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); input.current?.focus(); setOpen(true); }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, []);

  const go = (to: string) => { setOpen(false); setVessel(null); setQ(''); nav(to); };
  const today = todayOslo();
  const needle = q.trim().toLowerCase();
  const pages = needle ? PAGES.filter(p => p.label.toLowerCase().includes(needle) || tr(p.label).toLowerCase().includes(needle)) : [];
  const d = term.length >= 2 ? res.data : undefined;
  const count = pages.length + (d ? d.orders.length + d.boats.length + d.calls.length + d.trucks.length + d.bulk.length + d.users.length + d.vessels.length : 0);

  return (
    <div ref={box} style={{ position: 'relative', width: 'min(460px, 100%)' }}>
      <label className="pill gsearch" style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 46, padding: '0 16px', backdropFilter: 'blur(16px)', background: 'rgba(var(--glass-rgb), .7)' }}>
        <Search size={16} />
        <span className="sr">{tr('Søk i Flow og AIS')}</span>
        <input ref={input} type="text" role="searchbox" autoComplete="off" value={q} placeholder={tr('Søk båt, anløp, kunde, person – eller fartøy i AIS')}
          onChange={e => { setQ(e.target.value); setOpen(true); setVessel(null); }} onFocus={() => setOpen(true)}
          onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); input.current?.blur(); } }}
          style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', color: 'var(--fg)', fontSize: 14, outline: 'none' }} />
        {q && <button type="button" className="icon-btn" aria-label={tr('Tøm søket')} onClick={() => { setQ(''); setVessel(null); input.current?.focus(); }} style={{ width: 28, height: 28 }}><Close size={13} /></button>}
      </label>

      {open && needle.length >= 1 && (
        <div className="glass scroll" role="dialog" aria-label={tr('Søkeresultater')}
          style={{ position: 'absolute', top: 54, left: 0, right: 0, maxHeight: 'min(640px, calc(100vh - 120px))', padding: 10, zIndex: 40, background: 'rgba(var(--glass-rgb), .95)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {vessel ? <VesselCard v={vessel} onBack={() => setVessel(null)} go={go} /> : (
            <>
              {pages.length > 0 && <Group title={tr('Sider')}>{pages.map(p => <Item key={p.label} title={tr(p.label)} onClick={() => go(p.to)} />)}</Group>}
              {d && d.boats.length > 0 && (
                <Group title={tr('Båtregisteret')}>
                  {d.boats.map(b => <Item key={b.id} title={b.name} sub={[b.mmsi && `MMSI ${b.mmsi}`, b.flag !== 'none' && b.flag !== 'green' && FLAG_STYLE[b.flag].label].filter(Boolean).join(' · ')} onClick={() => go(`/baater?id=${b.id}`)} />)}
                </Group>
              )}
              {d && d.orders.length > 0 && (
                <Group title={tr('Salgsordre')}>
                  {d.orders.map(o => (
                    <Item key={o.id} title={`SO ${o.so_number} · ${o.customer}`} onClick={() => go(`/anlop?so=${o.so_number}`)}
                      sub={[o.boat_name ?? tr('Venter på båt'), o.service_date && dayRelative(o.service_date), tr(ORDER_STATUS[o.status])].filter(Boolean).join(' · ')} />
                  ))}
                </Group>
              )}
              {d && d.calls.length > 0 && (
                <Group title={tr('Anløp')}>
                  {d.calls.map(c => (
                    <Item key={c.id} title={c.boat_name} onClick={() => go(c.service_date === today || c.service_date === addDays(today, 1) ? `/?id=${c.id}` : `/anlop?q=${encodeURIComponent(c.boat_name)}`)}
                      sub={`${dayRelative(c.service_date)}${c.time_known ? ` ${osloTime(c.eta)}` : ''} · ${typeLabel(c.type)} · ${STATUS_STYLE[c.status].label}`} />
                  ))}
                </Group>
              )}
              {d && d.trucks.length > 0 && (
                <Group title={tr('Biler')}>
                  {d.trucks.map(t => <Item key={t.id} title={t.customer} sub={`${dayRelative(t.expected_date)}${t.reg_no ? ` · ${t.reg_no}` : ''}${t.picked_up ? ` · ${tr('hentet')}` : ''}`} onClick={() => go('/biler')} />)}
                </Group>
              )}
              {d && d.bulk.length > 0 && (
                <Group title={tr('Bulkbil')}>
                  {d.bulk.map(b => <Item key={b.id} title={b.truck} sub={[b.destination, tr(BULK_STATUS[b.status] ?? b.status)].filter(Boolean).join(' · ')} onClick={() => go('/bulk')} />)}
                </Group>
              )}
              {d && d.users.length > 0 && (
                <Group title={tr('Folk')}>
                  {d.users.map(u => <Item key={u.id} title={u.name} sub={[u.title, u.phone].filter(Boolean).join(' · ')} onClick={() => { if (u.phone) location.href = telHref(u.phone); }} />)}
                </Group>
              )}
              {d && d.vessels.length > 0 && (
                <Group title={tr('Fartøy i AIS (Kystverket)')}>
                  {d.vessels.map(v => (
                    <Item key={v.mmsi} title={v.name ?? `MMSI ${v.mmsi}`} onClick={() => setVessel(v)}
                      sub={[tx(v.ship_type), v.length && `${fr(v.length, 0)} m`, `MMSI ${v.mmsi}`, v.boat_id ? tr('i båtregisteret') : tr('ikke i båtregisteret')].filter(Boolean).join(' · ')} />
                  ))}
                </Group>
              )}
              {term.length >= 2 && res.isFetching && !d && <p className="sub" style={{ margin: 8 }}>{tr('Søker …')}</p>}
              {d && !count && <p className="sub" style={{ margin: 8 }}>{tr('Ingen treff på «{q}».', { q: d.q })}</p>}
              {d?.ais_error && term.length >= 3 && <p className="sub" style={{ margin: '4px 8px', fontSize: 12 }}>AIS: {tx(d.ais_error)}</p>}
              {needle.length < 2 && !pages.length && <p className="sub" style={{ margin: 8 }}>{tr('Skriv minst to tegn.')}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <section style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6 }}>
    <span className="eyebrow" style={{ fontSize: 11, padding: '6px 10px 2px' }}>{title}</span>
    {children}
  </section>
);

const Item = ({ title, sub, onClick }: { title: string; sub?: string; onClick: () => void }) => (
  <button type="button" className="search-item" onClick={onClick}>
    <span style={{ fontSize: 15 }}>{title}</span>
    {sub && <span style={{ fontSize: 12, color: 'var(--fg-62)' }}>{sub}</span>}
  </button>
);

/** Fartøy fra AIS: skipsdata, siste posisjon, legg til i båtregisteret og vis i kartet. */
function VesselCard({ v, onBack, go }: { v: ExternalVessel; onBack: () => void; go: (to: string) => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasPos = v.lat != null && v.lon != null;
  const add = async () => {
    setBusy(true); setError(null);
    try {
      const b = await api<BoatDetail>('/boats', { body: { name: titleCase(v.name ?? `MMSI ${v.mmsi}`), mmsi: v.mmsi, imo: v.imo && /^\d{7}$/.test(v.imo) ? v.imo : null, callsign: v.callsign } });
      qc.invalidateQueries({ queryKey: ['boats'] });
      qc.invalidateQueries({ queryKey: ['search'] });
      go(`/baater?id=${b.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const rows: [string, string | null][] = [
    [tr('Type'), tx(v.ship_type) || null], ['MMSI', v.mmsi], ['IMO', v.imo], [tr('Kallesignal'), v.callsign],
    [tr('Størrelse'), v.length ? `${fr(v.length, 0)} × ${v.width ? fr(v.width, 0) : '–'} m` : null],
    [tr('Dypgang'), v.draught ? `${fr(v.draught)} m` : null], [tr('Destinasjon'), v.destination], [tr('Land'), v.country],
    [tr('Fart'), v.sog != null ? tr('{n} knop', { n: fr(v.sog) }) : null],
    [tr('Sist sett'), v.seen_at ? `${dayRelative(v.seen_at.slice(0, 10))} ${osloTime(v.seen_at)}` : null],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="icon-btn pill" aria-label={tr('Tilbake til treffene')} onClick={onBack} style={{ width: 36, height: 36 }}><ArrowLeft size={15} /></button>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 20 }}>{v.name ? titleCase(v.name) : `MMSI ${v.mmsi}`}</span>
          <span className="sub">{v.boat_id ? tr('I båtregisteret') : tr('Ikke i båtregisteret')} · {tr('AIS fra Kystverket')}</span>
        </div>
      </div>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 14 }}>
        {rows.filter(([, val]) => val).map(([k, val]) => (
          <div key={k} style={{ display: 'contents' }}><dt className="sub">{k}</dt><dd className="n" style={{ margin: 0 }}>{val}</dd></div>
        ))}
      </dl>
      {!hasPos && <span className="sub">{tr('Ingen posisjon – båten er utenfor området BarentsWatch dekker.')}</span>}
      {error && <div className="error-box">{error}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {hasPos && (
          <button type="button" className="btn btn-w" style={{ minHeight: 40 }}
            onClick={() => go(`/?lat=${v.lat}&lon=${v.lon}&mmsi=${v.mmsi}&name=${encodeURIComponent(v.name ? titleCase(v.name) : '')}`)}>
            {tr('Vis i kartet')}
          </button>
        )}
        {v.boat_id
          ? <button type="button" className="btn" style={{ minHeight: 40 }} onClick={() => go(`/baater?id=${v.boat_id}`)}>{tr('Åpne i båtregisteret')}</button>
          : canBoats(me.data) && <button type="button" className="btn" style={{ minHeight: 40 }} disabled={busy} onClick={add}>{tr('Legg til i båtregisteret')}</button>}
      </div>
    </div>
  );
}

