import { Hono } from 'hono';
import { collisionsFor, findCollisions, type CollisionCall } from '../../shared/domain/collisions.ts';
import { resolveResponsible } from '../../shared/domain/responsible.ts';
import { CREW_ROLE_LABEL, type CallType, type CrewRole } from '../../shared/domain/types.ts';
import { crewPut, portCallCancel, portCallCreate, portCallPatch, rangeQuery, type PortCallCreate } from '../../shared/schemas.ts';
import { osloTime, serviceDate } from '../../shared/time.ts';
import { CAN, hasRole, requireRole } from '../auth/access.ts';
import { attachCollisions, collisionContext, loadCall, viewCollision } from '../db/portCalls.ts';
import { body, fail, newId, nowIso, query } from '../lib/http.ts';
import { publish } from '../lib/realtime.ts';
import type { AppEnv, AuthUser } from '../types.ts';

const app = new Hono<AppEnv>();

const defaultDirection = (type: CallType) => (type === 'levering' ? 'inn' : 'ut');

type GoodsInput = PortCallCreate['goods'];
type SlotInput = { crew_role: CrewRole; user_id: string | null };

/** Sjekker at båt, kai, selger, varer og personer finnes, og at personene kan rollen de settes på. */
async function validateRefs(
  db: D1Database,
  refs: { boat_id?: string; quay_id?: string; seller_id?: string | null; goods?: GoodsInput; crew?: SlotInput[] },
) {
  const users = [...new Set([...(refs.crew ?? []).map(s => s.user_id), refs.seller_id].filter((u): u is string => !!u))];
  const skus = [...new Set((refs.goods ?? []).map(g => g.sku_id))];
  const [boat, quay, foundSkus, foundUsers] = await db.batch([
    db.prepare('SELECT id FROM boats WHERE id = ? AND active = 1').bind(refs.boat_id ?? ''),
    db.prepare('SELECT id FROM quays WHERE id = ? AND active = 1').bind(refs.quay_id ?? ''),
    db.prepare('SELECT id FROM skus WHERE active = 1 AND id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(skus)),
    db.prepare(`SELECT u.id, u.short_name, (SELECT group_concat(crew_role) FROM crew_skills k WHERE k.user_id = u.id) AS skills
                FROM users u WHERE u.active = 1 AND u.id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(users)),
  ]);
  if (refs.boat_id !== undefined && !boat.results.length) throw fail(400, 'Ukjent båt.', { field: 'boat_id' });
  if (refs.quay_id !== undefined && !quay.results.length) throw fail(400, 'Ukjent kai.', { field: 'quay_id' });
  if (foundSkus.results.length !== skus.length) throw fail(400, 'Ukjent vare.', { field: 'goods' });
  const userMap = new Map((foundUsers.results as { id: string; short_name: string; skills: string | null }[]).map(u => [u.id, u]));
  for (const u of users) if (!userMap.has(u)) throw fail(400, 'Ukjent eller deaktivert person.', { field: 'crew' });
  for (const s of refs.crew ?? []) {
    const u = s.user_id && userMap.get(s.user_id);
    if (u && !(u.skills ?? '').split(',').includes(s.crew_role)) {
      throw fail(400, `${u.short_name} er ikke registrert som ${CREW_ROLE_LABEL[s.crew_role].toLowerCase()}.`, { field: 'crew' });
    }
  }
}

function goodsStatements(db: D1Database, callId: string, type: CallType, goods: GoodsInput) {
  return goods.map((g, i) =>
    db.prepare('INSERT INTO port_call_goods (id, port_call_id, sku_id, quantity, direction, sort) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(newId('g'), callId, g.sku_id, g.quantity, g.direction ?? defaultDirection(type), i));
}

function crewStatements(db: D1Database, callId: string, slots: SlotInput[]) {
  return slots.map((s, i) =>
    db.prepare('INSERT INTO crew_slots (id, port_call_id, crew_role, user_id, sort) VALUES (?, ?, ?, ?, ?)')
      .bind(newId('cs'), callId, s.crew_role, s.user_id, i));
}

/**
 * Revisjonsrad som også fungerer som optimistisk lås: står først i batchen, og feiler
 * (CHECK på json_valid) hvis versjonen ikke stemmer. Da rulles hele batchen tilbake.
 */
function guardedAudit(db: D1Database, user: AuthUser, callId: string, expectedVersion: number, action: string, diff: unknown) {
  return db
    .prepare(`INSERT INTO audit_log (user_id, entity, entity_id, action, diff)
              VALUES (?, 'port_call', ?, ?, CASE WHEN (SELECT version FROM port_calls WHERE id = ?) = ? THEN ? ELSE 'versjonskonflikt' END)`)
    .bind(user.id, callId, action, callId, expectedVersion, JSON.stringify(diff ?? null));
}

async function runGuarded(db: D1Database, statements: D1PreparedStatement[]) {
  try {
    await db.batch(statements);
  } catch (e) {
    if (e instanceof Error && e.message.includes('CHECK constraint failed')) {
      throw fail(409, 'Anløpet er endret av noen andre. Last inn på nytt og prøv igjen.');
    }
    throw e;
  }
}

type CurrentCall = {
  id: string; boat_id: string; type: CallType; quay_id: string; eta: string; etd: string; service_date: string; seller_id: string | null;
  boat_crane: number; notes: string | null; responsible_user_id: string | null; version: number;
  completed_at: string | null; cancelled_at: string | null; has_log: number; boat_name: string;
};

async function current(db: D1Database, id: string): Promise<CurrentCall> {
  const row = await db
    .prepare(`SELECT pc.*, b.name AS boat_name, EXISTS (SELECT 1 FROM quay_logs ql WHERE ql.port_call_id = pc.id) AS has_log
              FROM port_calls pc JOIN boats b ON b.id = pc.boat_id WHERE pc.id = ? AND pc.source = 'app'`)
    .bind(id)
    .first<CurrentCall>();
  if (!row) throw fail(404, 'Fant ikke anløpet.');
  return row;
}

function assertEditable(c: CurrentCall) {
  if (c.cancelled_at) throw fail(409, 'Anløpet er avlyst.');
  if (c.completed_at || c.has_log) throw fail(409, 'Kaibok er levert, og anløpet kan ikke endres.');
}

// ---------------------------------------------------------------- lesing

app.get('/', query(rangeQuery), async c => {
  const { from, to } = c.req.valid('query');
  const ctx = await collisionContext(c.env.DB, from, to);
  const views = ctx.calls.filter(v => v.service_date >= from && v.service_date <= to && v.status !== 'avlyst');
  const { all } = attachCollisions(views, ctx);
  return c.json({ calls: views, collisions: all });
});

app.get('/:id', async c => {
  const view = await loadCall(c.env.DB, c.req.param('id'));
  if (!view) throw fail(404, 'Fant ikke anløpet.');
  return c.json(view);
});

/** Forhåndssjekk fra skjemaet: hvilke kollisjoner får dette utkastet? ?id= når et eksisterende anløp redigeres. */
app.post('/check', requireRole(...CAN.plan), body(portCallCreate), async c => {
  const input = c.req.valid('json');
  const editId = c.req.query('id');
  const ctx = await collisionContext(c.env.DB, serviceDate(input.eta), serviceDate(input.etd));
  if (!ctx.quays.some(q => q.id === input.quay_id)) throw fail(400, 'Ukjent kai.', { field: 'quay_id' });
  const boat = await c.env.DB.prepare('SELECT name FROM boats WHERE id = ?').bind(input.boat_id).first<{ name: string }>();
  if (!boat) throw fail(400, 'Ukjent båt.', { field: 'boat_id' });

  const draft: CollisionCall = {
    id: editId ?? 'draft', boat_name: boat.name, quay_id: input.quay_id, eta: input.eta, etd: input.etd,
    crew: input.crew.map(s => ({ crew_role: s.crew_role, user_id: s.user_id })),
  };
  const calls = ctx.active.filter(x => x.id !== draft.id).concat(draft);
  const collisions = collisionsFor(draft.id, findCollisions(calls, ctx.capacityFor)).map(col => viewCollision(col, draft.id, calls, ctx, draft.id));
  return c.json({ collisions });
});

// ---------------------------------------------------------------- endring

app.post('/', requireRole(...CAN.plan), body(portCallCreate), async c => {
  const input = c.req.valid('json');
  const user = c.get('user');
  const db = c.env.DB;
  if (!hasRole(user, ...CAN.crew) && (input.crew.some(s => s.user_id) || input.responsible_user_id)) {
    throw fail(403, 'Navn og ansvarlig settes av produksjonen.');
  }
  const seller = input.seller_id !== undefined ? input.seller_id : user.roles.includes('salg') ? user.id : null;
  await validateRefs(db, { ...input, seller_id: seller });
  const resp = resolveResponsible(input.crew, input.responsible_user_id, null);
  if (!resp.ok) throw fail(400, resp.error, { field: 'responsible_user_id' });

  const id = newId('pc');
  await db.batch([
    db.prepare(`INSERT INTO port_calls (id, boat_id, type, quay_id, eta, etd, service_date, seller_id, created_by, boat_crane, responsible_user_id, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, input.boat_id, input.type, input.quay_id, input.eta, input.etd, serviceDate(input.eta), seller, user.id,
        input.boat_crane ? 1 : 0, resp.responsible, input.notes ?? null),
    ...goodsStatements(db, id, input.type, input.goods),
    ...crewStatements(db, id, input.crew),
    db.prepare(`INSERT INTO audit_log (user_id, entity, entity_id, action, diff) VALUES (?, 'port_call', ?, 'create', ?)`)
      .bind(user.id, id, JSON.stringify(input)),
  ]);
  publish(c, { type: 'port_call.changed', id });
  return c.json(await loadCall(db, id), 201);
});

app.patch('/:id', requireRole(...CAN.plan), body(portCallPatch), async c => {
  const input = c.req.valid('json');
  const user = c.get('user');
  const db = c.env.DB;
  const cur = await current(db, c.req.param('id'));
  assertEditable(cur);
  if (cur.version !== input.version) throw fail(409, 'Anløpet er endret av noen andre. Last inn på nytt og prøv igjen.');

  const next = {
    boat_id: input.boat_id ?? cur.boat_id, type: input.type ?? cur.type, quay_id: input.quay_id ?? cur.quay_id,
    eta: input.eta ?? cur.eta, etd: input.etd ?? cur.etd,
    seller_id: input.seller_id !== undefined ? input.seller_id : cur.seller_id,
    boat_crane: input.boat_crane !== undefined ? input.boat_crane : !!cur.boat_crane,
    notes: input.notes !== undefined ? input.notes : cur.notes,
  };
  if (Date.parse(next.etd) <= Date.parse(next.eta)) throw fail(400, 'ETD må være etter ETA.', { field: 'etd' });
  await validateRefs(db, {
    boat_id: input.boat_id, quay_id: input.quay_id, seller_id: input.seller_id ?? undefined, goods: input.goods,
  });

  // Ny type uten nye varer: snu standardretningen på eksisterende linjer.
  const flipDirection = input.type && input.type !== cur.type && !input.goods;
  await runGuarded(db, [
    guardedAudit(db, user, cur.id, input.version, 'update', input),
    db.prepare(`UPDATE port_calls SET boat_id = ?, type = ?, quay_id = ?, eta = ?, etd = ?, service_date = ?, seller_id = ?,
                  boat_crane = ?, notes = ?, version = version + 1, updated_at = ? WHERE id = ?`)
      .bind(next.boat_id, next.type, next.quay_id, next.eta, next.etd, serviceDate(next.eta), next.seller_id,
        next.boat_crane ? 1 : 0, next.notes, nowIso(), cur.id),
    ...(input.goods
      ? [db.prepare('DELETE FROM port_call_goods WHERE port_call_id = ?').bind(cur.id), ...goodsStatements(db, cur.id, next.type, input.goods)]
      : []),
    ...(flipDirection
      ? [db.prepare(`UPDATE port_call_goods SET direction = ? WHERE port_call_id = ? AND direction = ?`)
          .bind(defaultDirection(next.type), cur.id, defaultDirection(cur.type))]
      : []),
  ]);
  publish(c, { type: 'port_call.changed', id: cur.id });
  return c.json(await loadCall(db, cur.id));
});

app.put('/:id/crew', requireRole(...CAN.plan, ...CAN.crew), body(crewPut), async c => {
  const input = c.req.valid('json');
  const user = c.get('user');
  const db = c.env.DB;
  const cur = await current(db, c.req.param('id'));
  assertEditable(cur);

  const { results: existing } = await db
    .prepare('SELECT crew_role, user_id FROM crew_slots WHERE port_call_id = ?').bind(cur.id).all<SlotInput>();

  if (!hasRole(user, ...CAN.crew)) {
    // Salg kan endre antall roller, men ikke hvem som står på dem.
    const pool = existing.filter(s => s.user_id).map(s => `${s.crew_role}:${s.user_id}`);
    for (const s of input.slots) {
      if (!s.user_id) continue;
      const i = pool.indexOf(`${s.crew_role}:${s.user_id}`);
      if (i < 0) throw fail(403, 'Navn og ansvarlig settes av produksjonen.');
      pool.splice(i, 1);
    }
    if (input.responsible_user_id !== undefined && input.slots.length > 1) throw fail(403, 'Navn og ansvarlig settes av produksjonen.');
  }
  await validateRefs(db, { crew: input.slots });
  const resp = resolveResponsible(input.slots, input.responsible_user_id, cur.responsible_user_id);
  if (!resp.ok) throw fail(400, resp.error, { field: 'responsible_user_id' });

  const before = new Set(existing.map(s => s.user_id).filter(Boolean));
  const added = input.slots.filter(s => s.user_id && !before.has(s.user_id) && s.user_id !== user.id);
  const when = `${cur.service_date.slice(8, 10)}.${cur.service_date.slice(5, 7)} ${osloTime(cur.eta)}`;

  await runGuarded(db, [
    guardedAudit(db, user, cur.id, input.version, 'crew', input),
    db.prepare('DELETE FROM crew_slots WHERE port_call_id = ?').bind(cur.id),
    ...crewStatements(db, cur.id, input.slots),
    db.prepare('UPDATE port_calls SET responsible_user_id = ?, version = version + 1, updated_at = ? WHERE id = ?')
      .bind(resp.responsible, nowIso(), cur.id),
    ...added.map(s =>
      db.prepare(`INSERT INTO notifications (id, user_id, kind, port_call_id, text) VALUES (?, ?, 'assigned', ?, ?)`)
        .bind(newId('n'), s.user_id, cur.id, `Du er satt opp som ${CREW_ROLE_LABEL[s.crew_role].toLowerCase()} · ${cur.boat_name} ${when}`)),
  ]);
  publish(c, { type: 'port_call.changed', id: cur.id }, ...added.map(s => ({ type: 'notification' as const, user_id: s.user_id! })));
  return c.json(await loadCall(db, cur.id));
});

app.post('/:id/cancel', requireRole(...CAN.plan), body(portCallCancel), async c => {
  const { reason } = c.req.valid('json');
  const user = c.get('user');
  const db = c.env.DB;
  const cur = await current(db, c.req.param('id'));
  assertEditable(cur);
  await db.batch([
    db.prepare('UPDATE port_calls SET cancelled_at = ?, cancel_reason = ?, version = version + 1, updated_at = ? WHERE id = ?')
      .bind(nowIso(), reason, nowIso(), cur.id),
    db.prepare(`INSERT INTO audit_log (user_id, entity, entity_id, action, diff) VALUES (?, 'port_call', ?, 'cancel', ?)`)
      .bind(user.id, cur.id, JSON.stringify({ reason })),
  ]);
  publish(c, { type: 'port_call.changed', id: cur.id });
  return c.json(await loadCall(db, cur.id));
});

export default app;

/** GET /api/collisions?from&to – alle kollisjoner i perioden, til dashbordet. */
export const collisionsRoute = new Hono<AppEnv>().get('/', query(rangeQuery), async c => {
  const { from, to } = c.req.valid('query');
  const ctx = await collisionContext(c.env.DB, from, to);
  const views = ctx.calls.filter(v => v.service_date >= from && v.service_date <= to);
  return c.json({ collisions: attachCollisions(views, ctx).all });
});
