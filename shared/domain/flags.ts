import { CATEGORY_LABEL, type Category, type Flag, type FlagRules } from './types.ts';

export interface FlagInput {
  count: number;
  avg_punctuality: number | null;
  avg_cooperation: number | null;
  avg_equipment: number | null;
  avg_total: number | null;
  /** Kaibøkene, nyeste først. Trenger bare de siste par stykkene. */
  recent: { had_deviation: boolean; categories: Category[] }[];
}

const fr = (n: number) => n.toFixed(1).replace('.', ',');

export function autoFlag(b: FlagInput, rules: FlagRules): { flag: Flag; reason: string } {
  if (!b.count || b.avg_total == null) return { flag: 'none', reason: 'Ny i kaiboka – ingen erfaringer ennå.' };

  if (b.avg_total < rules.red_avg_below) return { flag: 'red', reason: `Lav snittvurdering: ${fr(b.avg_total)} av 5.` };
  for (const log of b.recent.slice(0, rules.red_lookback)) {
    const serious = log.categories.filter(c => rules.red_categories.includes(c));
    if (serious.length) {
      return { flag: 'red', reason: `${serious.map(c => CATEGORY_LABEL[c]).join(' og ')} ved et av de siste anløpene.` };
    }
  }

  if (b.avg_total < rules.yellow_avg_below) return { flag: 'yellow', reason: `Snittvurdering ${fr(b.avg_total)} av 5.` };
  const dims: [string, number | null][] = [
    ['punktlighet', b.avg_punctuality],
    ['samarbeidsvilje', b.avg_cooperation],
    ['utstyr / kran', b.avg_equipment],
  ];
  const weak = dims.filter(([, v]) => v != null && v < rules.yellow_dimension_below) as [string, number][];
  if (weak.length) return { flag: 'yellow', reason: `Lav ${weak.map(([l, v]) => `${l} (${fr(v)})`).join(', ')}.` };
  const last = b.recent[0];
  if (last?.had_deviation) {
    const cats = last.categories.map(c => CATEGORY_LABEL[c].toLowerCase()).join(', ');
    return { flag: 'yellow', reason: `Avvik ved forrige anløp${cats ? ` (${cats})` : ''}.` };
  }

  let clean = 0;
  for (const log of b.recent) { if (log.had_deviation) break; clean++; }
  return { flag: 'green', reason: clean > 1 ? `Ingen avvik siste ${clean} anløp.` : 'Ingen avvik ved forrige anløp.' };
}

export function effectiveFlag(b: { flag_auto: Flag; flag_override: Flag | null }): Flag {
  return b.flag_override ?? b.flag_auto;
}
