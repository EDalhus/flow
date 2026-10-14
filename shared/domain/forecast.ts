// Prognose = fjorårets tall for samme uke × årets trend siste N uker.
// Trend = sum(i år, siste N faktiske uker) / sum(i fjor, samme uker).

export interface ForecastResult {
  trend: number;
  /** Faktisk for uker ≤ lastActualWeek, prognose etter. Indeks 0 = uke 1. */
  values: number[];
}

export function forecastSeries(prev: number[], cur: number[], lastActualWeek: number, trendWeeks = 8): ForecastResult {
  const from = Math.max(0, lastActualWeek - trendWeeks);
  let sumCur = 0, sumPrev = 0;
  for (let i = from; i < lastActualWeek; i++) { sumCur += cur[i] ?? 0; sumPrev += prev[i] ?? 0; }
  const trend = sumPrev > 0 ? sumCur / sumPrev : 1;
  const values = prev.map((p, i) => (i < lastActualWeek ? cur[i] ?? 0 : (p ?? 0) * trend));
  return { trend, values };
}

export const sum = (arr: number[], from = 0, to = arr.length) => {
  let s = 0;
  for (let i = from; i < Math.min(to, arr.length); i++) s += arr[i] ?? 0;
  return s;
};
