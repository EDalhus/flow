// Bulkbil: bestilling i steg (bil, eventuelt henger). Sjåføren styrer selv: Start → Steg ferdig (veid tonn)
// → pause mens bilen flyttes → Start henger → Ferdig. Nødstopp kan trykkes når som helst under lastingen.

export interface BulkStepLike {
  seq: number;
  quality_id: string;
  tonnes: number;
  started_at: string | null;
  finished_at: string | null;
}

export type BulkPhase =
  | { kind: 'venter' }                       // ikke startet
  | { kind: 'laster'; step: number }         // steg pågår
  | { kind: 'pause'; next: number }          // forrige steg ferdig, neste ikke startet (f.eks. flytte til henger)
  | { kind: 'stoppet'; step: number | null } // nødstopp
  | { kind: 'ferdig' };

export function bulkPhase(status: string, steps: BulkStepLike[], stoppedAt?: string | null): BulkPhase {
  if (status === 'ferdig' || status === 'avlyst') return { kind: 'ferdig' };
  const sorted = [...steps].sort((a, b) => a.seq - b.seq);
  const active = sorted.find(s => s.started_at && !s.finished_at);
  if (stoppedAt) return { kind: 'stoppet', step: active?.seq ?? null };
  if (active) return { kind: 'laster', step: active.seq };
  if (!sorted.some(s => s.started_at)) return { kind: 'venter' };
  const next = sorted.find(s => !s.finished_at);
  return next ? { kind: 'pause', next: next.seq } : { kind: 'ferdig' };
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

/** Telefonnummer som bare sifre med landkode: «400 10 203» → «4740010203». */
export function normalizePhone(v: string): string {
  const d = v.replace(/\D/g, '').replace(/^00/, '');
  return d.length === 8 ? `47${d}` : d;
}

/** Minutter mellom to tidspunkt (ISO), eller null. */
export const minutesBetween = (a: string | null, b: string | null) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000)) : null);
