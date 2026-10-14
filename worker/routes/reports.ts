import { Hono } from 'hono';
import { z } from 'zod';
import { reportQuery } from '../../shared/schemas.ts';
import { isoWeek, todayOslo } from '../../shared/time.ts';
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

export default app;
