import { useEffect, useState } from 'react';

/** Nåtid som oppdateres hvert halve minutt (klokke, nedtelling, nå-strek). */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
