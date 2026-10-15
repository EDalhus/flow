import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { BoatDetail, ExternalVessel, SearchResult } from '../../../shared/api.ts';
import { api, errorText } from '../lib/api.ts';
import { FLAG_STYLE, STATUS_STYLE, addDays, dayRelative, fr, osloTime, telHref, titleCase, todayOslo } from '../lib/format.ts';
import { useMe } from '../lib/queries.ts';
import { canBoats } from '../lib/roles.ts';
import { ArrowLeft, Close, Search } from './Icons.tsx';

// Søk øverst på alle sider: sider, båter, anløp, biler, bulkbiler, folk – og fartøy fra AIS
// (Kystverket via BarentsWatch), også båter som ikke er i båtregisteret.

const PAGES = [
  { label: 'Kart', to: '/' }, { label: 'Anløp', to: '/anlop' }, { label: 'Kaibok', to: '/kaibok' }, { label: 'Båtregister', to: '/baater' },
  { label: 'Biler', to: '/biler' }, { label: 'Bulkbil', to: '/bulk' }, { label: 'Produksjon', to: '/produksjon' },
  { label: 'Hjullasterskjerm', to: '/hjullaster' }, { label: 'Rapporter', to: '/rapporter' }, { label: 'Admin', to: '/admin' },
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
  const pages = needle ? PAGES.filter(p => p.label.toLowerCase().includes(needle)) : [];
  const d = term.length >= 2 ? res.data : undefined;
  const count = pages.length + (d ? d.boats.length + d.calls.length + d.trucks.length + d.bulk.length + d.users.length + d.vessels.length : 0);

  return (
    <div ref={box} style={{ position: 'relative', width: 'min(460px, 100%)' }}>
      <label className="pill gsearch" style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 46, padding: '0 16px', backdropFilter: 'blur(16px)', background: 'rgba(32,42,36,.7)' }}>
        <Search size={16} />
        <span className="sr">Søk i Flow og AIS</span>
        <input ref={input} type="text" role="searchbox" autoComplete="off" value={q} placeholder="Søk båt, anløp, kunde, person – eller fartøy i AIS"
          onChange={e => { setQ(e.target.value); setOpen(true); setVessel(null); }} onFocus={() => setOpen(true)}
          onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); input.current?.blur(); } }}
          style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', color: 'var(--fg)', fontSize: 14, outline: 'none' }} />
        {q && <button type="button" className="icon-btn" aria-label="Tøm søket" onClick={() => { setQ(''); setVessel(null); input.current?.focus(); }} style={{ width: 28, height: 28 }}><Close size={13} /></button>}
      </label>

      {open && needle.length >= 1 && (
        <div className="glass scroll" role="dialog" aria-label="Søkeresultater"
          style={{ position: 'absolute', top: 54, left: 0, right: 0, maxHeight: 'min(640px, calc(100vh - 120px))', padding: 10, zIndex: 40, background: 'rgba(32,42,36,.95)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {vessel ? <VesselCard v={vessel} onBack={() => setVessel(null)} go={go} /> : (
            <>
              {pages.length > 0 && <Group title="Sider">{pages.map(p => <Item key={p.to} title={p.label} onClick={() => go(p.to)} />)}</Group>}
              {d && d.boats.length > 0 && (
                <Group title="Båtregisteret">
                  {d.boats.map(b => <Item key={b.id} title={b.name} sub={[b.mmsi && `MMSI ${b.mmsi}`, b.flag !== 'none' && b.flag !== 'green' && FLAG_STYLE[b.flag].label].filter(Boolean).join(' · ')} onClick={() => go(`/baater?id=${b.id}`)} />)}
                </Group>
              )}
              {d && d.calls.length > 0 && (
                <Group title="Anløp">
                  {d.calls.map(c => (
                    <Item key={c.id} title={c.boat_name} onClick={() => go(c.service_date === today || c.service_date === addDays(today, 1) ? `/?id=${c.id}` : `/anlop?q=${encodeURIComponent(c.boat_name)}`)}
                      sub={`${dayRelative(c.service_date)}${c.time_known ? ` ${osloTime(c.eta)}` : ''} · ${c.type === 'levering' ? 'Levering' : 'Henting'} · ${STATUS_STYLE[c.status].label}`} />
                  ))}
                </Group>
              )}
              {d && d.trucks.length > 0 && (
                <Group title="Biler">
                  {d.trucks.map(t => <Item key={t.id} title={t.customer} sub={`${dayRelative(t.expected_date)}${t.reg_no ? ` · ${t.reg_no}` : ''}${t.picked_up ? ' · hentet' : ''}`} onClick={() => go('/biler')} />)}
                </Group>
              )}
              {d && d.bulk.length > 0 && (
                <Group title="Bulkbil">
                  {d.bulk.map(b => <Item key={b.id} title={b.truck} sub={[b.destination, b.status].filter(Boolean).join(' · ')} onClick={() => go('/bulk')} />)}
                </Group>
              )}
              {d && d.users.length > 0 && (
                <Group title="Folk">
                  {d.users.map(u => <Item key={u.id} title={u.name} sub={[u.title, u.phone].filter(Boolean).join(' · ')} onClick={() => { if (u.phone) location.href = telHref(u.phone); }} />)}
                </Group>
              )}
              {d && d.vessels.length > 0 && (
                <Group title="Fartøy i AIS (Kystverket)">
                  {d.vessels.map(v => (
                    <Item key={v.mmsi} title={v.name ?? `MMSI ${v.mmsi}`} onClick={() => setVessel(v)}
                      sub={[v.ship_type, v.length && `${fr(v.length, 0)} m`, `MMSI ${v.mmsi}`, v.boat_id ? 'i båtregisteret' : 'ikke i båtregisteret'].filter(Boolean).join(' · ')} />
                  ))}
                </Group>
              )}
              {term.length >= 2 && res.isFetching && !d && <p className="sub" style={{ margin: 8 }}>Søker …</p>}
              {d && !count && <p className="sub" style={{ margin: 8 }}>Ingen treff på «{d.q}».</p>}
              {d?.ais_error && term.length >= 3 && <p className="sub" style={{ margin: '4px 8px', fontSize: 12 }}>AIS: {d.ais_error}</p>}
              {needle.length < 2 && !pages.length && <p className="sub" style={{ margin: 8 }}>Skriv minst to tegn.</p>}
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
    ['Type', v.ship_type], ['MMSI', v.mmsi], ['IMO', v.imo], ['Kallesignal', v.callsign],
    ['Størrelse', v.length ? `${fr(v.length, 0)} × ${v.width ? fr(v.width, 0) : '–'} m` : null],
    ['Dypgang', v.draught ? `${fr(v.draught)} m` : null], ['Destinasjon', v.destination], ['Land', v.country],
    ['Fart', v.sog != null ? `${fr(v.sog)} knop` : null],
    ['Sist sett', v.seen_at ? `${dayRelative(v.seen_at.slice(0, 10))} ${osloTime(v.seen_at)}` : null],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="icon-btn pill" aria-label="Tilbake til treffene" onClick={onBack} style={{ width: 36, height: 36 }}><ArrowLeft size={15} /></button>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 20 }}>{v.name ? titleCase(v.name) : `MMSI ${v.mmsi}`}</span>
          <span className="sub">{v.boat_id ? 'I båtregisteret' : 'Ikke i båtregisteret'} · AIS fra Kystverket</span>
        </div>
      </div>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 14 }}>
        {rows.filter(([, val]) => val).map(([k, val]) => (
          <div key={k} style={{ display: 'contents' }}><dt className="sub">{k}</dt><dd className="n" style={{ margin: 0 }}>{val}</dd></div>
        ))}
      </dl>
      {!hasPos && <span className="sub">Ingen posisjon – båten er utenfor området BarentsWatch dekker.</span>}
      {error && <div className="error-box">{error}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {hasPos && (
          <button type="button" className="btn btn-w" style={{ minHeight: 40 }}
            onClick={() => go(`/?lat=${v.lat}&lon=${v.lon}&mmsi=${v.mmsi}&name=${encodeURIComponent(v.name ? titleCase(v.name) : '')}`)}>
            Vis i kartet
          </button>
        )}
        {v.boat_id
          ? <button type="button" className="btn" style={{ minHeight: 40 }} onClick={() => go(`/baater?id=${v.boat_id}`)}>Åpne i båtregisteret</button>
          : canBoats(me.data) && <button type="button" className="btn" style={{ minHeight: 40 }} disabled={busy} onClick={add}>Legg til i båtregisteret</button>}
      </div>
    </div>
  );
}

