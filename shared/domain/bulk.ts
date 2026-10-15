// Bulkbil: bestilling i steg. Et steg er «aktivt» fra started_at til finished_at.
// Etter et ferdig steg settes neste stegs started_at til slutten av pausen, så alle
// skjermer kan vise nedtelling uten at serveren må gjøre noe når pausen er over.

export interface BulkStepLike {
  seq: number;
  quality_id: string;
  tonnes: number;
  pause_after_sec: number;
  started_at: string | null;
  finished_at: string | null;
}

export type BulkPhase =
  | { kind: 'venter' }                                     // ikke startet
  | { kind: 'laster'; step: number }                       // steg pågår
  | { kind: 'pause'; next: number; untilMs: number }       // pause før neste steg
  | { kind: 'ferdig' };

export function bulkPhase(status: string, steps: BulkStepLike[], now: number): BulkPhase {
  if (status === 'ferdig' || status === 'avlyst') return { kind: 'ferdig' };
  const sorted = [...steps].sort((a, b) => a.seq - b.seq);
  if (!sorted.some(s => s.started_at)) return { kind: 'venter' };
  for (const s of sorted) {
    if (s.finished_at) continue;
    if (!s.started_at) return { kind: 'venter' };
    const start = Date.parse(s.started_at);
    if (start > now) return { kind: 'pause', next: s.seq, untilMs: start };
    return { kind: 'laster', step: s.seq };
  }
  return { kind: 'ferdig' };
}

/** Tonn per kvalitet som gjenstår i åpne bestillinger – det traktene må fylles med. */
export function bulkDemand(orders: { status: string; steps: BulkStepLike[] }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of orders) {
    if (o.status === 'ferdig' || o.status === 'avlyst') continue;
    for (const s of o.steps) if (!s.finished_at) out[s.quality_id] = (out[s.quality_id] ?? 0) + s.tonnes;
  }
  return out;
}

/** "2:30" → 150 sekunder. Godtar også bare sekunder. */
export function parseMinSec(v: string): number | null {
  const m = /^\s*(\d{1,2})(?::([0-5]\d))?\s*$/.exec(v);
  if (!m) return null;
  return m[2] === undefined ? Number(m[1]) : Number(m[1]) * 60 + Number(m[2]);
}

export const formatMinSec = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.max(0, Math.round(sec % 60))).padStart(2, '0')}`;
