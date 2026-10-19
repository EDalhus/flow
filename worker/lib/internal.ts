import type { AuthUser } from '../types.ts';

// Jobber fra «Spør Flow» kjøres gjennom de vanlige API-rutene som brukeren som bekreftet dem.
// Et engangstoken (tilfeldig, bare i minnet i denne Worker-instansen) knyttes til brukeren og
// sendes i en header; requireUser slipper det inn én gang. Tokenet forlater aldri Workeren.

const pending = new Map<string, AuthUser>();
export const INTERNAL_HEADER = 'X-Flow-Internal';

export function internalToken(user: AuthUser): string {
  const t = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
  pending.set(t, user);
  setTimeout(() => pending.delete(t), 30_000);
  return t;
}

/** Brukeren bak et internt kall (og tokenet slettes), eller null. */
export function takeInternal(token: string | undefined): AuthUser | null {
  if (!token) return null;
  const u = pending.get(token) ?? null;
  pending.delete(token);
  return u;
}
