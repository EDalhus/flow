import { serviceDate } from '../time.ts';
import { CREW_ROLE_PLURAL, CREW_ROLES, type Capacity, type CrewRole } from './types.ts';

// Tre typer kollisjoner mellom aktive anløp (ikke ferdige/avlyste):
//   quay     – samme kai med overlappende tid
//   capacity – samlet rollebehov i et tidsrom er større enn antall på vakt
//   person   – samme person satt opp på to overlappende anløp

export interface CollisionCall {
  id: string;
  boat_name: string;
  quay_id: string;
  eta: string;
  etd: string;
  crew: { crew_role: CrewRole; user_id: string | null }[];
}

export type Collision =
  | { kind: 'quay'; quay_id: string; calls: string[]; from: string; to: string }
  | { kind: 'person'; user_id: string; calls: string[]; from: string; to: string }
  | { kind: 'capacity'; role: CrewRole; needed: number; capacity: number; calls: string[]; from: string; to: string };

export type Suggestion =
  | { kind: 'move_quay'; call_id: string; quay_id: string }
  | { kind: 'postpone'; call_id: string; eta: string; etd: string };

export type CapacityFor = (serviceDate: string) => Capacity;

const t = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();
const overlaps = (a: CollisionCall, b: CollisionCall) => t(a.eta) < t(b.etd) && t(b.eta) < t(a.etd);

export function findCollisions(calls: CollisionCall[], capacityFor: CapacityFor): Collision[] {
  const out: Collision[] = [];
  const sorted = [...calls].sort((a, b) => t(a.eta) - t(b.eta) || a.id.localeCompare(b.id));

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i], b = sorted[j];
      if (t(b.eta) >= t(a.etd)) continue;
      if (!overlaps(a, b)) continue;
      const from = iso(Math.max(t(a.eta), t(b.eta)));
      const to = iso(Math.min(t(a.etd), t(b.etd)));
      if (a.quay_id === b.quay_id) out.push({ kind: 'quay', quay_id: a.quay_id, calls: [a.id, b.id], from, to });
      const inA = new Set(a.crew.map(s => s.user_id).filter(Boolean));
      for (const u of new Set(b.crew.map(s => s.user_id))) {
        if (u && inA.has(u)) out.push({ kind: 'person', user_id: u, calls: [a.id, b.id], from, to });
      }
    }
  }

  // Kapasitet: sveip over alle tidspunkter der et anløp starter eller slutter.
  const points = [...new Set(sorted.flatMap(c => [t(c.eta), t(c.etd)]))].sort((x, y) => x - y);
  const open: Extract<Collision, { kind: 'capacity' }>[] = [];
  for (let k = 0; k < points.length - 1; k++) {
    const start = points[k], end = points[k + 1];
    const active = sorted.filter(c => t(c.eta) <= start && t(c.etd) >= end);
    if (!active.length) continue;
    const cap = capacityFor(serviceDate(new Date(start)));
    for (const role of CREW_ROLES) {
      const needed = active.reduce((n, c) => n + c.crew.filter(s => s.crew_role === role).length, 0);
      if (needed <= cap[role]) continue;
      const ids = active.filter(c => c.crew.some(s => s.crew_role === role)).map(c => c.id);
      const prev = open.find(o => o.role === role && o.to === iso(start) && o.needed === needed && o.calls.join() === ids.join());
      if (prev) prev.to = iso(end);
      else open.push({ kind: 'capacity', role, needed, capacity: cap[role], calls: ids, from: iso(start), to: iso(end) });
    }
  }
  out.push(...open);
  return out;
}

/** Kollisjoner som involverer et bestemt anløp. */
export function collisionsFor(id: string, all: Collision[]): Collision[] {
  return all.filter(c => c.calls.includes(id));
}

export interface SuggestOptions {
  quayIds: string[];
  capacityFor: CapacityFor;
  bufferMinutes: number;
  /** Anløpet som skal flyttes (f.eks. det som redigeres). Ellers det som starter sist. */
  target?: string;
}

/**
 * Forslag som løser en kollisjon uten å skape nye for anløpet som flyttes:
 * flytt til ledig kai i samme tidsrom, eller utsett til et tidligere anløp er ferdig.
 */
export function suggest(collision: Collision, calls: CollisionCall[], opts: SuggestOptions): Suggestion[] {
  const involved = calls.filter(c => collision.calls.includes(c.id));
  const target = involved.find(c => c.id === opts.target)
    ?? [...involved].sort((a, b) => t(b.eta) - t(a.eta) || b.id.localeCompare(a.id))[0];
  if (!target) return [];
  const others = calls.filter(c => c.id !== target.id);
  const clean = (candidate: CollisionCall) =>
    collisionsFor(candidate.id, findCollisions([...others, candidate], opts.capacityFor)).length === 0;

  const out: Suggestion[] = [];
  for (const quay_id of opts.quayIds) {
    if (quay_id !== target.quay_id && clean({ ...target, quay_id })) out.push({ kind: 'move_quay', call_id: target.id, quay_id });
  }

  const duration = t(target.etd) - t(target.eta);
  const buffer = opts.bufferMinutes * 60_000;
  const starts = [...new Set(others.map(c => t(c.etd) + buffer))]
    .filter(s => s > t(target.eta) && s - t(target.eta) <= 24 * 3_600_000)
    .sort((a, b) => a - b);
  for (const s of starts) {
    const candidate = { ...target, eta: iso(s), etd: iso(s + duration) };
    if (clean(candidate)) {
      out.push({ kind: 'postpone', call_id: target.id, eta: candidate.eta, etd: candidate.etd });
      break;
    }
  }
  return out;
}

/** Kort norsk tekst, som i designet: "Kai 1 dobbeltbooket", "5 trucksjåfører trengs, 4 på vakt". */
export function describeCollision(c: Collision, names: { quay: (id: string) => string; user: (id: string) => string }): string {
  switch (c.kind) {
    case 'quay': return `${names.quay(c.quay_id)} dobbeltbooket`;
    case 'person': return `${names.user(c.user_id)} står på begge`;
    case 'capacity': return `${c.needed} ${CREW_ROLE_PLURAL[c.role]} trengs, ${c.capacity} på vakt`;
  }
}
