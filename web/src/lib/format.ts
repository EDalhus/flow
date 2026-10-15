import type { GoodsView, PortCallView } from '../../../shared/api.ts';
import { isOwnQuay, quayLabel, quayTitle } from '../../../shared/domain/quay.ts';
import type { CallStatus, Flag } from '../../../shared/domain/types.ts';
import { addDays, osloTime, serviceDate, todayOslo } from '../../../shared/time.ts';

export { addDays, isOwnQuay, osloTime, quayLabel, quayTitle, serviceDate, todayOslo };

/** 4.6 → "4,6" */
export const fr = (n: number | null | undefined, digits = 1) => (n == null ? '–' : n.toFixed(digits).replace('.', ','));
/** 76674 → "76 674" (smalt mellomrom som i designet). */
export const nb = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
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

/** "I dag · onsdag 14. oktober", "Torsdag 15. oktober" */
export function dayHeading(date: string, today = todayOslo()): string {
  const p = dateParts(date);
  const long = `${p.wd} ${p.day}. ${p.month}`;
  if (date === today) return `I dag · ${long}`;
  if (date === addDays(today, 1)) return `I morgen · ${long}`;
  return cap(long);
}
/** "Ons 14. okt" */
export function dayShort(date: string): string {
  const p = dateParts(date);
  return `${cap(p.wd.slice(0, 3))} ${p.day}. ${p.month.slice(0, 3)}`;
}
/** "I dag", "I morgen", "Fre 16.10" */
export function dayRelative(date: string, today = todayOslo()): string {
  if (date === today) return 'I dag';
  if (date === addDays(today, 1)) return 'I morgen';
  return `${cap(dateParts(date).wd.slice(0, 3))} ${date.slice(8, 10)}.${date.slice(5, 7)}`;
}
/** "14.10" */
export const ddmm = (iso: string) => { const d = serviceDate(iso); return `${d.slice(8, 10)}.${d.slice(5, 7)}`; };

export const STATUS_STYLE: Record<CallStatus, { label: string; c: string; bg: string; solid: string; solidFg: string }> = {
  ved_kai: { label: 'Ved kai', c: '#5BD68A', bg: 'rgba(91,214,138,.15)', solid: '#3DBE6E', solidFg: '#0B0E11' },
  paa_vei: { label: 'På vei', c: '#9DB8FF', bg: 'rgba(157,184,255,.15)', solid: '#9DB8FF', solidFg: '#0B0E11' },
  planlagt: { label: 'Planlagt', c: '#C9D0D5', bg: 'rgba(201,208,213,.12)', solid: 'rgba(255,255,255,.12)', solidFg: '#F3F5F6' },
  kaibok_mangler: { label: 'Kaibok mangler', c: '#F7C873', bg: 'rgba(247,185,85,.15)', solid: '#F7B955', solidFg: '#0B0E11' },
  ferdig: { label: 'Ferdig', c: '#A3ACB3', bg: 'rgba(163,172,179,.12)', solid: 'rgba(255,255,255,.1)', solidFg: '#C9D0D5' },
  avlyst: { label: 'Avlyst', c: '#A3ACB3', bg: 'rgba(163,172,179,.12)', solid: 'rgba(255,255,255,.1)', solidFg: '#C9D0D5' },
};

export const FLAG_STYLE: Record<Flag, { label: string; c: string; bg: string; dot: string }> = {
  green: { label: 'Grønt', c: '#7FE0A3', bg: 'rgba(91,214,138,.13)', dot: '#5BD68A' },
  yellow: { label: 'Gult varsel', c: '#F7C873', bg: 'rgba(247,185,85,.14)', dot: '#F7B955' },
  red: { label: 'Rødt flagg', c: '#FF8A80', bg: 'rgba(255,107,94,.15)', dot: '#FF6B5E' },
  none: { label: 'Ingen historikk', c: '#C9D0D5', bg: 'rgba(201,208,213,.1)', dot: '#A3ACB3' },
};

export const ratingColor = (v: number) => (v >= 4 ? '#5BD68A' : v >= 3 ? '#F7B955' : '#FF6B5E');

/** Kort varetekst for lister: "120 pall Hav salt (Europall) · 60 pall Sukker salt 1:2 (SRS)" */
export const goodsShort = (goods: GoodsView[]) =>
  goods.map(g => `${g.quantity} ${g.unit} ${g.product_name}${g.pallet_type ? ` (${g.pallet_type === 'srs' ? 'SRS' : 'Europall'})` : ''}`).join(' · ');

/** For detaljvisning: ["120 pall", "Hav salt · 25 kg × 40 · Europall"] */
export const goodsParts = (g: GoodsView): [string, string] => [
  `${g.quantity} ${g.unit}`,
  g.unit === 'pall' ? `${g.product_name} · 25 kg × ${g.bags_per_unit} · ${g.pallet_type === 'srs' ? 'SRS-pall' : 'Europall'}` : g.product_name,
];

export const timeRange = (c: Pick<PortCallView, 'eta' | 'etd'>) => `${osloTime(c.eta)}–${osloTime(c.etd)}`;
export const typeLabel = (t: string) => (t === 'levering' ? 'Levering' : 'Henting');

export const telHref = (phone: string) => `tel:${phone.replace(/\s/g, '')}`;
export const telShort = (phone: string) => phone.replace(/^\+47\s?/, '');

/** Ansvarlig-tekst slik listene i designet viser den. */
export function crewSummary(c: PortCallView) {
  const open = c.crew.filter(s => !s.user).length;
  const done = c.status === 'ferdig';
  return {
    ansText: c.responsible ? `Ansvarlig ${c.responsible.short_name}` : 'Ansvarlig ikke valgt',
    ansWarn: !done && (!c.responsible || open > 0),
    open,
    crewText: `${c.crew.length} ${c.crew.length === 1 ? 'rolle' : 'roller'}${open ? ` · ${open} uten navn` : ''}${c.boat_crane ? ' · båtkran' : ''}`,
  };
}

/** ISO → "07:30" i Oslo-tid (til <input type="time">). */
export const hmFromIso = (iso: string) => osloTime(iso);
