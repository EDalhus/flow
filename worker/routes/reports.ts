import { Hono } from 'hono';
import { z } from 'zod';
import { reportQuery } from '../../shared/schemas.ts';
import { addDays, isoWeek, todayOslo } from '../../shared/time.ts';
import { buildProducts, buildWeekly, loadFacts, loadQuality } from '../db/reports.ts';
import { fail, query } from '../lib/http.ts';
import { loadSettings } from '../lib/settings.ts';
import type { AppEnv } from '../types.ts';

const app = new Hono<AppEnv>();

/** Tonn og anløp per uke, i år mot i fjor, med prognose. Filter: product_id, direction. */
app.get('/weekly', query(reportQuery), async c => {
  const q = c.req.valid('query');
  const today = todayOslo();
  const year = q.year ?? isoWeek(today).year;
  if (q.product_id) {
    const p = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(q.product_id).first();
    if (!p) throw fail(400, 'Ukjent produkt.', { field: 'product_id' });
  }
  const facts = await loadFacts(c.env.DB, year);
  return c.json(buildWeekly(facts, year, today, { product_id: q.product_id, direction: q.direction }));
});

/** Per produkt: hittil i år mot samme uker i fjor, og prognose for resten av året. */
app.get('/products', query(reportQuery.omit({ product_id: true })), async c => {
  const q = c.req.valid('query');
  const today = todayOslo();
  const year = q.year ?? isoWeek(today).year;
  const [facts, { results }] = await Promise.all([
    loadFacts(c.env.DB, year),
    c.env.DB.prepare(`
      SELECT p.id, p.name,
        CASE WHEN sum(s.unit = 'BB') > 0 AND sum(s.unit = 'pall') > 0 THEN 'BB + pall'
             WHEN sum(s.unit = 'pall') > 0 THEN 'Pall' ELSE 'BB' END AS packaging
      FROM products p JOIN skus s ON s.product_id = p.id AND s.active = 1
      GROUP BY p.id ORDER BY p.sort`).all<{ id: string; name: string; packaging: string }>(),
  ]);
  return c.json(buildProducts(facts, year, today, q.direction, results));
});

/** Punktlighet, avvik per kategori og snittvurdering per båt. */
app.get('/quality', query(z.object({ weeks: z.coerce.number().int().min(1).max(52).default(8) })), async c => {
  const { weeks } = c.req.valid('query');
  const settings = await loadSettings(c.env.DB);
  return c.json(await loadQuality(c.env.DB, todayOslo(), weeks, settings.punctuality_window_minutes));
});

/**
 * Tonn og anløp siste N dager mot de N dagene før (hovedtallene på kartet).
 * «Ut» = utlevert fra kaia (henting), «inn» = mottatt (levering). Bare ferdige anløp.
 */
app.get('/summary', query(z.object({ days: z.coerce.number().int().min(1).max(366).default(30) })), async c => {
  const { days } = c.req.valid('query');
  const today = todayOslo();
  const from = addDays(today, -(days - 1));
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const window = async (a: string, b: string) => {
    const [dirs, calls] = await c.env.DB.batch([
      c.env.DB.prepare(`
        SELECT g.direction, sum(g.quantity * s.kg_per_unit) / 1000.0 AS tonnes, count(DISTINCT pc.id) AS calls
        FROM port_calls pc JOIN port_call_goods g ON g.port_call_id = pc.id JOIN skus s ON s.id = g.sku_id
        WHERE pc.completed_at IS NOT NULL AND pc.cancelled_at IS NULL AND pc.service_date BETWEEN ? AND ?
        GROUP BY g.direction`).bind(a, b),
      c.env.DB.prepare(`SELECT count(*) AS n FROM port_calls WHERE completed_at IS NOT NULL AND cancelled_at IS NULL AND service_date BETWEEN ? AND ?`).bind(a, b),
    ]);
    const by = Object.fromEntries((dirs.results as { direction: string; tonnes: number; calls: number }[]).map(r => [r.direction, r]));
    const r1 = (n: number | undefined) => Math.round((n ?? 0) * 10) / 10;
    return {
      out: { tonnes: r1(by.ut?.tonnes), calls: by.ut?.calls ?? 0 },
      in: { tonnes: r1(by.inn?.tonnes), calls: by.inn?.calls ?? 0 },
      calls: (calls.results[0] as { n: number }).n,
    };
  };
  const [current, previous] = await Promise.all([window(from, today), window(prevFrom, prevTo)]);
  return c.json({ days, from, to: today, ...current, prev: { from: prevFrom, to: prevTo, ...previous } });
});

export default app;
