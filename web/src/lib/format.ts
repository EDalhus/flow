import type { GoodsView, PortCallView } from '../../../shared/api.ts';
import { isOwnQuay, quayLabel, quayTitle } from '../../../shared/domain/quay.ts';
import type { CallStatus, Flag } from '../../../shared/domain/types.ts';
import { addDays, osloTime, serviceDate, todayOslo } from '../../../shared/time.ts';
import { getLang, locale, tr } from './i18n.ts';

export { addDays, isOwnQuay, osloTime, quayLabel, quayTitle, serviceDate, todayOslo };

/** 4.6 → "4,6" */
export const fr = (n: number | null | undefined, digits = 1) => (n == null ? '–' : getLang() === 'en' ? n.toFixed(digits) : n.toFixed(digits).replace('.', ','));
/** 76674 → "76 674" (smalt mellomrom som i designet). */
export const nb = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, getLang() === 'en' ? ',' : ' ');
/** Endring i prosent: "+5 %", "−3 %", "±0 %". */
export function pct(a: number, b: number): string {
  if (!b) return '–';
  const p = Math.round((a / b - 1) * 100);
  return `${p > 0 ? '+' : p < 0 ? '−' : '±'}${Math.abs(p)} %`;
}
export const arrow = (a: number, b: number) => (!b ? '' : a / b - 1 > 0.02 ? '▲ ' : a / b - 1 < -0.02 ? '▼ ' : '');

const WEEKDAYS = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const MONTHS = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
const dateParts = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return { wd: WEEKDAYS[d.getUTCDay()], day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()] };
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Dato på brukerens språk (andre språk enn norsk), via Intl. */
const intl = (date: string, o: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString(locale(), { ...o, timeZone: 'UTC' }).replace(/\.$/, '');
const nbLang = () => getLang() === 'nb';

/** "I dag · onsdag 14. oktober", "Torsdag 15. oktober" */
export function dayHeading(date: string, today = todayOslo()): string {
  const p = dateParts(date);
  const long = nbLang() ? `${p.wd} ${p.day}. ${p.month}` : intl(date, { weekday: 'long', day: 'numeric', month: 'long' });
  if (date === today) return `${tr('I dag')} · ${long}`;
  if (date === addDays(today, 1)) return `${tr('I morgen')} · ${long}`;
  return cap(long);
}
/** "Ons 14. okt" */
export function dayShort(date: string): string {
  const p = dateParts(date);
  if (!nbLang()) return cap(intl(date, { weekday: 'short', day: 'numeric', month: 'short' }));
  return `${cap(p.wd.slice(0, 3))} ${p.day}. ${p.month.slice(0, 3)}`;
}
/** "I dag", "I morgen", "Fre 16.10" */
export function dayRelative(date: string, today = todayOslo()): string {
  if (date === today) return tr('I dag');
  if (date === addDays(today, 1)) return tr('I morgen');
  const wd = nbLang() ? dateParts(date).wd.slice(0, 3) : intl(date, { weekday: 'short' });
  return `${cap(wd)} ${date.slice(8, 10)}.${date.slice(5, 7)}`;
}
/** "14.10" */
export const ddmm = (iso: string) => { const d = serviceDate(iso); return `${d.slice(8, 10)}.${d.slice(5, 7)}`; };

export const STATUS_STYLE: Record<CallStatus, { label: string; c: string; bg: string; solid: string; solidFg: string }> = {
  ved_kai: { get label() { return tr('Ved kai'); }, c: '#5BD68A', bg: 'rgba(91,214,138,.15)', solid: '#3DBE6E', solidFg: '#1A231E' },
  paa_vei: { get label() { return tr('På vei'); }, c: '#80EFDE', bg: 'rgba(128,239,222,.15)', solid: '#80EFDE', solidFg: '#1A231E' },
  planlagt: { get label() { return tr('Planlagt'); }, c: '#C9D6CD', bg: 'rgba(177,194,183,.12)', solid: 'rgba(var(--tint), .12)', solidFg: '#F2F5F3' },
  kaibok_mangler: { get label() { return tr('Kaibok mangler'); }, c: '#F7C873', bg: 'rgba(247,185,85,.15)', solid: '#F7B955', solidFg: '#1A231E' },
  ferdig: { get label() { return tr('Ferdig'); }, c: '#B1C2B7', bg: 'rgba(177,194,183,.12)', solid: 'rgba(var(--tint), .1)', solidFg: '#C9D6CD' },
  avlyst: { get label() { return tr('Avlyst'); }, c: '#B1C2B7', bg: 'rgba(177,194,183,.12)', solid: 'rgba(var(--tint), .1)', solidFg: '#C9D6CD' },
};

export const FLAG_STYLE: Record<Flag, { label: string; c: string; bg: string; dot: string }> = {
  green: { get label() { return tr('Grønt'); }, c: '#7FE0A3', bg: 'rgba(91,214,138,.13)', dot: '#5BD68A' },
  yellow: { get label() { return tr('Gult varsel'); }, c: '#F7C873', bg: 'rgba(247,185,85,.14)', dot: '#F7B955' },
  red: { get label() { return tr('Rødt flagg'); }, c: '#FF8A80', bg: 'rgba(255,107,94,.15)', dot: '#FF6B5E' },
  none: { get label() { return tr('Ingen historikk'); }, c: '#C9D6CD', bg: 'rgba(177,194,183,.1)', dot: '#B1C2B7' },
};

/** Rollenavn (norsk; vises med tr()). */
export const ROLE_NAMES: Record<string, string> = { salg: 'Salg', produksjon: 'Produksjon', kaiarbeider: 'Kaiarbeider', admin: 'Admin' };

export const ratingColor = (v: number) => (v >= 4 ? '#5BD68A' : v >= 3 ? '#F7B955' : '#FF6B5E');

/** Enhet: BB (bigbag) eller pall. */
export const unitLabel = (u: string) => (u === 'pall' ? tr('pall') : u);

/** Kort varetekst for lister: "120 pall Hav salt (Europall) · 60 pall Sukker salt 1:2 (SRS)" */
export const goodsShort = (goods: GoodsView[]) =>
  goods.map(g => `${g.quantity} ${unitLabel(g.unit)} ${g.product_name}${g.pallet_type ? ` (${g.pallet_type === 'srs' ? 'SRS' : tr('Europall')})` : ''}`).join(' · ');

/** For detaljvisning: ["120 pall", "Hav salt · 25 kg × 40 · Europall"] */
export const goodsParts = (g: GoodsView): [string, string] => [
  `${g.quantity} ${unitLabel(g.unit)}`,
  g.unit === 'pall' ? `${g.product_name} · 25 kg × ${g.bags_per_unit} · ${g.pallet_type === 'srs' ? tr('SRS-pall') : tr('Europall')}` : g.product_name,
];

/** "07:30–11:00", eller "Tid ikke satt" når bare dagen er kjent. */
export const timeRange = (c: Pick<PortCallView, 'eta' | 'etd'> & { time_known?: boolean }) =>
  c.time_known === false ? tr('Tid ikke satt') : `${osloTime(c.eta)}–${osloTime(c.etd)}`;
export const typeLabel = (t: string) => (t === 'levering' ? tr('Levering') : t === 'begge' ? tr('Levering + henting') : tr('Henting'));

export const telHref = (phone: string) => `tel:${phone.replace(/\s/g, '')}`;
export const telShort = (phone: string) => phone.replace(/^\+47\s?/, '');

/** Ansvarlig-tekst slik listene i designet viser den. */
export function crewSummary(c: PortCallView) {
  const open = c.crew.filter(s => !s.user).length;
  const done = c.status === 'ferdig';
  return {
    ansText: c.responsible ? tr('Ansvarlig {navn}', { navn: c.responsible.short_name }) : tr('Ansvarlig ikke valgt'),
    ansWarn: !done && (!c.responsible || open > 0),
    open,
    crewText: `${c.crew.length === 1 ? tr('1 rolle') : tr('{n} roller', { n: c.crew.length })}${open ? ` · ${tr('{n} uten navn', { n: open })}` : ''}${c.boat_crane ? ` · ${tr('båtkran')}` : ''}`,
  };
}

/** ISO → "07:30" i Oslo-tid (til <input type="time">). */
export const hmFromIso = (iso: string) => osloTime(iso);

/** AIS-navn er i store bokstaver: «NORDKYN» → «Nordkyn», «MS NORD» → «MS Nord». */
export const titleCase = (s: string) => s.trim().toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
  .replace(/^(Ms|Mv|Mf|Fv)\b/, m => m.toUpperCase());
