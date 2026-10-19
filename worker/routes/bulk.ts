import { Hono } from 'hono';
import { z } from 'zod';
import type { BulkCustomer, BulkQuality, BulkRegistry, DriverProfile, Hauler, Vehicle } from '../../shared/api.ts';
import { normalizePhone } from '../../shared/domain/bulk.ts';
import { bulkCustomerUpsert, bulkOrderCreate, driverUpsert, haulerUpsert, vehicleUpsert } from '../../shared/schemas.ts';
import { addDays, osloToUtc, todayOslo } from '../../shared/time.ts';
import { readWeighed, bulkAct, bulkReport, createBulkOrder, loadBulk, loadBulkLog, loadBulkOne, loadWeighings, pdfResponse, type Actor, type BulkAction } from '../db/bulk.ts';
import { body, fail, isConstraintError, newId, query } from '../lib/http.ts';
import { hashPin } from '../lib/pin.ts';
import { publish } from '../lib/realtime.ts';
import type { AppEnv } from '../types.ts';

// Bulkutlevering, kontorets side: kø, bestilling på vegne av sjåfør, veiinger, rapporter og registre
// (transportfirma, kunder, sjåfører, biler). Sjåførene bruker /api/driver (egen innlogging).
const app = new Hono<AppEnv>();

const actor = (u: { id: string; short_name: string }): Actor => ({ userId: u.id, driverId: null, name: u.short_name });
const date = z.iso.date();

app.get('/qualities', async c => {
  const { results } = await c.env.DB.prepare('SELECT id, name, color FROM bulk_qualities WHERE active = 1 ORDER BY sort').all<BulkQuality>();
  return c.json(results);
});

/** Åpne bestillinger, pluss det som er ferdig eller avlyst i dag. */
app.get('/orders', async c => {
  const since = osloToUtc(todayOslo(), 0);
  return c.json(await loadBulk(c.env.DB, `o.status IN ('bestilt', 'lastes') OR o.created_at >= ? OR o.finished_at >= ?`, [since, since]));
});

app.post('/orders', body(bulkOrderCreate), async c => {
  const i = c.req.valid('json');
  const order = await createBulkOrder(c.env.DB, i, actor(c.get('user')), i.driver_id ?? null);
  publish(c, { type: 'bulk.changed' });
  return c.json(order, 201);
});

app.get('/orders/:id/log', async c => c.json(await loadBulkLog(c.env.DB, c.req.param('id'))));

app.get('/orders/:id/pdf', async c => {
  const o = await loadBulkOne(c.env.DB, c.req.param('id'));
  if (!o) throw fail(404, 'Fant ikke bestillingen.');
  return pdfResponse(c.env, o);
});

/** Kontoret kan også styre lastingen (f.eks. avslutte etter nødstopp eller registrere veid tonn). */
app.post('/orders/:id/:action{start|step-done|stop|continue|cancel}', async c => {
  const o = await loadBulkOne(c.env.DB, c.req.param('id'));
  if (!o) throw fail(404, 'Fant ikke bestillingen.');
  const action = c.req.param('action') as BulkAction;
  const weighed = action === 'step-done' ? await readWeighed(c.req.raw) : undefined;
  const view = await bulkAct(c.env, o, action, actor(c.get('user')), weighed);
  publish(c, { type: 'bulk.changed' });
  return c.json(view);
});

// ---------------------------------------------------------------- veiinger og rapporter

app.get('/weighings', query(z.object({ from: date.optional(), to: date.optional() })), async c => {
  const { from = todayOslo(), to = from } = c.req.valid('query');
  return c.json(await loadWeighings(c.env.DB, from, to));
});

app.get('/report', query(z.object({
  from: date.optional(), to: date.optional(),
  group: z.enum(['kvalitet', 'kunde', 'bil', 'sjafor', 'transportor', 'prosjekt', 'dag']).default('kvalitet'),
})), async c => {
  const today = todayOslo();
  const { from = addDays(today, -29), to = today, group } = c.req.valid('query');
  if (to < from) throw fail(400, 'Til-dato må være etter fra-dato.');
  return c.json(await bulkReport(c.env.DB, from, to, group));
});

// ---------------------------------------------------------------- registre

app.get('/registry', async c => {
  const db = c.env.DB;
  const [h, cu, d, v] = await db.batch([
    db.prepare('SELECT id, name, own, phone, active FROM haulers ORDER BY own DESC, name'),
    db.prepare('SELECT id, name, requires_project, email, notes, active FROM bulk_customers ORDER BY name'),
    db.prepare(`SELECT d.id, d.name, d.phone, d.lang, d.active, d.pin_hash IS NOT NULL AS has_pin, d.last_login_at, h.id AS h_id, h.name AS h_name, h.own AS h_own
                FROM drivers d JOIN haulers h ON h.id = d.hauler_id ORDER BY d.name`),
    db.prepare('SELECT id, reg_no, hauler_id, description, has_trailer, active FROM vehicles ORDER BY reg_no'),
  ]);
  const b = (x: unknown) => !!x;
  return c.json({
    haulers: (h.results as (Omit<Hauler, 'own' | 'active'> & { own: number; active: number })[]).map(x => ({ ...x, own: b(x.own), active: b(x.active) })),
    customers: (cu.results as (Omit<BulkCustomer, 'requires_project' | 'active'> & { requires_project: number; active: number })[]).map(x => ({ ...x, requires_project: b(x.requires_project), active: b(x.active) })),
    drivers: (d.results as Record<string, unknown>[]).map(x => ({
      id: x.id, name: x.name, phone: x.phone, lang: x.lang, active: b(x.active), has_pin: b(x.has_pin), last_login_at: x.last_login_at,
      hauler: { id: x.h_id, name: x.h_name, own: b(x.h_own) },
    })) as DriverProfile[],
    vehicles: (v.results as (Omit<Vehicle, 'has_trailer' | 'active'> & { has_trailer: number; active: number })[]).map(x => ({ ...x, has_trailer: b(x.has_trailer), active: b(x.active) })),
  } satisfies BulkRegistry);
});

/** Felles: insert eller update, med vennlig melding ved duplikat. */
async function save(c: { env: Env }, run: () => Promise<unknown>, dup: string) {
  try { await run(); } catch (e) { if (isConstraintError(e)) throw fail(409, dup); throw e; }
}
const bit = (v: boolean | undefined, fallback = 1) => (v === undefined ? fallback : v ? 1 : 0);

app.post('/registry/haulers', body(haulerUpsert), async c => {
  const i = c.req.valid('json');
  await save(c, () => c.env.DB.prepare('INSERT INTO haulers (id, name, own, phone) VALUES (?, ?, ?, ?)').bind(newId('h'), i.name, bit(i.own, 0), i.phone).run(),
    'Det finnes allerede et transportfirma med dette navnet.');
  return c.json({ ok: true }, 201);
});
app.patch('/registry/haulers/:id', body(haulerUpsert), async c => {
  const i = c.req.valid('json');
  await save(c, () => c.env.DB.prepare('UPDATE haulers SET name = ?, own = ?, phone = ?, active = ? WHERE id = ?')
    .bind(i.name, bit(i.own, 0), i.phone, bit(i.active), c.req.param('id')).run(), 'Det finnes allerede et transportfirma med dette navnet.');
  return c.json({ ok: true });
});

app.post('/registry/customers', body(bulkCustomerUpsert), async c => {
  const i = c.req.valid('json');
  await save(c, () => c.env.DB.prepare('INSERT INTO bulk_customers (id, name, requires_project, email, notes) VALUES (?, ?, ?, ?, ?)')
    .bind(newId('bc'), i.name, bit(i.requires_project, 0), i.email, i.notes).run(), 'Det finnes allerede en kunde med dette navnet.');
  return c.json({ ok: true }, 201);
});
app.patch('/registry/customers/:id', body(bulkCustomerUpsert), async c => {
  const i = c.req.valid('json');
  await save(c, () => c.env.DB.prepare('UPDATE bulk_customers SET name = ?, requires_project = ?, email = ?, notes = ?, active = ? WHERE id = ?')
    .bind(i.name, bit(i.requires_project, 0), i.email, i.notes, bit(i.active), c.req.param('id')).run(), 'Det finnes allerede en kunde med dette navnet.');
  return c.json({ ok: true });
});

/** Sjåfør: kontoret lager profilen og PIN-en. Ny PIN låser opp kontoen og logger ut overalt. */
app.post('/registry/drivers', body(driverUpsert), async c => {
  const i = c.req.valid('json');
  if (!i.pin) throw fail(400, 'Sett en PIN (4–6 siffer).', { field: 'pin' });
  const pin = await hashPin(i.pin);
  await save(c, () => c.env.DB.prepare('INSERT INTO drivers (id, name, phone, hauler_id, lang, pin_hash, pin_salt) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(newId('dr'), i.name, normalizePhone(i.phone), i.hauler_id, i.lang ?? 'nb', pin.hash, pin.salt).run(), 'Det finnes allerede en sjåfør med dette telefonnummeret.');
  return c.json({ ok: true }, 201);
});
app.patch('/registry/drivers/:id', body(driverUpsert), async c => {
  const i = c.req.valid('json');
  const id = c.req.param('id');
  const db = c.env.DB;
  const pin = i.pin ? await hashPin(i.pin) : null;
  await save(c, () => db.batch([
    db.prepare('UPDATE drivers SET name = ?, phone = ?, hauler_id = ?, lang = coalesce(?, lang), active = ? WHERE id = ?')
      .bind(i.name, normalizePhone(i.phone), i.hauler_id, i.lang ?? null, bit(i.active), id),
    ...(pin ? [
      db.prepare('UPDATE drivers SET pin_hash = ?, pin_salt = ?, failed_logins = 0, locked_until = NULL WHERE id = ?').bind(pin.hash, pin.salt, id),
      db.prepare('DELETE FROM driver_sessions WHERE driver_id = ?').bind(id),
    ] : []),
    ...(i.active === false ? [db.prepare('DELETE FROM driver_sessions WHERE driver_id = ?').bind(id)] : []),
  ]), 'Det finnes allerede en sjåfør med dette telefonnummeret.');
  return c.json({ ok: true });
});

app.post('/registry/vehicles', body(vehicleUpsert), async c => {
  const i = c.req.valid('json');
  await save(c, () => c.env.DB.prepare('INSERT INTO vehicles (id, reg_no, hauler_id, description, has_trailer) VALUES (?, ?, ?, ?, ?)')
    .bind(newId('ve'), i.reg_no.toUpperCase(), i.hauler_id, i.description, bit(i.has_trailer)).run(), 'Det finnes allerede en bil med dette reg.nr.');
  return c.json({ ok: true }, 201);
});
app.patch('/registry/vehicles/:id', body(vehicleUpsert), async c => {
  const i = c.req.valid('json');
  await save(c, () => c.env.DB.prepare('UPDATE vehicles SET reg_no = ?, hauler_id = ?, description = ?, has_trailer = ?, active = ? WHERE id = ?')
    .bind(i.reg_no.toUpperCase(), i.hauler_id, i.description, bit(i.has_trailer), bit(i.active), c.req.param('id')).run(), 'Det finnes allerede en bil med dette reg.nr.');
  return c.json({ ok: true });
});

export default app;
