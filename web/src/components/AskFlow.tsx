import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { AskAction, AskAnswer, AskTurn } from '../../../shared/api.ts';
import { api, errorText } from '../lib/api.ts';
import { useDictation } from '../lib/dictation.ts';
import { getLang, tr, tx } from '../lib/i18n.ts';
import { ArrowLeft, Check, Mic, Send, Sparkle } from './Icons.tsx';
import { Markdown } from './Markdown.tsx';

// «Spør Flow» som samtale: spørsmål, svar og jobber Claude foreslår (brukeren trykker «Utfør»), med oppfølgingsspørsmål.

type Turn = { q: string; a?: AskAnswer; error?: string };

export function AskFlow({ question, onBack, go }: { question: string; onBack: () => void; go: (to: string) => void }) {
  const [turns, setTurns] = useState<Turn[]>([{ q: question }]);
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const history = (upto: number): AskTurn[] => turns.slice(0, upto).flatMap(t => (t.a ? [{ role: 'user' as const, content: t.q }, { role: 'assistant' as const, content: t.a.answer || t.a.actions.map(a => a.summary).join('\n') }] : []));
  const m = useMutation({
    mutationFn: ({ q, i }: { q: string; i: number }) => api<AskAnswer>('/ask', { body: { question: q, lang: getLang(), history: history(i) } }),
    onSuccess: (a, { i }) => setTurns(ts => ts.map((t, j) => (j === i ? { ...t, a, error: undefined } : t))),
    onError: (e, { i }) => setTurns(ts => ts.map((t, j) => (j === i ? { ...t, error: errorText(e) } : t))),
  });
  useEffect(() => { m.mutate({ q: question, i: 0 }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [turns]);
  const dict = useDictation(t => setDraft(d => (d ? `${d} ${t}` : t)));
  const send = () => {
    const q = draft.trim();
    if (!q || m.isPending) return;
    dict.stop();
    setDraft('');
    setTurns(ts => [...ts, { q }]);
    m.mutate({ q, i: turns.length });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 6 }} aria-live="polite">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="icon-btn pill" aria-label={tr('Tilbake til treffene')} onClick={onBack} style={{ width: 36, height: 36, flex: 'none' }}><ArrowLeft size={15} /></button>
        <span className="eyebrow" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--aqua)' }}><Sparkle size={13} /> {tr('Spør Flow')}</span>
      </div>
      {turns.map((t, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ alignSelf: 'flex-end', maxWidth: '85%', padding: '8px 12px', borderRadius: '14px 14px 4px 14px', background: 'rgba(var(--tint), .08)', fontSize: 14 }}>{t.q}</div>
          {!t.a && !t.error && <p className="sub loading" style={{ margin: 0 }}>{tr('Flow ser i dataene …')}</p>}
          {t.error && (
            <div className="error-box" style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{t.error}</span>
              <button type="button" className="btn" style={{ minHeight: 32, fontSize: 13 }} disabled={m.isPending}
                onClick={() => { setTurns(ts => ts.map((x, j) => (j === i ? { q: x.q } : x))); m.mutate({ q: t.q, i }); }}>{tr('Prøv igjen')}</button>
            </div>
          )}
          {t.a && (
            <>
              {t.a.answer && <Markdown text={t.a.answer} go={go} />}
              {t.a.actions.map(a => <ActionCard key={a.id} initial={a} go={go} />)}
            </>
          )}
        </div>
      ))}
      <div ref={end} />
      <form onSubmit={e => { e.preventDefault(); send(); }} style={{ display: 'flex', gap: 6, alignItems: 'center', borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
        <input className="inp" value={draft} onChange={e => setDraft(e.target.value)} placeholder={tr('Spør videre, eller be Flow gjøre noe …')}
          onKeyDown={e => e.stopPropagation()} style={{ flex: 1, minHeight: 40, fontSize: 14 }} aria-label={tr('Oppfølgingsspørsmål')} />
        {dict.supported && (
          <button type="button" className="icon-btn" onClick={dict.toggle} aria-pressed={dict.on} aria-label={dict.on ? tr('Stopp diktering') : tr('Snakk inn')}
            style={{ width: 40, height: 40, ...(dict.on ? { background: '#E5484D', color: '#fff' } : {}) }}><Mic size={16} /></button>
        )}
        <button type="submit" className="icon-btn" disabled={!draft.trim() || m.isPending} aria-label={tr('Send')} style={{ width: 40, height: 40 }}><Send size={15} /></button>
      </form>
      {dict.error && <span className="sub" style={{ fontSize: 12 }}>{tr(dict.error)}</span>}
      <span className="sub" style={{ fontSize: 11 }}>{tr('Svar fra Claude basert på data i Flow. Kan ta feil – sjekk tallene før du bruker dem.')}</span>
    </div>
  );
}

/** En jobb Claude foreslår: ingenting skjer før brukeren trykker «Utfør». */
function ActionCard({ initial, go }: { initial: AskAction; go: (to: string) => void }) {
  const qc = useQueryClient();
  const [a, setA] = useState(initial);
  const act = useMutation({
    mutationFn: (what: 'confirm' | 'cancel') => api<AskAction>(`/ask/actions/${a.id}/${what}`, { body: {} }),
    onSuccess: r => { setA(r); if (r.status === 'utfort') qc.invalidateQueries(); },
  });
  const done = a.status === 'utfort', failed = a.status === 'feilet', off = a.status === 'avbrutt';
  return (
    <div style={{ borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 8,
      border: `1px solid ${done ? 'rgba(91,214,138,.5)' : failed ? 'rgba(229,72,77,.6)' : 'rgba(128,239,222,.45)'}`, background: done ? 'rgba(91,214,138,.08)' : 'rgba(128,239,222,.06)', opacity: off ? .55 : 1 }}>
      <span className="eyebrow" style={{ fontSize: 10, color: done ? 'var(--ok-fg)' : failed ? 'var(--bad-fg)' : 'var(--aqua)' }}>
        {done ? tr('Utført') : failed ? tr('Feilet') : off ? tr('Avbrutt') : tr('Forslag – ikke utført ennå')}
      </span>
      <strong style={{ fontWeight: 500, fontSize: 15 }}>{a.summary}</strong>
      {a.details.length > 0 && (
        <ul className="md-list md-ul" style={{ fontSize: 13, color: 'var(--fg-75)' }}>{a.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
      )}
      {failed && a.error && <span style={{ fontSize: 13, color: 'var(--bad-fg)' }}>{tx(a.error)}</span>}
      {act.isError && <div className="error-box">{errorText(act.error)}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {a.status === 'foreslatt' && (
          <>
            <button type="button" className="btn btn-w" style={{ minHeight: 36, fontSize: 13 }} disabled={act.isPending} onClick={() => act.mutate('confirm')}>
              {act.isPending ? tr('Utfører …') : tr('Utfør')}
            </button>
            <button type="button" className="btn" style={{ minHeight: 36, fontSize: 13 }} disabled={act.isPending} onClick={() => act.mutate('cancel')}>{tr('Avbryt')}</button>
          </>
        )}
        {done && (
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ok-fg)', fontSize: 13 }}><Check size={14} /> {tr('Gjort i Flow')}</span>
            {a.link && <button type="button" className="btn" style={{ minHeight: 32, fontSize: 13 }} onClick={() => go(a.link!)}>{tr('Åpne')}</button>}
          </>
        )}
      </div>
    </div>
  );
}
