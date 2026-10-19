import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { BulkOrderView, DriverMe, Lang } from '../../../shared/api.ts';
import { bulkPhase } from '../../../shared/domain/bulk.ts';
import type { BulkOrderCreateInput } from '../../../shared/schemas.ts';
import { BookingForm, PhaseBadge, StepChips } from '../components/Bulk.tsx';
import { LangFlag } from '../components/Flag.tsx';
import { Mic } from '../components/Icons.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { useDictation } from '../lib/dictation.ts';
import { ApiError, errorText } from '../lib/api.ts';
import { dayShort, fr, osloTime, todayOslo } from '../lib/format.ts';
import { LANGS, getLang, loadLang, tr } from '../lib/i18n.ts';
import { setTheme } from '../lib/theme.ts';

// Sjåførvisningen: egen innlogging (telefon + PIN), helt skilt fra resten av Flow.
// Sjåføren bestiller, starter, pauser (mellom bil og henger), nødstopper og avslutter lastingen selv.

const TOKEN_KEY = 'flow-sjafor';
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = (t: string | null) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* ignorer */ } };

async function dapi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api/driver${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data ?? {});
  return data as T;
}

const client = new QueryClient({ defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 } } });

export function DriverApp() {
  return <QueryClientProvider client={client}><DriverRoot /></QueryClientProvider>;
}

const storedLang = (): Lang => { try { const v = localStorage.getItem('flow-sprak') as Lang; return LANGS.some(l => l.value === v) ? v : 'nb'; } catch { return 'nb'; } };

function DriverRoot() {
  const [token, setTok] = useState(getToken());
  const [lang, setLang] = useState<Lang>(storedLang());
  const [ready, setReady] = useState<Lang | null>(null);
  useEffect(() => { setTheme('mork'); document.title = 'Flow · Sjåfør'; }, []);
  useEffect(() => {
    let live = true;
    try { localStorage.setItem('flow-sprak', lang); } catch { /* ignorer */ }
    loadLang(lang).then(() => live && setReady(lang), () => live && setReady(getLang()));
    return () => { live = false; };
  }, [lang]);
  if (ready !== lang) return <main className="loading" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>Flow</main>;
  const logout = () => { setToken(null); setTok(null); client.clear(); };
  return (
    <div key={ready} className="drv">
      {token
        ? <DriverHome lang={lang} setLang={setLang} onLogout={logout} />
        : <Login lang={lang} setLang={setLang} onLogin={t => { setToken(t); setTok(t); }} />}
    </div>
  );
}

function LangPicker({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div role="group" aria-label={tr('Språk')} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {LANGS.map(l => (
        <button key={l.value} type="button" onClick={() => setLang(l.value)} aria-pressed={lang === l.value} title={l.label} aria-label={l.label}
          style={{ padding: 8, borderRadius: 10, cursor: 'pointer', display: 'flex', background: lang === l.value ? 'rgba(var(--tint), .14)' : 'transparent',
            border: `1px solid ${lang === l.value ? 'var(--fg-62)' : 'var(--line)'}` }}>
          <LangFlag lang={l.value} />
        </button>
      ))}
    </div>
  );
}

function Login({ lang, setLang, onLogin }: { lang: Lang; setLang: (l: Lang) => void; onLogin: (token: string) => void }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const login = useMutation({ mutationFn: () => dapi<{ token: string }>('/login', { body: { phone, pin } }), onSuccess: r => onLogin(r.token) });
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form className="glass" onSubmit={e => { e.preventDefault(); login.mutate(); }}
        style={{ width: '100%', maxWidth: 420, padding: 28, display: 'flex', flexDirection: 'column', gap: 16, fontSize: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontWeight: 300, fontSize: 36 }}>Flow</h1>
          <span className="muted">{tr('Sjåfør · utlasting av bulksalt')}</span>
        </div>
        <LangPicker lang={lang} setLang={setLang} />
        <label className="field"><span>{tr('Telefonnummer')}</span>
          <input className="inp" inputMode="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} style={{ fontSize: 20, minHeight: 52 }} />
        </label>
        <label className="field"><span>{tr('PIN')}</span>
          <input className="inp n" type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ''))} style={{ fontSize: 24, minHeight: 52, letterSpacing: 6 }} />
        </label>
        {login.isError && <div className="error-box">{errorText(login.error)}</div>}
        <button type="submit" className="btn btn-w" disabled={login.isPending || !phone || pin.length < 4} style={{ ...big, minHeight: 56, flex: 'none' }}>
          {login.isPending ? tr('Logger inn …') : tr('Logg inn')}
        </button>
        <span className="sub">{tr('Har du ikke PIN? Kontakt kontoret på kaia.')}</span>
      </form>
    </main>
  );
}

function DriverHome({ lang, setLang, onLogout }: { lang: Lang; setLang: (l: Lang) => void; onLogout: () => void }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['driver-me'], queryFn: () => dapi<DriverMe>('/me'), refetchInterval: 5000 });
  const [booking, setBooking] = useState(false);
  const [help, setHelp] = useState(false);
  const create = useMutation({
    mutationFn: (b: BulkOrderCreateInput) => dapi<BulkOrderView>('/orders', { body: b }),
    onSuccess: () => { setBooking(false); qc.invalidateQueries({ queryKey: ['driver-me'] }); },
  });
  // Språket følger sjåførprofilen; et nytt valg lagres på profilen.
  useEffect(() => {
    const l = me.data?.driver.lang as Lang | undefined;
    if (l && l !== lang && LANGS.some(x => x.value === l) && !sessionStorage.getItem('flow-sjafor-lang')) setLang(l);
  }, [me.data?.driver.lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const chooseLang = (l: Lang) => {
    try { sessionStorage.setItem('flow-sjafor-lang', l); } catch { /* ignorer */ }
    setLang(l);
    dapi('/me/lang', { method: 'PUT', body: { lang: l } }).catch(() => {});
  };
  const out = () => { dapi('/logout', { body: {} }).catch(() => {}); onLogout(); };

  if (me.isError && me.error instanceof ApiError && me.error.status === 401) {
    setTimeout(onLogout);
    return null;
  }
  if (!me.data) return <main className="loading" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>Flow</main>;
  const d = me.data;
  const today = todayOslo();
  const active = d.orders.filter(o => o.status === 'lastes');
  const waiting = d.orders.filter(o => o.status === 'bestilt');
  const done = d.orders.filter(o => o.status === 'ferdig' || o.status === 'avlyst');
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '16px 16px 48px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 24 }}>{d.driver.name}</div>
            <div className="muted" style={{ fontSize: 15 }}>{d.driver.hauler.name}</div>
          </div>
          {d.ai && <button type="button" className="btn" onClick={() => setHelp(!help)} aria-expanded={help}>{tr('Hjelp')}</button>}
          <button type="button" className="btn" onClick={out}>{tr('Logg ut')}</button>
        </div>
        <LangPicker lang={lang} setLang={chooseLang} />
      </header>
      {help && <DriverHelp onClose={() => setHelp(false)} />}

      {active.map(o => <ActiveOrder key={o.id} order={o} />)}
      {waiting.map(o => <WaitingOrder key={o.id} order={o} today={today} canStart={!active.length} />)}

      {booking ? (
        <section className="glass" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 300 }}>{tr('Ny lasting')}</h2>
          {!d.vehicles.length
            ? <p className="muted" style={{ margin: 0 }}>{tr('Ingen biler er registrert på firmaet ditt. Kontakt kontoret.')}</p>
            : <BookingForm large vehicles={d.vehicles} customers={d.customers} qualities={d.qualities} pending={create.isPending}
                error={create.isError ? errorText(create.error) : null} onSubmit={b => create.mutate(b)} onCancel={() => setBooking(false)} />}
        </section>
      ) : (
        <button type="button" className={active.length ? 'btn' : 'btn btn-w'} onClick={() => { create.reset(); setBooking(true); }} style={{ ...big, minHeight: 64, flex: 'none' }}>
          + {tr('Ny lasting')}
        </button>
      )}

      {done.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="eyebrow">{tr('Ferdig i dag')} · {done.length}</span>
          {done.map(o => (
            <article key={o.id} className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, opacity: o.status === 'avlyst' ? .55 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span style={{ fontSize: 18 }}>{o.truck} · {o.customer?.name}</span><PhaseBadge o={o} />
              </div>
              <StepChips o={o} />
              {o.has_pdf && <PdfButton order={o} />}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

function useAct(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, weighed }: { action: string; weighed?: number }) =>
      dapi<BulkOrderView>(`/orders/${id}/${action}`, { body: weighed === undefined ? {} : { weighed_tonnes: weighed } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driver-me'] }),
  });
}

function Head({ o }: { o: BulkOrderView }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 24 }}>{o.truck}</span>
        <span style={{ fontSize: 16, color: 'var(--fg-75)' }}>
          {o.customer?.name}{o.project_no && <span className="muted"> · {tr('prosjekt {nr}', { nr: o.project_no })}</span>}
        </span>
      </span>
      <PhaseBadge o={o} style={{ fontSize: 16 }} />
    </div>
  );
}

const big = { minHeight: 72, fontSize: 21, borderRadius: 18, flex: 1, textTransform: 'none', letterSpacing: 0, padding: '10px 18px' } as const;

/** Lastingen som pågår: steg ferdig (veid tonn), start henger, nødstopp og fortsett. */
function ActiveOrder({ order: o }: { order: BulkOrderView }) {
  const act = useAct(o.id);
  const p = bulkPhase(o.status, o.steps, o.stopped_at);
  const cur = p.kind === 'laster' || p.kind === 'stoppet' ? o.steps.find(s => s.seq === p.step) : undefined;
  const next = p.kind === 'pause' ? o.steps.find(s => s.seq === p.next) : undefined;
  const [weighed, setWeighed] = useState('');
  useEffect(() => { setWeighed(cur ? String(cur.tonnes) : ''); }, [cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const w = Number(weighed.replace(',', '.'));
  return (
    <section className="glass" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, borderColor: p.kind === 'stoppet' ? '#E5484D' : 'rgba(128,239,222,.45)' }}>
      <Head o={o} />
      <StepChips o={o} large />
      {p.kind === 'laster' && cur && (
        <>
          <label className="field" style={{ fontSize: 18 }}>
            <span>{tr('Veid på {hva} (tonn) – fra vekta på utlastingen', { hva: cur.target === 'henger' ? tr('henger') : tr('bil') })}</span>
            <input className="inp n" inputMode="decimal" value={weighed} onChange={e => setWeighed(e.target.value)} style={{ fontSize: 30, minHeight: 64 }} />
          </label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-w" style={big} disabled={act.isPending || !(w > 0 && w <= 60)}
              onClick={() => act.mutate({ action: 'step-done', weighed: w })}>
              {o.steps.some(s => s.seq > cur.seq) ? tr('Bil ferdig') : tr('Ferdig – lag følgeseddel')}
            </button>
          </div>
        </>
      )}
      {p.kind === 'pause' && next && (
        <>
          <p style={{ margin: 0, fontSize: 20 }}>{tr('Flytt hengeren under utlastingen, og trykk start.')}</p>
          <button type="button" className="btn btn-w" style={big} disabled={act.isPending} onClick={() => act.mutate({ action: 'start' })}>
            {tr('Start henger · {t} t {kvalitet}', { t: fr(next.tonnes), kvalitet: next.quality_name })}
          </button>
        </>
      )}
      {p.kind === 'stoppet' ? (
        <>
          <p role="alert" style={{ margin: 0, fontSize: 20, color: '#FF8A8D' }}>{tr('Lastingen er stoppet. Kontoret og produksjonen er varslet.')}</p>
          <button type="button" className="btn btn-w" style={big} disabled={act.isPending} onClick={() => act.mutate({ action: 'continue' })}>{tr('Fortsett lasting')}</button>
        </>
      ) : (
        <button type="button" disabled={act.isPending} onClick={() => act.mutate({ action: 'stop' })}
          style={{ ...big, flex: 'none', border: 'none', cursor: 'pointer', background: '#E5484D', color: '#fff', fontWeight: 600, letterSpacing: 1 }}>
          {tr('NØDSTOPP')}
        </button>
      )}
      {act.isError && <div className="error-box">{errorText(act.error)}</div>}
    </section>
  );
}

/** Bestilt, ikke startet: start lasting eller avbestill. */
function WaitingOrder({ order: o, today, canStart }: { order: BulkOrderView; today: string; canStart: boolean }) {
  const act = useAct(o.id);
  const first = o.steps[0];
  const when = o.expected_at ? `${o.expected_at.slice(0, 10) === today ? '' : `${dayShort(o.expected_at.slice(0, 10))} `}${osloTime(o.expected_at)}` : null;
  return (
    <section className="glass" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Head o={o} />
      <StepChips o={o} large />
      {when && <span className="muted" style={{ fontSize: 16 }}>{tr('Bestilt til ca. {tid}', { tid: when })}</span>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-w" style={big} disabled={act.isPending || !canStart} onClick={() => act.mutate({ action: 'start' })}>
          {tr('Start lasting · {t} t {kvalitet}', { t: fr(first.tonnes), kvalitet: first.quality_name })}
        </button>
        <button type="button" className="btn" style={{ minHeight: 72, fontSize: 18 }} disabled={act.isPending}
          onClick={() => confirm(tr('Avbestille lastingen?')) && act.mutate({ action: 'cancel' })}>{tr('Avbestill')}</button>
      </div>
      {act.isError && <div className="error-box">{errorText(act.error)}</div>}
    </section>
  );
}

/** Følgeseddelen hentes med sjåførens token og åpnes som PDF. */
function PdfButton({ order: o }: { order: BulkOrderView }) {
  const [err, setErr] = useState<string | null>(null);
  const open = async () => {
    setErr(null);
    const win = window.open('', '_blank');
    try {
      const res = await fetch(`/api/driver/orders/${o.id}/pdf`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(tr('Fant ikke følgeseddelen.'));
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url; else location.href = url;
    } catch (e) { win?.close(); setErr(errorText(e)); }
  };
  return (
    <>
      <button type="button" className="btn" onClick={open} style={{ minHeight: 48, fontSize: 17, alignSelf: 'flex-start' }}>
        {tr('Følgeseddel nr. {n}', { n: o.delivery_no ?? '' })} (PDF)
      </button>
      {err && <div className="error-box">{err}</div>}
    </>
  );
}

/** Hjelp: spør med egne ord på ditt språk («hvordan starter jeg henger?»); Claude svarer ut fra sjåførhåndboka. */
function DriverHelp({ onClose }: { onClose: () => void }) {
  const [turns, setTurns] = useState<{ q: string; a?: string; error?: string }[]>([]);
  const [draft, setDraft] = useState('');
  const dict = useDictation(t => setDraft(x => (x ? `${x} ${t}` : t)));
  const m = useMutation({
    mutationFn: ({ q, i }: { q: string; i: number }) => dapi<{ answer: string }>('/help', { body: {
      question: q, history: turns.slice(0, i).flatMap(t => (t.a ? [{ role: 'user', content: t.q }, { role: 'assistant', content: t.a }] : [])),
    } }),
    onSuccess: (r, { i }) => setTurns(ts => ts.map((t, j) => (j === i ? { ...t, a: r.answer } : t))),
    onError: (e, { i }) => setTurns(ts => ts.map((t, j) => (j === i ? { ...t, error: errorText(e) } : t))),
  });
  const send = () => {
    const q = draft.trim();
    if (!q || m.isPending) return;
    dict.stop();
    setDraft('');
    setTurns(ts => [...ts, { q }]);
    m.mutate({ q, i: turns.length });
  };
  return (
    <section className="glass" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }} aria-label={tr('Hjelp')}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ flex: 1, fontSize: 20, fontWeight: 300 }}>{tr('Hjelp')}</span>
        <button type="button" className="btn" onClick={onClose}>{tr('Lukk')}</button>
      </div>
      {!turns.length && <span className="muted" style={{ fontSize: 15 }}>{tr('Spør med egne ord, f.eks. «Hvordan starter jeg henger?» eller «Jeg har glemt PIN».')}</span>}
      {turns.map((t, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ alignSelf: 'flex-end', maxWidth: '85%', padding: '8px 12px', borderRadius: '14px 14px 4px 14px', background: 'rgba(var(--tint), .08)', fontSize: 16 }}>{t.q}</div>
          {t.a ? <Markdown text={t.a} go={() => {}} size={16} /> : t.error ? <div className="error-box">{t.error}</div> : <span className="sub loading">{tr('Et øyeblikk …')}</span>}
        </div>
      ))}
      <form onSubmit={e => { e.preventDefault(); send(); }} style={{ display: 'flex', gap: 8 }}>
        <input className="inp" value={draft} onChange={e => setDraft(e.target.value)} placeholder={tr('Skriv spørsmålet ditt …')} style={{ flex: 1, minHeight: 52, fontSize: 17 }} aria-label={tr('Spørsmål')} />
        {dict.supported && (
          <button type="button" className="icon-btn" onClick={dict.toggle} aria-pressed={dict.on} aria-label={dict.on ? tr('Stopp diktering') : tr('Snakk inn')}
            style={{ width: 52, height: 52, ...(dict.on ? { background: '#E5484D', color: '#fff' } : {}) }}><Mic size={20} /></button>
        )}
        <button type="submit" className="btn btn-w" disabled={!draft.trim() || m.isPending} style={{ minHeight: 52 }}>{tr('Send')}</button>
      </form>
    </section>
  );
}
