import { useEffect, useRef, useState } from 'react';
import { getLang } from './i18n.ts';

// Tale til tekst i nettleseren (Web Speech API: Chrome, Edge og Safari). Gratis og uten oppsett;
// der det ikke støttes, skjules mikrofonknappen (tastaturet på mobilen har egen diktering).

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start: () => void; stop: () => void;
};
const LOCALE: Record<string, string> = { nb: 'nb-NO', en: 'en-GB', lt: 'lt-LT', da: 'da-DK', sv: 'sv-SE', is: 'is-IS' };
const Ctor = (): (new () => Recognition) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
export const canDictate = () => typeof window !== 'undefined' && !!Ctor();

/** Diktering: `onText` får ferdige setninger som legges til teksten. */
export function useDictation(onText: (text: string) => void) {
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onText);
  cb.current = onText;
  useEffect(() => () => rec.current?.stop(), []);
  const start = () => {
    const C = Ctor();
    if (!C) return;
    const r = new C();
    r.lang = LOCALE[getLang()] ?? 'nb-NO';
    r.continuous = true;
    r.interimResults = false;
    r.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) cb.current(e.results[i][0].transcript.trim());
    };
    r.onerror = e => { setError(e.error === 'not-allowed' ? 'Gi nettleseren tilgang til mikrofonen.' : 'Talegjenkjenningen stoppet.'); setOn(false); };
    r.onend = () => setOn(false);
    rec.current = r;
    setError(null);
    r.start();
    setOn(true);
  };
  const stop = () => { rec.current?.stop(); setOn(false); };
  return { on, error, start, stop, toggle: () => (on ? stop() : start()), supported: canDictate() };
}
