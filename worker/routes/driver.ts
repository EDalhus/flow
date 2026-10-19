import { Hono } from 'hono';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import type { BulkQuality, DriverMe, Lang, Vehicle } from '../../shared/api.ts';
import { normalizePhone } from '../../shared/domain/bulk.ts';
import { bulkOrderCreate, driverLogin } from '../../shared/schemas.ts';
import { osloToUtc, todayOslo } from '../../shared/time.ts';
import { readWeighed, bulkAct, createBulkOrder, loadBulk, loadBulkOne, pdfResponse, type Actor, type BulkAction } from '../db/bulk.ts';
import { AskError, driverHelp } from '../lib/ask.ts';
import { body, fail, nowIso } from '../lib/http.ts';
import { newToken, sha256, verifyPin } from '../lib/pin.ts';
import { publish } from '../lib/realtime.ts';
import type { AppEnv } from '../types.ts';

// Sjåførvisningen (/sjafor): egen innlogging med telefon + PIN, skilt fra resten av Flow.
// En sjåfør ser bare sine egne lastinger, bilene til sitt transportfirma og kundelisten.
// Med Cloudflare Access må /sjafor og /api/driver/* unntas (Bypass) i Access-policyen.

type Driver = { id: string; name: string; phone: string; lang: string; hauler_id: string; hauler_name: string };
type DriverEnv = AppEnv & { Variables: { driver: Driver } };
const app = new Hono<DriverEnv>();

const SESSION_DAYS = 30;
const MAX_TRIES = 5;
const LOCK_MIN = 10;

/** Innlogging: telefon + PIN. Fem feil på rad låser kontoen i ti minutter. */
app.post('/login', body(driverLogin), async c => {
  const { phone, pin } = c.req.valid('json');
  const db = c.env.DB;
  const d = await db.prepare('SELECT id, pin_hash, pin_salt, failed_logins, locked_until FROM drivers WHERE phone = ? AND active = 1')
    .bind(normalizePhone(phone)).first<{ id: string; pin_hash: string | null; pin_salt: string | null; failed_logins: number; locked_until: string | null }>();
  const wrong = () => fail(401, 'Feil telefonnummer eller PIN.');
  if (!d || !d.pin_hash || !d.pin_salt) throw wrong();
  if (d.locked_until && d.locked_until > nowIso()) throw fail(429, 'For mange forsøk. Prøv igjen om noen minutter.');
  if (!(await verifyPin(pin, d.pin_hash, d.pin_salt))) {
    const tries = d.failed_logins + 1;
    await db.prepare('UPDATE drivers SET failed_logins = ?, locked_until = ? WHERE id = ?')
      .bind(tries >= MAX_TRIES ? 0 : tries, tries >= MAX_TRIES ? new Date(Date.now() + LOCK_MIN * 60_000).toISOString() : null, d.id).run();
    throw wrong();
  }
  const token = newToken();
  await db.batch([
    db.prepare('INSERT INTO driver_sessions (token_hash, driver_id, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256(token), d.id, new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString()),
    db.prepare('UPDATE drivers SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').bind(nowIso(), d.id),
  ]);
  return c.json({ token });
});

const requireDriver = createMiddleware<DriverEnv>(async (c, next) => {
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) throw fail(401, 'Ikke innlogget.');
  const d = await c.env.DB.prepare(`SELECT d.id, d.name, d.phone, d.lang, d.hauler_id, h.name AS hauler_name
                                    FROM driver_sessions s JOIN drivers d ON d.id = s.driver_id JOIN haulers h ON h.id = d.hauler_id
                                    WHERE s.token_hash = ? AND s.expires_at > ? AND d.active = 1`)
    .bind(await sha256(token), nowIso()).first<Driver>();
  if (!d) throw fail(401, 'Innloggingen har utløpt. Logg inn på nytt.');
  c.set('driver', d);
  await next();
});
app.use('*', requireDriver);

const me = (d: Driver): Actor => ({ userId: null, driverId: d.id, name: d.name });

app.post('/logout', async c => {
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  await c.env.DB.prepare('DELETE FROM driver_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return c.json({ ok: true });
});

/** Alt sjåførvisningen trenger: sjåføren, bilene, kunder, kvaliteter og egne lastinger (åpne, kommende og dagens). */
app.get('/me', async c => {
  const d = c.get('driver');
  const db = c.env.DB;
  const [vehicles, customers, qualities] = await db.batch([
    db.prepare('SELECT id, reg_no, hauler_id, description, has_trailer, active FROM vehicles WHERE hauler_id = ? AND active = 1 ORDER BY reg_no').bind(d.hauler_id),
    db.prepare('SELECT id, name, requires_project FROM bulk_customers WHERE active = 1 ORDER BY name'),
    db.prepare('SELECT id, name, color FROM bulk_qualities WHERE active = 1 ORDER BY sort'),
  ]);
  const since = osloToUtc(todayOslo(), 0);
  const orders = await loadBulk(db, `o.driver_profile_id = ? AND (o.status IN ('bestilt', 'lastes') OR o.finished_at >= ?)`, [d.id, since]);
  return c.json({
    driver: { id: d.id, name: d.name, phone: d.phone, lang: d.lang, hauler: { id: d.hauler_id, name: d.hauler_name } },
    vehicles: (vehicles.results as (Omit<Vehicle, 'has_trailer' | 'active'> & { has_trailer: number; active: number })[]).map(v => ({ ...v, has_trailer: !!v.has_trailer, active: !!v.active })),
    customers: (customers.results as { id: string; name: string; requires_project: number }[]).map(x => ({ ...x, requires_project: !!x.requires_project })),
    qualities: qualities.results as BulkQuality[],
    orders,
    ai: !!c.env.ANTHROPIC_API_KEY?.trim(),
  } satisfies DriverMe);
});

app.put('/me/lang', body(z.object({ lang: z.enum(['nb', 'en', 'lt', 'da', 'sv', 'is']) })), async c => {
  await c.env.DB.prepare('UPDATE drivers SET lang = ? WHERE id = ?').bind(c.req.valid('json').lang, c.get('driver').id).run();
  return c.json({ ok: true });
});

/** Bestill: nå (ved ankomst) eller frem i tid (ca. tid). Bare biler fra sjåførens eget transportfirma. */
app.post('/orders', body(bulkOrderCreate), async c => {
  const d = c.get('driver');
  const order = await createBulkOrder(c.env.DB, c.req.valid('json'), me(d), d.id, d.hauler_id);
  publish(c as unknown as Context<AppEnv>, { type: 'bulk.changed' });
  return c.json(order, 201);
});

async function own(c: { env: Env; get: (k: 'driver') => Driver }, id: string) {
  const o = await loadBulkOne(c.env.DB, id);
  if (!o || o.driver_profile?.id !== c.get('driver').id) throw fail(404, 'Fant ikke bestillingen.');
  return o;
}

app.post('/orders/:id/:action{start|step-done|stop|continue|cancel}', async c => {
  const o = await own(c, c.req.param('id'));
  const action = c.req.param('action') as BulkAction;
  const weighed = action === 'step-done' ? await readWeighed(c.req.raw) : undefined;
  const view = await bulkAct(c.env, o, action, me(c.get('driver')), weighed);
  publish(c as unknown as Context<AppEnv>, { type: 'bulk.changed' });
  return c.json(view);
});

/** Hjelp i sjåførvisningen (Claude, ut fra håndboka for sjåfører). Maks 20 spørsmål i timen. */
app.post('/help', body(z.object({
  question: z.string().trim().min(2).max(500),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(3000) })).max(200).default([]).transform(h => h.slice(-12)),
})), async c => {
  const d = c.get('driver');
  const { question, history } = c.req.valid('json');
  const db = c.env.DB;
  const used = await db.prepare('SELECT count(*) AS n FROM ai_questions WHERE driver_id = ? AND created_at >= ?').bind(d.id, new Date(Date.now() - 3_600_000).toISOString()).first<{ n: number }>();
  if ((used?.n ?? 0) >= 20) throw fail(429, 'Du har stilt mange spørsmål den siste timen. Prøv igjen litt senere.');
  try {
    const answer = await driverHelp(c.env, question, (d.lang as Lang) ?? 'nb', history);
    await db.prepare('INSERT INTO ai_questions (driver_id, question, answer, tools) VALUES (?, ?, ?, ?)').bind(d.id, question, answer, '[]').run();
    return c.json({ answer });
  } catch (e) {
    if (e instanceof AskError) throw fail(e.status, e.message);
    throw e;
  }
});

app.get('/orders/:id/pdf', async c => pdfResponse(c.env, await own(c, c.req.param('id'))));

export default app;
