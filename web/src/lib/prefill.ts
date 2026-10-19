import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

// Handlinger fra søkefeltet («ny bulk SU 20 110») åpner skjemaet ferdig utfylt via URL-en:
// ?ny=1&bil=SU%2020%20110. Verdiene leses én gang og fjernes fra adressen.

export type Prefill = Record<string, string> & { n: string };

export function usePrefill(keys: string[]): [Prefill | null, () => void] {
  const [params, setParams] = useSearchParams();
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const ny = params.get('ny');
  useEffect(() => {
    if (ny !== '1') return;
    const v: Prefill = { n: String(Date.now()) };
    for (const k of keys) { const x = params.get(k); if (x) v[k] = x; }
    setPrefill(v);
    setParams(p => { p.delete('ny'); for (const k of keys) p.delete(k); return p; }, { replace: true });
  }, [ny]); // eslint-disable-line react-hooks/exhaustive-deps
  return [prefill, () => setPrefill(null)];
}
