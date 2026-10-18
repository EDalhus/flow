import type { Lang } from '../../../shared/api.ts';

// Språk: all tekst i grensesnittet skrives på norsk og sendes gjennom tr(). Den norske teksten er
// nøkkelen i ordbøkene (web/src/i18n/*.ts), med {navn} for verdier som settes inn.
// Tekst som kommer ferdig fra serveren (varsler, kollisjoner, feilmeldinger, flaggbegrunnelser)
// oversettes med tx(), som også kjenner igjen maler med verdier i.
// `npm run i18n:check` sjekker at alle tekster finnes i alle språk.

export type Dict = Record<string, string>;
type Vars = Record<string, string | number>;

const LOADERS: Record<Exclude<Lang, 'nb'>, () => Promise<{ default: Dict }>> = {
  en: () => import('../i18n/en.ts'),
  lt: () => import('../i18n/lt.ts'),
  da: () => import('../i18n/da.ts'),
  sv: () => import('../i18n/sv.ts'),
  is: () => import('../i18n/is.ts'),
};

const LOCALE: Record<Lang, string> = { nb: 'nb-NO', en: 'en-GB', lt: 'lt-LT', da: 'da-DK', sv: 'sv-SE', is: 'is-IS' };

let lang: Lang = 'nb';
let dict: Dict = {};
let templates: { re: RegExp; names: string[]; out: string }[] | null = null;

/** Henter ordboka for språket og tar den i bruk. Norsk trenger ingen ordbok. */
export async function loadLang(l: Lang): Promise<void> {
  const d = l === 'nb' ? {} : (await LOADERS[l]()).default;
  lang = l;
  dict = d;
  templates = null;
  document.documentElement.lang = l === 'nb' ? 'no' : l;
}

export const getLang = () => lang;
/** Språkkode for Intl (datoer, tall). */
export const locale = () => LOCALE[lang];

// Feltnavn kan ha æ, ø og å ({år}, {båt}).
const FIELD = /\{([\p{L}\d_]+)\}/gu;
const fill = (s: string, vars?: Vars) => (vars ? s.replace(FIELD, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

/**
 * Entall og flertall: en oversettelse kan ha former skilt med «|», valgt etter {n} med språkets
 * regler (Intl.PluralRules). To former: «én|flere». Tre (litauisk): «one|few|other».
 */
function plural(s: string, vars?: Vars): string {
  if (!s.includes('|') || typeof vars?.n !== 'number') return s.split('|').pop()!;
  const forms = s.split('|');
  const cat = new Intl.PluralRules(LOCALE[lang]).select(vars.n);
  if (forms.length === 2) return cat === 'one' ? forms[0] : forms[1];
  return cat === 'one' ? forms[0] : cat === 'few' ? forms[1] : forms[forms.length - 1];
}

/** Oversetter en norsk tekst. `vars` settes inn for {navn}. */
export function tr(nb: string, vars?: Vars): string {
  return fill(plural(dict[nb] ?? nb, vars), vars);
}

const esc = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

/**
 * Oversetter tekst som allerede er satt sammen (fra serveren). Først direkte oppslag, så maler:
 * «Ingen avvik siste {n} anløp.» kjenner igjen «Ingen avvik siste 3 anløp.». Verdiene som fanges,
 * oversettes også hvis de selv er kjente tekster (f.eks. kategorinavn).
 */
export function tx(text: string | null | undefined): string {
  if (!text) return text ?? '';
  if (lang === 'nb') return text;
  if (dict[text]) return plural(dict[text]);
  templates ??= Object.entries(dict)
    .filter(([k]) => /\{[\p{L}\d_]+\}/u.test(k))
    .sort((a, b) => b[0].replace(FIELD, '').length - a[0].replace(FIELD, '').length)
    .map(([k, out]) => {
      const names: string[] = [];
      const re = new RegExp(`^${k.split(/(\{[\p{L}\d_]+\})/u).map(p => { const m = /^\{([\p{L}\d_]+)\}$/u.exec(p); if (m) { names.push(m[1]); return '(.+?)'; } return esc(p); }).join('')}$`, 's');
      return { re, names, out };
    });
  for (const t of templates) {
    const m = t.re.exec(text);
    if (!m) continue;
    const vars: Vars = {};
    t.names.forEach((n, i) => { vars[n] = n === 'n' && /^\d+$/.test(m[i + 1]) ? Number(m[i + 1]) : tx(m[i + 1]); });
    return fill(plural(t.out, vars), vars);
  }
  return text;
}

/** Språkene i velgeren, skrevet på sitt eget språk. */
export const LANGS: { value: Lang; label: string }[] = [
  { value: 'nb', label: 'Norsk' },
  { value: 'en', label: 'English' },
  { value: 'lt', label: 'Lietuvių' },
  { value: 'da', label: 'Dansk' },
  { value: 'sv', label: 'Svenska' },
  { value: 'is', label: 'Íslenska' },
];
