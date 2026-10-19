import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { AskAnswer, BoatDetail, ExternalVessel, SearchBulk, SearchResult } from '../../../shared/api.ts';
import { looksLikeQuestion, parseActions, parseDay, parseScope, type SearchAction } from '../../../shared/domain/search.ts';
import { api, errorText } from '../lib/api.ts';
import { FLAG_STYLE, STATUS_STYLE, addDays, dayRelative, ddmm, fr, osloTime, telHref, titleCase, todayOslo, typeLabel } from '../lib/format.ts';
import { getLang, tr, tx } from '../lib/i18n.ts';
import { useMe } from '../lib/queries.ts';
import { canBoats } from '../lib/roles.ts';
import { Markdown } from './Markdown.tsx';
import { ArrowLeft, Close, Message, Phone, Search, Sparkle, StarLine } from './Icons.tsx';

// Søk øverst på alle sider: sider, båter, anløp, salgsordre, biler, bulk, folk og fartøy fra AIS (Kystverket via BarentsWatch).
// I tillegg: handlinger («ny bulk SU 20 110»), datoer («fredag», «uke 43»), prefiks («båt: …»), festede og nylige treff,
// tastaturstyring (piltaster + Enter) og «Spør Flow» – spørsmål med vanlige ord som Claude svarer på med tall fra Flow.

/** Bulkbil-status (norsk; vises med tr()). */
export const BULK_STATUS: Record<string, string> = { bestilt: 'Bestilt', lastes: 'Lastes', ferdig: 'Ferdig', avlyst: 'Fjernet' };

const ORDER_STATUS: Record<string, string> = { venter: 'Venter på båt', planlagt: 'På båt', delvis: 'Delvis på båt', ferdig: 'Ferdig', kansellert: 'Kansellert' };

const PAGES = [
  { label: 'Kart', to: '/' }, { label: 'Anløp', to: '/anlop' }, { label: 'Kaibok', to: '/kaibok' }, { label: 'Salgsordre', to: '/anlop?vis=ordre' }, { label: 'Båtregister', to: '/baater' },
  { label: 'Biler', to: '/biler' }, { label: 'Bulkbil', to: '/bulk' }, { label: 'Produksjon', to: '/produksjon' },
  { label: 'Hjullasterskjerm', to: '/hjullaster' }, { label: 'Rapporter', to: '/rapporter' }, { label: 'Innstillinger', to: '/innstillinger' }, { label: 'Preferanser', to: '/innstillinger' },
];

const ACTION_LABEL: Record<SearchAction['kind'], string> = { bulk: 'Ny bulklasting', bil: 'Ny bilhenting', so: 'Ny salgsordre', bat: 'Ny båt' };

/** Hvor en handling fører, med det som er skrevet etter «ny …» fylt inn. */
function actionTarget(a: SearchAction): string {
  const p = new URLSearchParams({ ny: '1' });
  const so = /\b20\d{5}\b/.exec(a.text)?.[0];
  const rest = a.text.replace(/\b20\d{5}\b/, '').trim();
  if (a.kind === 'bulk') { if (a.text) p.set('bil', a.text); return `/bulk?${p}`; }
  if (a.kind === 'bil') {
    const reg = /\b[a-zæøå]{2}\s?\d{2}\s?\d{3,4}\b/i.exec(rest)?.[0];
    if (so) p.set('so', so);
    if (reg) p.set('reg', reg.toUpperCase());
    const kunde = (reg ? rest.replace(reg, '') : rest).trim();
    if (kunde) p.set('kunde', kunde);
    return `/biler?${p}`;
  }
  if (a.kind === 'so') { if (so) p.set('so', so); if (rest) p.set('kunde', rest); return `/anlop?vis=ordre&${p}`; }
  if (/^\d{9}$/.test(a.text)) p.set('mmsi', a.text); else if (a.text) p.set('navn', a.text);
  return `/baater?${p}`;
}

// ---------------------------------------------------------------- festet og nylig (i nettleseren)

type Saved = { key: string; title: string; sub?: string; to: string };
const PINS = 'flow-sok-festet', RECENT = 'flow-sok-nylig';
const readList = (k: string): Saved[] => { try { return JSON.parse(localStorage.getItem(k) ?? '[]'); } catch { return []; } };
const writeList = (k: string, l: Saved[]) => { try { localStorage.setItem(k, JSON.stringify(l)); } catch { /* ignorer */ } };

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Ett treff i lista. `to` = lenke i Flow (kan festes og huskes), ellers `run`. */
interface Entry { key: string; title: string; sub?: string; to?: string; run?: () => void; phone?: string | null; icon?: ReactNode; strong?: boolean }
interface Section { title: string; entries: Entry[] }

export function GlobalSearch() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [vessel, setVessel] = useState<ExternalVessel | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [pins, setPins] = useState<Saved[]>(() => readList(PINS));
  const [recent, setRecent] = useState<Saved[]>(() => readList(RECENT));
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const term = useDebounced(q.trim(), 250);
  const res = useQuery({
    queryKey: ['search', term],
    queryFn: () => api<SearchResult>(`/search?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2 && !looksLikeQuestion(term),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  // Klikk utenfor lukker; «/» eller Ctrl/Cmd+K hopper til søket.
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select');
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); input.current?.focus(); input.current?.select(); setOpen(true); }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, []);

  const reset = () => { setOpen(false); setVessel(null); setAsking(null); setQ(''); input.current?.blur(); };
  const remember = (e: Entry) => {
    if (!e.to) return;
    const next = [{ key: e.key, title: e.title, sub: e.sub, to: e.to }, ...recent.filter(r => r.key !== e.key)].slice(0, 8);
    setRecent(next); writeList(RECENT, next);
  };
  const choose = (e: Entry) => {
    if (e.run) { e.run(); return; }
    if (!e.to) return;
    remember(e);
    reset();
    nav(e.to);
  };
  const togglePin = (e: Entry) => {
    if (!e.to) return;
    const next = pins.some(p => p.key === e.key) ? pins.filter(p => p.key !== e.key) : [...pins, { key: e.key, title: e.title, sub: e.sub, to: e.to }];
    setPins(next); writeList(PINS, next);
  };

  const today = todayOslo();
  const raw = q.trim();
  const { scope, q: needleRaw } = parseScope(raw);
  const needle = needleRaw.toLowerCase();
  const question = looksLikeQuestion(raw);
  const d = term.length >= 2 && !question ? res.data : undefined;
  const ask = (text: string) => { setAsking(text); setVessel(null); };

  // ---------------------------------------------------------------- treffene, i rekkefølge
  const sections: Section[] = [];
  const add = (title: string, entries: Entry[]) => { if (entries.length) sections.push({ title, entries }); };
  const askEntry = (text: string): Entry => ({ key: `ask:${text}`, title: tr('Spør Flow: «{q}»', { q: text }), sub: tr('Svar med tall fra Flow (Claude)'), run: () => ask(text), icon: <Sparkle size={16} />, strong: true });
  const callEntry = (c: SearchResult['calls'][number]): Entry => ({
    key: `call:${c.id}`, title: c.boat_name, to: c.service_date === today || c.service_date === addDays(today, 1) ? `/?id=${c.id}` : `/anlop?q=${encodeURIComponent(c.boat_name)}`,
    sub: `${dayRelative(c.service_date)}${c.time_known ? ` ${osloTime(c.eta)}` : ''} · ${typeLabel(c.type)} · ${STATUS_STYLE[c.status].label}`,
  });
  const truckEntry = (t: SearchResult['trucks'][number]): Entry => ({
    key: `truck:${t.id}`, title: `SO ${t.so_number} · ${t.customer}`, to: '/biler',
    sub: `${dayRelative(t.expected_date)}${t.reg_no ? ` · ${t.reg_no}` : ''}${t.picked_up ? ` · ${tr('hentet')}` : ''}`,
  });
  const bulkEntry = (b: SearchBulk): Entry => b.status === 'ferdig' && b.delivery_no ? {
    key: `bulk:${b.id}`, title: tr('Følgeseddel nr. {n}', { n: b.delivery_no }), run: () => { window.open(`/api/bulk/orders/${b.id}/pdf`, '_blank'); },
    sub: [b.truck, b.destination, b.project_no, dayRelative(b.at.slice(0, 10))].filter(Boolean).join(' · '),
  } : {
    key: `bulk:${b.id}`, title: b.truck, to: '/bulk', sub: [b.destination, b.project_no, tr(BULK_STATUS[b.status] ?? b.status)].filter(Boolean).join(' · '),
  };

  if (!raw) {
    add(tr('Festet'), pins.map(p => ({ ...p })));
    add(tr('Nylig'), recent.filter(r => !pins.some(p => p.key === r.key)).map(r => ({ ...r })));
  } else {
    if (question) add(tr('Spør Flow'), [askEntry(raw)]);
    add(tr('Handlinger'), parseActions(raw).map(a => ({
      key: `act:${a.kind}`, title: a.text ? `${tr(ACTION_LABEL[a.kind])}: ${a.text}` : tr(ACTION_LABEL[a.kind]), to: actionTarget(a), icon: <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>,
    })));
    if (d?.agenda) {
      const a = d.agenda;
      const title = a.from === a.to ? dayRelative(a.from) : `${ddmm(a.from)}–${ddmm(a.to)}`;
      add(title, [
        ...a.calls.map(callEntry), ...a.trucks.map(truckEntry), ...a.bulk.map(bulkEntry),
        ...(!a.calls.length && !a.trucks.length && !a.bulk.length ? [{ key: 'agenda-empty', title: tr('Ingen anløp, bilhentinger eller bulk denne dagen.'), run: () => {} }] : []),
      ]);
    }
    if (!scope) add(tr('Sider'), PAGES.filter(p => needle && (p.label.toLowerCase().includes(needle) || tr(p.label).toLowerCase().includes(needle))).map(p => ({ key: `page:${p.to}:${p.label}`, title: tr(p.label), to: p.to })));
    if (d) {
      add(tr('Biler i bulkregisteret'), d.vehicles.map(v => ({
        key: `veh:${v.id}`, title: `${v.reg_no}${v.description ? ` · ${v.description}` : ''}`, to: '/bulk?vis=veiinger',
        sub: [v.hauler, tr('{n} lastinger i dag', { n: v.today }), tr('{n} totalt', { n: v.total }), v.last_at && tr('sist {dato}', { dato: ddmm(v.last_at) })].filter(Boolean).join(' · '),
      })));
      add(tr('Prosjekter'), d.projects.map(p => ({
        key: `proj:${p.project_no}`, title: tr('Prosjekt {nr}', { nr: p.project_no }), to: '/bulk?vis=rapport&per=prosjekt',
        sub: [p.customer, tr('{n} leveranser', { n: p.loads }), `${fr(p.tonnes)} t`].filter(Boolean).join(' · '),
      })));
      add(tr('Båtregisteret'), d.boats.map(b => ({
        key: `boat:${b.id}`, title: b.name, to: `/baater?id=${b.id}`,
        sub: [b.mmsi && `MMSI ${b.mmsi}`, b.flag !== 'none' && b.flag !== 'green' && FLAG_STYLE[b.flag].label].filter(Boolean).join(' · '),
      })));
      add(tr('Salgsordre'), d.orders.map(o => ({
        key: `so:${o.so_number}`, title: `SO ${o.so_number} · ${o.customer}`, to: `/anlop?so=${o.so_number}`,
        sub: [o.boat_name ?? tr('Venter på båt'), o.service_date && dayRelative(o.service_date), tr(ORDER_STATUS[o.status])].filter(Boolean).join(' · '),
      })));
      add(tr('Anløp'), d.calls.map(callEntry));
      add(tr('Biler'), d.trucks.map(truckEntry));
      add(tr('Bulkbil'), d.bulk.map(bulkEntry));
      add(tr('Folk'), [
        ...d.users.map(u => ({ key: `user:${u.id}`, title: u.name, sub: [u.title, u.phone].filter(Boolean).join(' · '), phone: u.phone, run: () => { if (u.phone) location.href = telHref(u.phone); } })),
        ...d.drivers.map(x => ({ key: `drv:${x.id}`, title: x.name, sub: `${tr('Sjåfør')} · ${x.hauler} · +${x.phone}`, phone: `+${x.phone}`, run: () => { location.href = telHref(`+${x.phone}`); } })),
        ...d.agents.map(x => ({ key: `agent:${x.id}`, title: x.name, sub: [tr('Agent'), x.phone].filter(Boolean).join(' · '), phone: x.phone, run: () => { if (x.phone) location.href = telHref(x.phone); } })),
      ]);
      add(tr('Fartøy i AIS (Kystverket)'), d.vessels.map(v => ({
        key: `ais:${v.mmsi}`, title: v.name ?? `MMSI ${v.mmsi}`, run: () => setVessel(v),
        sub: [tx(v.ship_type), v.length && `${fr(v.length, 0)} m`, `MMSI ${v.mmsi}`, v.boat_id ? tr('i båtregisteret') : tr('ikke i båtregisteret')].filter(Boolean).join(' · '),
      })));
    }
    // Alt som ikke er et kort oppslag kan sendes til «Spør Flow».
    if (!question && !scope && !parseDay(raw, today) && !parseActions(raw).length && raw.length >= 8 && raw.split(/\s+/).length >= 2) add(tr('Spør Flow'), [askEntry(raw)]);
  }
  const flat = sections.flatMap(s => s.entries);
  const count = flat.filter(e => !e.key.startsWith('ask:') && !e.key.startsWith('act:') && e.key !== 'agenda-empty').length;
  useEffect(() => { setActive(0); }, [raw, d]);
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { if (asking || vessel) { setAsking(null); setVessel(null); } else { setOpen(false); input.current?.blur(); } return; }
    if (asking || vessel || !flat.length) { if (e.key === 'Enter' && question && !asking) ask(raw); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => (a + 1) % flat.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + flat.length) % flat.length); }
    else if (e.key === 'Enter') { e.preventDefault(); const x = flat[Math.min(active, flat.length - 1)]; if (x) choose(x); }
  };

  let i = -1;
  return (
    <div ref={box} style={{ position: 'relative', width: 'min(460px, 100%)' }}>
      <label className="pill gsearch" style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 46, padding: '0 16px', backdropFilter: 'blur(16px)', background: 'rgba(var(--glass-rgb), .7)' }}>
        <Search size={16} />
        <span className="sr">{tr('Søk i Flow og AIS')}</span>
        <input ref={input} type="text" role="combobox" aria-expanded={open} aria-controls="gsearch-list" aria-autocomplete="list" autoComplete="off" value={q}
          placeholder={tr('Søk, skriv «ny …», en dato – eller spør Flow')}
          onChange={e => { setQ(e.target.value); setOpen(true); setVessel(null); setAsking(null); }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
          style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', color: 'var(--fg)', fontSize: 14, outline: 'none' }} />
        {q ? <button type="button" className="icon-btn" aria-label={tr('Tøm søket')} onClick={() => { setQ(''); setVessel(null); setAsking(null); input.current?.focus(); }} style={{ width: 28, height: 28 }}><Close size={13} /></button>
          : <kbd className="sub" style={{ fontSize: 11, border: '1px solid var(--line)', borderRadius: 6, padding: '1px 6px' }}>{navigator.platform.startsWith('Mac') ? '⌘K' : 'Ctrl K'}</kbd>}
      </label>

      {open && (
        <div ref={list} id="gsearch-list" className="glass scroll" role="listbox" aria-label={tr('Søkeresultater')}
          style={{ position: 'absolute', top: 54, left: 0, right: 0, maxHeight: 'min(640px, calc(100vh - 120px))', padding: 10, zIndex: 40, background: 'rgba(var(--glass-rgb), .95)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {asking ? <AskPanel question={asking} onBack={() => setAsking(null)} go={to => { reset(); nav(to); }} />
            : vessel ? <VesselCard v={vessel} onBack={() => setVessel(null)} go={to => { reset(); nav(to); }} /> : (
            <>
              {sections.map(s => (
                <Group key={s.title} title={s.title}>
                  {s.entries.map(e => {
                    i++;
                    const idx = i;
                    return <Item key={e.key} e={e} active={idx === active} pinned={pins.some(p => p.key === e.key)} onHover={() => setActive(idx)} onClick={() => choose(e)} onPin={e.to ? () => togglePin(e) : undefined} />;
                  })}
                </Group>
              ))}
              {!raw && <Tips onPick={t => { setQ(t); input.current?.focus(); }} />}
              {raw && scope && <p className="sub" style={{ margin: '0 8px 6px', fontSize: 12 }}>{tr('Søker bare i «{hva}».', { hva: raw.split(':')[0] })}</p>}
              {term.length >= 2 && !question && res.isFetching && !d && <p className="sub" style={{ margin: 8 }}>{tr('Søker …')}</p>}
              {d && !count && !question && <p className="sub" style={{ margin: 8 }}>{tr('Ingen treff på «{q}».', { q: d.q })}</p>}
              {d?.ais_error && term.length >= 3 && <p className="sub" style={{ margin: '4px 8px', fontSize: 12 }}>AIS: {tx(d.ais_error)}</p>}
              {raw.length === 1 && !flat.length && <p className="sub" style={{ margin: 8 }}>{tr('Skriv minst to tegn.')}</p>}
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

function Item({ e, active, pinned, onHover, onClick, onPin }: { e: Entry; active: boolean; pinned: boolean; onHover: () => void; onClick: () => void; onPin?: () => void }) {
  return (
    <div role="option" aria-selected={active} data-active={active} onMouseMove={onHover} className="search-row"
      style={{ display: 'flex', alignItems: 'center', gap: 4, borderRadius: 12, background: active ? 'rgba(var(--tint), .08)' : 'transparent' }}>
      <button type="button" className="search-item" tabIndex={-1} onClick={onClick} style={{ flex: 1, minWidth: 0, background: 'transparent', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {e.icon && <span style={{ color: 'var(--aqua)', display: 'flex', width: 18, justifyContent: 'center' }}>{e.icon}</span>}
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 15, color: e.strong ? 'var(--aqua)' : undefined }}>{e.title}</span>
          {e.sub && <span style={{ fontSize: 12, color: 'var(--fg-62)' }}>{e.sub}</span>}
        </span>
      </button>
      {e.phone && (
        <>
          <a className="icon-btn" href={telHref(e.phone)} aria-label={tr('Ring {navn}', { navn: e.title })} title={tr('Ring')} style={{ width: 32, height: 32 }}><Phone size={14} /></a>
          <a className="icon-btn" href={`sms:${e.phone.replace(/\s/g, '')}`} aria-label={tr('Send SMS til {navn}', { navn: e.title })} title="SMS" style={{ width: 32, height: 32 }}><Message size={14} /></a>
        </>
      )}
      {onPin && (
        <button type="button" className="icon-btn pin-btn" tabIndex={-1} onClick={onPin} aria-pressed={pinned} aria-label={pinned ? tr('Fjern fra festet') : tr('Fest i søket')}
          title={pinned ? tr('Fjern fra festet') : tr('Fest i søket')} style={{ width: 32, height: 32, opacity: pinned || active ? 1 : 0 }}>
          <StarLine filled={pinned} />
        </button>
      )}
    </div>
  );
}

/** Når feltet er tomt: hva søket kan gjøre. */
function Tips({ onPick }: { onPick: (t: string) => void }) {
  const tips = [
    tr('Hvilken båt har vi oftest problemer med?'), tr('Hva er det mest populære produktet vi selger?'), tr('i morgen'), tr('ny bulk SU 20 110'), tr('båt: coneste'),
  ];
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '6px 10px 4px' }}>
      <span className="eyebrow" style={{ fontSize: 11 }}>{tr('Prøv')}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {tips.map(t => <button key={t} type="button" className="tab" style={{ minHeight: 30, fontSize: 12, padding: '0 10px' }} onClick={() => onPick(t)}>{t}</button>)}
      </div>
      <span className="sub" style={{ fontSize: 12 }}>
        {tr('Prefiks: båt:, so:, bil:, sjåfør:, kunde:, kai:, person: · ↑↓ og Enter for å velge · Esc lukker')}
      </span>
    </section>
  );
}

// ---------------------------------------------------------------- Spør Flow

/** Svaret fra «Spør Flow»: Claude bruker verktøy som leser Flow-data, og svarer med tall og lenker. */
function AskPanel({ question, onBack, go }: { question: string; onBack: () => void; go: (to: string) => void }) {
  const m = useMutation({ mutationFn: (qq: string) => api<AskAnswer>('/ask', { body: { question: qq, lang: getLang() } }) });
  useEffect(() => { m.mutate(question); }, [question]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 6 }} aria-live="polite">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <button type="button" className="icon-btn pill" aria-label={tr('Tilbake til treffene')} onClick={onBack} style={{ width: 36, height: 36, flex: 'none' }}><ArrowLeft size={15} /></button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="eyebrow" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--aqua)' }}><Sparkle size={13} /> {tr('Spør Flow')}</span>
          <span style={{ fontSize: 16 }}>{question}</span>
        </div>
      </div>
      {m.isPending && <p className="sub loading" style={{ margin: 0 }}>{tr('Flow ser i dataene …')}</p>}
      {m.isError && (
        <div className="error-box" style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{errorText(m.error)}</span>
          <button type="button" className="btn" style={{ minHeight: 32, fontSize: 13 }} onClick={() => m.mutate(question)}>{tr('Prøv igjen')}</button>
        </div>
      )}
      {m.data && (
        <>
          <Markdown text={m.data.answer} go={go} />
          <span className="sub" style={{ fontSize: 11 }}>{tr('Svar fra Claude basert på data i Flow. Kan ta feil – sjekk tallene før du bruker dem.')}</span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- fartøy fra AIS

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
