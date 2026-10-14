import type { ProductReport, QualityReport, WeeklyReport } from '../../shared/api.ts';
import { forecastSeries, sum } from '../../shared/domain/forecast.ts';
import type { Category } from '../../shared/domain/types.ts';
import { addDays, isoWeek, isoWeekMonday, isoWeeksInYear } from '../../shared/time.ts';

// Rapportgrunnlag: alle ferdige anløp (kaibok levert, eller importert historikk),
// én rad per varelinje. Uke = ISO-uke for anløpets lokale dato.

export interface GoodsFact {
  call_id: string;
  service_date: string;
  product_id: string;
  direction: 'inn' | 'ut';
  kg: number;
}

export interface ReportFilter {
  product_id?: string;
  direction: 'begge' | 'inn' | 'ut';
}

export async function loadFacts(db: D1Database, year: number): Promise<GoodsFact[]> {
  const from = isoWeekMonday(year - 1, 1);
  const to = addDays(isoWeekMonday(year, isoWeeksInYear(year)), 6);
  const { results } = await db
    .prepare(`
      SELECT pc.id AS call_id, pc.service_date, s.product_id, g.direction, g.quantity * s.kg_per_unit AS kg
      FROM port_calls pc
      JOIN port_call_goods g ON g.port_call_id = pc.id
      JOIN skus s ON s.id = g.sku_id
      WHERE pc.completed_at IS NOT NULL AND pc.cancelled_at IS NULL AND pc.service_date BETWEEN ? AND ?`)
    .bind(from, to)
    .all<GoodsFact>();
  return results;
}

/** Siste uke med fullstendige tall: forrige uke i inneværende år, hele året for tidligere år. */
export function lastActualWeek(year: number, today: string): number {
  const now = isoWeek(today);
  if (year < now.year) return isoWeeksInYear(year);
  if (year > now.year) return 0;
  return now.week - 1;
}

interface Buckets {
  tonnes: Record<number, number[]>;
  calls: Record<number, number[]>;
}

/**
 * Har året 53 ISO-uker og fjoråret bare 52, finnes ingen fjorårsuke 53.
 * Da brukes fjorårets uke 52, så prognosen og sammenligningen ikke faller til null.
 */
function fillMissingWeek53(b: Buckets, year: number) {
  if (isoWeeksInYear(year) === 53 && isoWeeksInYear(year - 1) === 52) {
    b.tonnes[year - 1][52] = b.tonnes[year - 1][51];
    b.calls[year - 1][52] = b.calls[year - 1][51];
  }
  return b;
}

function bucket(facts: GoodsFact[], year: number, f: ReportFilter): Buckets {
  const n = 53;
  const tonnes: Record<number, number[]> = { [year - 1]: Array(n).fill(0), [year]: Array(n).fill(0) };
  const callSets: Record<number, Set<string>[]> = {
    [year - 1]: Array.from({ length: n }, () => new Set()),
    [year]: Array.from({ length: n }, () => new Set()),
  };
  for (const g of facts) {
    if (f.product_id && g.product_id !== f.product_id) continue;
    if (f.direction !== 'begge' && g.direction !== f.direction) continue;
    const w = isoWeek(g.service_date);
    if (!(w.year in tonnes)) continue;
    tonnes[w.year][w.week - 1] += g.kg / 1000;
    callSets[w.year][w.week - 1].add(g.call_id);
  }
  return fillMissingWeek53({
    tonnes,
    calls: Object.fromEntries(Object.entries(callSets).map(([y, sets]) => [y, sets.map(s => s.size)])),
  }, year);
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function buildWeekly(facts: GoodsFact[], year: number, today: string, f: ReportFilter): WeeklyReport {
  const weeks = isoWeeksInYear(year);
  const last = lastActualWeek(year, today);
  const b = bucket(facts, year, f);
  const prevT = b.tonnes[year - 1].slice(0, weeks), curT = b.tonnes[year].slice(0, weeks);
  const prevC = b.calls[year - 1].slice(0, weeks), curC = b.calls[year].slice(0, weeks);
  const ft = forecastSeries(prevT, curT, last);
  const fc = forecastSeries(prevC, curC, last);
  const fcCalls = fc.values.map(v => Math.round(v));

  let busiest: number | null = null;
  for (let i = last; i < weeks; i++) {
    if (busiest === null || fcCalls[i] > fcCalls[busiest] || (fcCalls[i] === fcCalls[busiest] && ft.values[i] > ft.values[busiest])) busiest = i;
  }

  return {
    year, prev_year: year - 1, last_actual_week: last, weeks_in_year: weeks,
    trend: { tonnes: ft.trend, calls: fc.trend },
    weeks: Array.from({ length: weeks }, (_, i) => {
      const actual = i < last;
      return {
        week: i + 1,
        kind: actual ? 'faktisk' : 'prognose',
        tonnes_prev: r1(prevT[i]), calls_prev: prevC[i],
        tonnes: actual ? r1(curT[i]) : null, calls: actual ? curC[i] : null,
        forecast_tonnes: actual ? null : r1(ft.values[i]), forecast_calls: actual ? null : fcCalls[i],
      };
    }),
    totals: {
      ytd_tonnes: r1(sum(curT, 0, last)), ytd_tonnes_prev: r1(sum(prevT, 0, last)),
      ytd_calls: sum(curC, 0, last), ytd_calls_prev: sum(prevC, 0, last),
      forecast_tonnes: r1(sum(ft.values, last)), forecast_tonnes_prev: r1(sum(prevT, last)),
      forecast_calls: sum(fcCalls, last),
    },
    outlook: {
      next4_tonnes: r1(sum(ft.values, last, last + 4)), next4_tonnes_prev: r1(sum(prevT, last, last + 4)),
      busiest_week: busiest === null ? null : busiest + 1,
      busiest_calls: busiest === null ? 0 : fcCalls[busiest], busiest_tonnes: busiest === null ? 0 : r1(ft.values[busiest]),
      busiest_calls_prev: busiest === null ? 0 : prevC[busiest], busiest_tonnes_prev: busiest === null ? 0 : r1(prevT[busiest]),
    },
  };
}

export function buildProducts(
  facts: GoodsFact[], year: number, today: string, direction: ReportFilter['direction'],
  products: { id: string; name: string; packaging: string }[],
): ProductReport {
  const weeks = isoWeeksInYear(year);
  const last = lastActualWeek(year, today);
  return {
    year, last_actual_week: last,
    rows: products.map(p => {
      const b = bucket(facts, year, { product_id: p.id, direction });
      const prev = b.tonnes[year - 1].slice(0, weeks), cur = b.tonnes[year].slice(0, weeks);
      const fc = forecastSeries(prev, cur, last);
      return {
        product_id: p.id, name: p.name, packaging: p.packaging,
        ytd_tonnes: r1(sum(cur, 0, last)), ytd_tonnes_prev: r1(sum(prev, 0, last)),
        forecast_tonnes: r1(sum(fc.values, last)), forecast_tonnes_prev: r1(sum(prev, last)),
        series_prev: prev.map(r1), series: fc.values.map(r1),
      };
    }),
  };
}

/** Punktlighet, avvik per kategori og snittvurdering per båt for de siste N ukene (inkl. inneværende). */
export async function loadQuality(db: D1Database, today: string, weeks: number, windowMinutes: number): Promise<QualityReport> {
  const now = isoWeek(today);
  const list = Array.from({ length: weeks }, (_, i) => isoWeek(addDays(isoWeekMonday(now.year, now.week), -7 * (weeks - 1 - i))));
  const from = isoWeekMonday(list[0].year, list[0].week);

  const [calls, cats, logs, boats] = await db.batch([
    db.prepare(`SELECT service_date, eta, arrived_at FROM port_calls
                WHERE completed_at IS NOT NULL AND cancelled_at IS NULL AND arrived_at IS NOT NULL AND service_date BETWEEN ? AND ?`).bind(from, today),
    db.prepare(`SELECT c.category, count(*) AS n FROM quay_log_categories c JOIN quay_logs ql ON ql.id = c.quay_log_id
                JOIN port_calls pc ON pc.id = ql.port_call_id WHERE pc.service_date BETWEEN ? AND ? GROUP BY c.category ORDER BY n DESC`).bind(from, today),
    db.prepare(`SELECT count(*) AS total, coalesce(sum(ql.had_deviation), 0) AS dev FROM quay_logs ql
                JOIN port_calls pc ON pc.id = ql.port_call_id WHERE pc.service_date BETWEEN ? AND ?`).bind(from, today),
    db.prepare(`SELECT id, name, avg_total, rating_count FROM boats WHERE active = 1 AND rating_count > 0 ORDER BY avg_total DESC`),
  ]);

  const window = windowMinutes * 60_000;
  const punctuality = list.map(w => ({ year: w.year, week: w.week, calls: 0, on_time: 0, share: null as number | null }));
  for (const c of calls.results as { service_date: string; eta: string; arrived_at: string }[]) {
    const w = isoWeek(c.service_date);
    const p = punctuality.find(x => x.year === w.year && x.week === w.week);
    if (!p) continue;
    p.calls++;
    if (Math.abs(Date.parse(c.arrived_at) - Date.parse(c.eta)) <= window) p.on_time++;
  }
  for (const p of punctuality) p.share = p.calls ? p.on_time / p.calls : null;

  const l = logs.results[0] as { total: number; dev: number };
  return {
    punctuality,
    deviations: {
      total_logs: l.total, with_deviation: l.dev,
      categories: (cats.results as { category: Category; n: number }[]).map(r => ({ category: r.category, count: r.n })),
    },
    boat_ratings: boats.results as QualityReport['boat_ratings'],
  };
}
