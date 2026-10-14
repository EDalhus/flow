import { Hono } from 'hono';
import type { UserView } from '../../shared/api.ts';
import { CREW_ROLES, DEFAULT_SETTINGS, type Capacity, type CrewRole, type UserRole } from '../../shared/domain/types.ts';
import { agentCreate, rangeQuery, settingsPut, shiftsPut, userCreate, userPatch } from '../../shared/schemas.ts';
import { CAN, requireRole } from '../auth/access.ts';
import { body, fail, isConstraintError, newId, query } from '../lib/http.ts';
import { loadCapacity, loadSettings } from '../lib/settings.ts';
import type { AppEnv } from '../types.ts';

// Små oppslagsressurser: meg, brukere, kaier, produkter, agenter, innstillinger, vakter.
const app = new Hono<AppEnv>();

app.get('/me', c => c.json(c.get('user')));

// ---------------------------------------------------------------- brukere

type UserRow = Omit<UserView, 'roles' | 'skills' | 'active'> & { active: number; roles: string | null; skills: string | null };
const USER_SELECT = `
  SELECT u.id, u.email, u.name, u.short_name, u.initials, u.title, u.phone, u.active,
         (SELECT group_concat(role) FROM user_roles r WHERE r.user_id = u.id) AS roles,
         (SELECT group_concat(crew_role) FROM crew_skills k WHERE k.user_id = u.id) AS skills
  FROM users u`;
const toUser = (u: UserRow): UserView => ({
  ...u, active: !!u.active,
  roles: (u.roles ? u.roles.split(',') : []) as UserRole[],
  skills: (u.skills ? u.skills.split(',') : []) as CrewRole[],
});

app.get('/users', async c => {
  const all = c.req.query('all') === '1';
  const { results } = await c.env.DB.prepare(`${USER_SELECT} ${all ? '' : 'WHERE u.active = 1'} ORDER BY u.name`).all<UserRow>();
  return c.json(results.map(toUser));
});

function roleStatements(db: D1Database, id: string, roles?: UserRole[], skills?: CrewRole[]) {
  return [
    ...(roles ? [db.prepare('DELETE FROM user_roles WHERE user_id = ?').bind(id), ...roles.map(r => db.prepare('INSERT INTO user_roles (user_id, role) VALUES (?, ?)').bind(id, r))] : []),
    ...(skills ? [db.prepare('DELETE FROM crew_skills WHERE user_id = ?').bind(id), ...skills.map(s => db.prepare('INSERT INTO crew_skills (user_id, crew_role) VALUES (?, ?)').bind(id, s))] : []),
  ];
}

app.post('/users', requireRole(...CAN.admin), body(userCreate), async c => {
  const u = c.req.valid('json');
  const db = c.env.DB;
  const id = newId('u');
  try {
    await db.batch([
      db.prepare('INSERT INTO users (id, email, name, short_name, initials, title, phone) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, u.email, u.name, u.short_name, u.initials.toUpperCase(), u.title, u.phone ?? null),
      ...roleStatements(db, id, u.roles, u.skills),
    ]);
  } catch (e) {
    if (isConstraintError(e, 'UNIQUE')) throw fail(409, 'Det finnes allerede en bruker med denne e-posten.');
    throw e;
  }
  return c.json(toUser((await db.prepare(`${USER_SELECT} WHERE u.id = ?`).bind(id).first<UserRow>())!), 201);
});

app.patch('/users/:id', requireRole(...CAN.admin), body(userPatch), async c => {
  const { roles, skills, active, ...fields } = c.req.valid('json');
  const db = c.env.DB;
  const id = c.req.param('id');
  if (id === c.get('user').id && (active === false || (roles && !roles.includes('admin')))) {
    throw fail(400, 'Du kan ikke fjerne din egen admin-tilgang eller deaktivere deg selv.');
  }
  const cols = Object.entries({ ...fields, ...(active === undefined ? {} : { active: active ? 1 : 0 }) }).filter(([, v]) => v !== undefined);
  try {
    await db.batch([
      ...(cols.length ? [db.prepare(`UPDATE users SET ${cols.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...cols.map(([, v]) => v ?? null), id)] : []),
      ...roleStatements(db, id, roles, skills),
    ]);
  } catch (e) {
    if (isConstraintError(e, 'UNIQUE')) throw fail(409, 'Det finnes allerede en bruker med denne e-posten.');
    if (isConstraintError(e, 'FOREIGN KEY')) throw fail(404, 'Fant ikke brukeren.');
    throw e;
  }
  const row = await db.prepare(`${USER_SELECT} WHERE u.id = ?`).bind(id).first<UserRow>();
  if (!row) throw fail(404, 'Fant ikke brukeren.');
  return c.json(toUser(row));
});

// ---------------------------------------------------------------- kaier, produkter, agenter

app.get('/quays', async c => {
  const { results } = await c.env.DB.prepare('SELECT id, name, lat, lon FROM quays WHERE active = 1 ORDER BY sort').all();
  return c.json(results);
});

app.get('/products', async c => {
  const [products, skus] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, name FROM products ORDER BY sort'),
    c.env.DB.prepare('SELECT id, product_id, unit, bags_per_unit, bag_kg, pallet_type, kg_per_unit FROM skus WHERE active = 1 ORDER BY sort'),
  ]);
  const bySku = Map.groupBy(skus.results as { product_id: string }[], s => s.product_id);
  return c.json((products.results as { id: string; name: string }[]).map(p => ({ ...p, skus: bySku.get(p.id) ?? [] })));
});

app.get('/agents', async c => {
  const { results } = await c.env.DB.prepare('SELECT id, name, phone FROM agents ORDER BY name').all();
  return c.json(results);
});

app.post('/agents', requireRole(...CAN.boats), body(agentCreate), async c => {
  const a = c.req.valid('json');
  const id = newId('ag');
  try {
    await c.env.DB.prepare('INSERT INTO agents (id, name, phone) VALUES (?, ?, ?)').bind(id, a.name, a.phone ?? null).run();
  } catch (e) {
    if (isConstraintError(e, 'UNIQUE')) throw fail(409, 'Agenten finnes allerede.');
    throw e;
  }
  return c.json({ id, name: a.name, phone: a.phone ?? null }, 201);
});

// ---------------------------------------------------------------- innstillinger

app.get('/settings', async c => c.json(await loadSettings(c.env.DB)));

app.put('/settings', requireRole(...CAN.admin), body(settingsPut), async c => {
  const input = c.req.valid('json');
  const unknown = Object.keys(input).filter(k => !(k in DEFAULT_SETTINGS));
  if (unknown.length) throw fail(400, `Ukjente innstillinger: ${unknown.join(', ')}.`);
  const db = c.env.DB;
  await db.batch(Object.entries(input).map(([k, v]) =>
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(k, JSON.stringify(v))));
  return c.json(await loadSettings(db));
});

// ---------------------------------------------------------------- vakter

app.get('/shifts', query(rangeQuery), async c => {
  const { from, to } = c.req.valid('query');
  const db = c.env.DB;
  const settings = await loadSettings(db);
  const [{ results }, capacityFor] = await Promise.all([
    db.prepare(`SELECT s.service_date, s.crew_role, u.id AS user_id, u.short_name FROM shifts s JOIN users u ON u.id = s.user_id
                WHERE s.service_date BETWEEN ? AND ? ORDER BY s.service_date, s.crew_role, u.short_name`).bind(from, to).all(),
    loadCapacity(db, settings, from, to),
  ]);
  const days: { service_date: string; capacity: Capacity }[] = [];
  for (let d = from; d <= to; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
    days.push({ service_date: d, capacity: capacityFor(d) });
  }
  return c.json({ entries: results, days });
});

app.put('/shifts/:date', requireRole(...CAN.crew), body(shiftsPut), async c => {
  const date = c.req.param('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail(400, 'Ugyldig dato.');
  const { entries } = c.req.valid('json');
  const db = c.env.DB;
  try {
    await db.batch([
      db.prepare('DELETE FROM shifts WHERE service_date = ?').bind(date),
      ...entries.map(e => db.prepare('INSERT INTO shifts (service_date, user_id, crew_role) VALUES (?, ?, ?)').bind(date, e.user_id, e.crew_role)),
    ]);
  } catch (e) {
    if (isConstraintError(e, 'FOREIGN KEY')) throw fail(400, 'Ukjent person.');
    if (isConstraintError(e, 'UNIQUE')) throw fail(400, 'Samme person og rolle er oppgitt to ganger.');
    throw e;
  }
  const capacity = Object.fromEntries(CREW_ROLES.map(r => [r, entries.filter(e => e.crew_role === r).length]));
  return c.json({ service_date: date, capacity });
});

export default app;
