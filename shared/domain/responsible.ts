// Regel: har anløpet bare én rolle, er den personen automatisk ansvarlig.
// Ved to eller flere roller velges ansvarlig manuelt, og må være en av personene på anløpet.

export type ResponsibleResult = { ok: true; responsible: string | null } | { ok: false; error: string };

export function resolveResponsible(
  slots: { user_id: string | null }[],
  requested: string | null | undefined,
  current: string | null,
): ResponsibleResult {
  if (slots.length === 1) return { ok: true, responsible: slots[0].user_id ?? null };

  const people = new Set(slots.map(s => s.user_id).filter((u): u is string => !!u));
  if (requested !== undefined) {
    if (requested === null) return { ok: true, responsible: null };
    if (!people.has(requested)) return { ok: false, error: 'Ansvarlig må være en av personene som er satt opp på anløpet.' };
    return { ok: true, responsible: requested };
  }
  return { ok: true, responsible: current && people.has(current) ? current : null };
}
