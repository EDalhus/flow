import { Hono } from 'hono';
import type { BoatDetail } from '../../shared/api.ts';
import { boatCreate, boatPatch, flagOverride } from '../../shared/schemas.ts';
import { CAN, requireRole } from '../auth/access.ts';
import { loadBoats, loadQuayLogs } from '../db/boats.ts';
import { body, fail, isConstraintError, newId, nowIso } from '../lib/http.ts';
import { publish } from '../lib/realtime.ts';
import { loadSettings } from '../lib/settings.ts';
import type { AppEnv } from '../types.ts';

const app = new Hono<AppEnv>();

const duplicate = (e: unknown) => {
  if (!isConstraintError(e, 'UNIQUE')) return e;
  const m = e instanceof Error ? e.message : '';
  const field = m.includes('mmsi') ? 'MMSI' : m.includes('imo') ? 'IMO' : 'navn';
  return fail(409, `Det finnes allerede en båt med samme ${field}.`);
};

async function detail(db: D1Database, id: string): Promise<BoatDetail> {
  const settings = await loadSettings(db);
  const [boat] = await loadBoats(db, settings, id);
  if (!boat) throw fail(404, 'Fant ikke båten.');
  return { ...boat, recent_logs: await loadQuayLogs(db, { boatId: id, limit: 10 }) };
}

app.get('/', async c => c.json(await loadBoats(c.env.DB, await loadSettings(c.env.DB))));

app.get('/:id', async c => c.json(await detail(c.env.DB, c.req.param('id'))));

app.post('/', requireRole(...CAN.boats), body(boatCreate), async c => {
  const b = c.req.valid('json');
  const id = newId('b');
  try {
    await c.env.DB
      .prepare(`INSERT INTO boats (id, name, imo, mmsi, callsign, agent_id, ship_contact, ship_phone, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, b.name, b.imo ?? null, b.mmsi ?? null, b.callsign, b.agent_id ?? null, b.ship_contact, b.ship_phone ?? null, b.note)
      .run();
  } catch (e) {
    if (isConstraintError(e, 'FOREIGN KEY')) throw fail(400, 'Ukjent agent.', { field: 'agent_id' });
    throw duplicate(e);
  }
  publish(c, { type: 'boat.changed', id });
  return c.json(await detail(c.env.DB, id), 201);
});

app.patch('/:id', requireRole(...CAN.boats), body(boatPatch), async c => {
  const patch = c.req.valid('json');
  const id = c.req.param('id');
  const cols = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!cols.length) return c.json(await detail(c.env.DB, id));
  try {
    const res = await c.env.DB
      .prepare(`UPDATE boats SET ${cols.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...cols.map(([, v]) => v ?? null), nowIso(), id)
      .run();
    if (!res.meta.changes) throw fail(404, 'Fant ikke båten.');
  } catch (e) {
    if (isConstraintError(e, 'FOREIGN KEY')) throw fail(400, 'Ukjent agent.', { field: 'agent_id' });
    throw duplicate(e);
  }
  publish(c, { type: 'boat.changed', id });
  return c.json(await detail(c.env.DB, id));
});

/** Overstyr automatisk flagg. Krever begrunnelse; logges. */
app.put('/:id/flag', requireRole(...CAN.flag), body(flagOverride), async c => {
  const { flag, reason } = c.req.valid('json');
  const user = c.get('user');
  const id = c.req.param('id');
  const [res] = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE boats SET flag_override = ?, flag_override_reason = ?, flag_override_by = ?, flag_override_at = ?, updated_at = ? WHERE id = ?`)
      .bind(flag, reason, user.id, nowIso(), nowIso(), id),
    c.env.DB.prepare(`INSERT INTO audit_log (user_id, entity, entity_id, action, diff) VALUES (?, 'boat', ?, 'flag_override', ?)`)
      .bind(user.id, id, JSON.stringify({ flag, reason })),
  ]);
  if (!res.meta.changes) throw fail(404, 'Fant ikke båten.');
  publish(c, { type: 'boat.changed', id });
  return c.json(await detail(c.env.DB, id));
});

/** Fjern overstyring; automatisk flagg gjelder igjen. */
app.delete('/:id/flag', requireRole(...CAN.flag), async c => {
  const user = c.get('user');
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE boats SET flag_override = NULL, flag_override_reason = NULL, flag_override_by = NULL, flag_override_at = NULL, updated_at = ? WHERE id = ?`)
      .bind(nowIso(), id),
    c.env.DB.prepare(`INSERT INTO audit_log (user_id, entity, entity_id, action) VALUES (?, 'boat', ?, 'flag_override_removed')`).bind(user.id, id),
  ]);
  publish(c, { type: 'boat.changed', id });
  return c.json(await detail(c.env.DB, id));
});

export default app;
