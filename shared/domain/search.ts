import { addDays, isoWeekMonday } from '../time.ts';

// Tolking av det som skrives i søkefeltet: datoer («fredag», «uke 43»), handlinger («ny bulk SU 20 110»),
// prefiks som avgrenser søket («båt: coneste») og spørsmål som skal til «Spør Flow».

const WEEKDAYS: Record<string, number> = {
  mandag: 1, tirsdag: 2, onsdag: 3, torsdag: 4, fredag: 5, lørdag: 6, lordag: 6, søndag: 7, sondag: 7,
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
};

export interface DayRange { from: string; to: string }

/** ISO-ukedag (1 = mandag) for en lokal dato. */
const isoDow = (d: string) => ((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

/**
 * Dato eller periode i søket: i dag, i morgen, i går, overmorgen, ukedager (neste forekomst, i dag medregnet),
 * «denne uka», «neste uke», «forrige uke», «uke 43» og «23.10» / «23.10.2026». Ellers null.
 */
export function parseDay(raw: string, today: string): DayRange | null {
  const q = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  const one = (d: string) => ({ from: d, to: d });
  if (/^(i dag|idag|today|í dag|šiandien)$/.test(q)) return one(today);
  if (/^(i morgen|imorgen|tomorrow|i morgon|á morgun|rytoj)$/.test(q)) return one(addDays(today, 1));
  if (/^(i går|igår|i gar|yesterday|í gær|vakar)$/.test(q)) return one(addDays(today, -1));
  if (/^(i overmorgen|overmorgen)$/.test(q)) return one(addDays(today, 2));
  const dow = isoDow(today);
  const monday = addDays(today, 1 - dow);
  if (/^(denne uka|denne uken|this week)$/.test(q)) return { from: monday, to: addDays(monday, 6) };
  if (/^(neste uke|next week)$/.test(q)) return { from: addDays(monday, 7), to: addDays(monday, 13) };
  if (/^(forrige uke|last week)$/.test(q)) return { from: addDays(monday, -7), to: addDays(monday, -1) };
  const wd = q.replace(/^(på|on|neste|next)\s+/, '');
  if (WEEKDAYS[wd]) return one(addDays(today, (WEEKDAYS[wd] - dow + 7) % 7));
  const wk = /^(?:uke|week|veke)\s*(\d{1,2})(?:\s+(\d{4}))?$/.exec(q);
  if (wk) {
    const week = Number(wk[1]);
    if (week < 1 || week > 53) return null;
    const year = wk[2] ? Number(wk[2]) : Number(today.slice(0, 4));
    const mon = isoWeekMonday(year, week);
    return { from: mon, to: addDays(mon, 6) };
  }
  const dm = /^(\d{1,2})\.(\d{1,2})\.?(\d{4})?$/.exec(q);
  if (dm) {
    const [d, m] = [Number(dm[1]), Number(dm[2])];
    if (d < 1 || d > 31 || m < 1 || m > 12) return null;
    const y = dm[3] ?? today.slice(0, 4);
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return Number.isNaN(Date.parse(iso)) ? null : one(iso);
  }
  return null;
}

export type SearchScope = 'bat' | 'so' | 'bil' | 'sjafor' | 'kunde' | 'kai' | 'person';
const SCOPES: Record<string, SearchScope> = {
  båt: 'bat', bat: 'bat', boat: 'bat', so: 'so', ordre: 'so', bil: 'bil', truck: 'bil', sjåfør: 'sjafor', sjafor: 'sjafor', driver: 'sjafor',
  kunde: 'kunde', customer: 'kunde', kai: 'kai', quay: 'kai', person: 'person', folk: 'person',
};
/** «båt: coneste» → { scope: 'bat', q: 'coneste' }. Uten kjent prefiks: scope null. */
export function parseScope(raw: string): { scope: SearchScope | null; q: string } {
  const m = /^\s*([\p{L}]+):\s*(.*)$/u.exec(raw);
  const scope = m ? SCOPES[m[1].toLowerCase()] : undefined;
  return scope ? { scope, q: m![2].trim() } : { scope: null, q: raw.trim() };
}

export type SearchActionKind = 'bulk' | 'bil' | 'so' | 'bat';
export interface SearchAction { kind: SearchActionKind; text: string }
const ACTION_WORDS: [RegExp, SearchActionKind][] = [
  [/^(?:ny|new)\s+(?:bulklasting|bulk|lasting|loading)\b\s*(.*)$/i, 'bulk'],
  [/^(?:ny|new)\s+(?:bilhenting|henting|bil|truck|pickup)\b\s*(.*)$/i, 'bil'],
  [/^(?:ny|nytt|new)\s+(?:salgsordre|so|ordre|anløp|anlop|order|call)\b\s*(.*)$/i, 'so'],
  [/^(?:(?:ny|new)\s+(?:båt|bat|boat)|legg til båt|legg til bat|add boat)\b\s*(.*)$/i, 'bat'],
];
/** Handlinger søket kan starte. Når teksten bare er «ny» (eller starten av det) vises alle. */
export function parseActions(raw: string): SearchAction[] {
  const q = raw.trim();
  for (const [re, kind] of ACTION_WORDS) {
    const m = re.exec(q);
    if (m) return [{ kind, text: m[1].trim() }];
  }
  if (/^(n|ny|nyt|nytt|ne|new|legg|legg til)$/i.test(q)) return (['bulk', 'bil', 'so', 'bat'] as const).map(kind => ({ kind, text: '' }));
  return [];
}

const QUESTION_START = /^(hvem|hva|hvilk|hvor|når|hvordan|hvorfor|kan|er|har|vis meg|gi meg|finn|list|sammenlign|who|what|which|where|when|how|why|show|kuris|kas|kiek|kada|hvad|hvilke|vem|vad|vilk|var |hur|hver|hvað|hvaða|hvar|hvenær)/i;
/** Ser teksten ut som et spørsmål til «Spør Flow»? */
export function looksLikeQuestion(raw: string): boolean {
  const q = raw.trim();
  if (q.length < 8) return false;
  return q.endsWith('?') || (QUESTION_START.test(q) && q.split(/\s+/).length >= 3);
}

/** Reg.nr. som «SU 20 110», «SU20110» eller «EL 12908». */
export const REG_NO = /^[a-zæøå]{2}\s?\d{2}\s?\d{3,4}$/i;
/** Prosjektnummer som «P-2631». */
export const PROJECT_NO = /^p-?\d{2,}$/i;
