import { Hono } from 'hono';
import { collisionsFor, findCollisions, type CollisionCall } from '../../shared/domain/collisions.ts';
import { resolveResponsible } from '../../shared/domain/responsible.ts';
import { CREW_ROLE_LABEL, type CallType, type CrewRole } from '../../shared/domain/types.ts';
import { crewPut, loadOrderPut, portCallCancel, portCallCreate, portCallPatch, rangeQuery } from '../../shared/schemas.ts';
import { MAX_CALL_DAYS, osloTime, serviceDate, wholeDay } from '../../shared/time.ts';
import { CAN, hasRole, requireRole } from '../auth/access.ts';
import { callSnapshot, loadCallLog, logCall, logStatement, ordersOnCall, syncLink, type CallSnapshot } from '../db/orders.ts';
import { attachCollisions, collisionContext, loadCall, viewCollision } from '../db/portCalls.ts';
import { quayLabel } from '../../shared/domain/quay.ts';
import { body, fail, newId, nowIso, query } from '../lib/http.ts';
import { publish } from '../lib/realtime.ts';
import type { AppEnv, AuthUser } from '../types.ts';

const app = new Hono<AppEnv>();

type SlotInput = { crew_role: CrewRole; user_id: string | null };

/** Sjekker at båt, kai, selger, varer og personer finnes, og at personene kan rollen de settes på. */
export async function validateRefs(
  db: D1Database,
  refs: { boat_id?: string; quay_id?: string; seller_id?: string | null; skus?: string[]; crew?: SlotInput[] },
) {
  const users = [...new Set([...(refs.crew ?? []).map(s => s.user_id), refs.seller_id].filter((u): u is string => !!u))];
  const skus = [...new Set(refs.skus ?? [])];
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
  id: string; boat_id: string; type: CallType; quay_id: string; eta: string; etd: string; time_known: number; service_date: string; seller_id: string | null;
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
  // Med anløp som varer over flere dager: alt som overlapper perioden.
  const views = ctx.calls.filter(v => serviceDate(v.etd) >= from && v.service_date <= to && v.status !== 'avlyst');
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
  // Uten klokkeslett kan anløpet ikke kollidere; det sjekkes når tiden settes.
  if (input.time_known === false) return c.json({ collisions: [] });
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

type NewCallInput = {
  boat_id: string; quay_id: string; eta: string; etd: string; time_known?: boolean; boat_crane?: boolean; crew: SlotInput[];
  responsible_user_id?: string | null; seller_id?: string | null; notes?: string | null; type: CallType;
};

/**
 * Klargjør et nytt anløp: tilgang, oppslag og ansvarlig. Gir setningene som oppretter det, og hvordan
 * anløpet skal stå i loggen. Brukes både av «Nytt anløp» og når en SO legges på en ny båt.
 */
export async function newCallStatements(db: D1Database, user: AuthUser, id: string, input: NewCallInput) {
  if (!hasRole(user, ...CAN.crew) && (input.crew.some(s => s.user_id) || input.responsible_user_id)) {
    throw fail(403, 'Navn og ansvarlig settes av produksjonen.');
  }
  await validateRefs(db, { boat_id: input.boat_id, quay_id: input.quay_id, seller_id: input.seller_id, crew: input.crew });
  const resp = resolveResponsible(input.crew, input.responsible_user_id, null);
  if (!resp.ok) throw fail(400, resp.error, { field: 'responsible_user_id' });
  const known = input.time_known !== false;
  const times = known ? { eta: input.eta, etd: input.etd } : wholeDay(serviceDate(input.eta));
  const names = await db.prepare(`SELECT b.name AS boat, q.name, q.nickname, q.company FROM boats b, quays q WHERE b.id = ? AND q.id = ?`)
    .bind(input.boat_id, input.quay_id).first<{ boat: string; name: string; nickname: string | null; company: string | null }>();
  const snapshot: CallSnapshot = { id, boat: names?.boat ?? '', eta: times.eta, time_known: known, quay: names ? quayLabel(names) : '' };
  const statements = [
    db.prepare(`INSERT INTO port_calls (id, boat_id, type, quay_id, eta, etd, time_known, service_date, seller_id, created_by, boat_crane, responsible_user_id, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, input.boat_id, input.type, input.quay_id, times.eta, times.etd, known ? 1 : 0, serviceDate(input.eta), input.seller_id ?? null, user.id,
        input.boat_crane ? 1 : 0, resp.responsible, input.notes ?? null),
    ...crewStatements(db, id, input.crew),
  ];
  return { statements, snapshot };
}

/** Legger linjene som venter på båt i disse SO-ene på anløpet, og fører det i loggen. */
async function attachOrders(db: D1Database, user: AuthUser, call: CallSnapshot, orderIds: string[]) {
  if (!orderIds.length) return [];
  const { results } = await db.prepare(`SELECT so.id, so.so_number, so.cancelled_at,
                                          (SELECT count(*) FROM order_lines l WHERE l.sales_order_id = so.id AND l.port_call_id IS NULL) AS waiting
                                        FROM sales_orders so WHERE so.id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(orderIds)).all<{ id: string; so_number: string; cancelled_at: string | null; waiting: number }>();
  if (results.length !== new Set(orderIds).size) throw fail(400, 'Ukjent salgsordre.', { field: 'orders' });
  const out: D1PreparedStatement[] = [];
  for (const o of results) {
    if (o.cancelled_at) throw fail(409, `SO ${o.so_number} er kansellert.`);
    if (!o.waiting) throw fail(409, `SO ${o.so_number} har ingen varer som venter på båt.`);
    out.push(
      db.prepare('UPDATE order_lines SET port_call_id = ? WHERE sales_order_id = ? AND port_call_id IS NULL').bind(call.id, o.id),
      ...syncLink(db, call.id, o.id),
      logStatement(db, { orderId: o.id, callId: call.id, userId: user.id, kind: 'assigned', data: { to: logCall(call) } }),
    );
  }
  return out;
}

app.post('/', requireRole(...CAN.plan), body(portCallCreate), async c => {
  const input = c.req.valid('json');
  const user = c.get('user');
  const db = c.env.DB;
  const seller = input.seller_id !== undefined ? input.seller_id : user.roles.includes('salg') ? user.id : null;
  const id = newId('pc');
  const { statements, snapshot } = await newCallStatements(db, user, id, { ...input, seller_id: seller });
  const attach = await attachOrders(db, user, snapshot, input.orders);
  await db.batch([
    ...statements,
    ...attach,
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
    // Nye tider uten at time_known er oppgitt betyr at tiden nå er kjent.
    time_known: input.time_known ?? (input.eta || input.etd ? true : !!cur.time_known),
  };
  if (!next.time_known) Object.assign(next, wholeDay(serviceDate(next.eta)));
  if (Date.parse(next.etd) <= Date.parse(next.eta)) throw fail(400, 'ETD må være etter ETA.', { field: 'etd' });
  if (Date.parse(next.etd) - Date.parse(next.eta) > MAX_CALL_DAYS * 86_400_000) throw fail(400, `Et anløp kan vare maks ${MAX_CALL_DAYS} døgn.`, { field: 'etd' });
  await validateRefs(db, { boat_id: input.boat_id, quay_id: input.quay_id, seller_id: input.seller_id ?? undefined });

  // Endringer som angår SO-ene på anløpet føres i loggen til hver av dem, og selgeren får beskjed.
  const before = await callSnapshot(db, cur.id);
  const logs: D1PreparedStatement[] = [];
  const notes: D1PreparedStatement[] = [];
  const notified: string[] = [];
  const boatChanged = next.boat_id !== cur.boat_id;
  const etaChanged = next.eta !== cur.eta || next.etd !== cur.etd || next.time_known !== !!cur.time_known;
  const quayChanged = next.quay_id !== cur.quay_id;
  if (boatChanged || etaChanged || quayChanged) {
    const names = await db.prepare(`SELECT b.name AS boat, q.name, q.nickname, q.company FROM boats b, quays q WHERE b.id = ? AND q.id = ?`)
      .bind(next.boat_id, next.quay_id).first<{ boat: string; name: string; nickname: string | null; company: string | null }>();
    const orders = await ordersOnCall(db, cur.id);
    for (const o of orders) {
      const log = (kind: 'boat_changed' | 'eta_changed' | 'quay_changed', data: unknown) =>
        logs.push(logStatement(db, { orderId: o.id, callId: cur.id, userId: user.id, kind, data }));
      if (boatChanged) log('boat_changed', { from: cur.boat_name, to: names?.boat ?? '' });
      if (etaChanged) {
        log('eta_changed', {
          from: { eta: cur.eta, etd: cur.etd, time_known: !!cur.time_known },
          to: { eta: next.eta, etd: next.etd, time_known: next.time_known },
        });
      }
      if (quayChanged) log('quay_changed', { from: before?.quay ?? '', to: names ? quayLabel(names) : '' });
      if (o.seller_id && o.seller_id !== user.id) {
        notified.push(o.seller_id);
        notes.push(db.prepare(`INSERT INTO notifications (id, user_id, kind, port_call_id, text) VALUES (?, ?, 'order', ?, ?)`)
          .bind(newId('n'), o.seller_id, cur.id, `SO ${o.so_number} på ${names?.boat ?? cur.boat_name} er endret av ${user.short_name}`));
      }
    }
  }

  await runGuarded(db, [
    guardedAudit(db, user, cur.id, input.version, 'update', input),
    db.prepare(`UPDATE port_calls SET boat_id = ?, type = ?, quay_id = ?, eta = ?, etd = ?, time_known = ?, service_date = ?, seller_id = ?,
                  boat_crane = ?, notes = ?, version = version + 1, updated_at = ? WHERE id = ?`)
      .bind(next.boat_id, next.type, next.quay_id, next.eta, next.etd, next.time_known ? 1 : 0, serviceDate(next.eta), next.seller_id,
        next.boat_crane ? 1 : 0, next.notes, nowIso(), cur.id),
    ...logs,
    ...notes,
  ]);
  publish(c, { type: 'port_call.changed', id: cur.id }, ...[...new Set(notified)].map(u => ({ type: 'notification' as const, user_id: u })));
  return c.json(await loadCall(db, cur.id));
});

/** Lasterekkefølge: SO-ene i den rekkefølgen de skal lastes eller losses. Alle kan endre. */
app.put('/:id/load-order', body(loadOrderPut), async c => {
  const { order_ids } = c.req.valid('json');
  const user = c.get('user');
  const db = c.env.DB;
  const cur = await current(db, c.req.param('id'));
  assertEditable(cur);
  const orders = await ordersOnCall(db, cur.id);
  const have = orders.map(o => o.id);
  if (order_ids.length !== have.length || !have.every(id => order_ids.includes(id))) {
    throw fail(400, 'Lasterekkefølgen må inneholde alle SO-ene på anløpet.', { field: 'order_ids' });
  }
  const stmts: D1PreparedStatement[] = [];
  order_ids.forEach((id, i) => {
    stmts.push(db.prepare('UPDATE port_call_orders SET load_seq = ? WHERE port_call_id = ? AND sales_order_id = ?').bind(i + 1, cur.id, id));
    const was = have.indexOf(id);
    if (was !== i) stmts.push(logStatement(db, { orderId: id, callId: cur.id, userId: user.id, kind: 'load_order', data: { from: was + 1, to: i + 1 } }));
  });
  stmts.push(db.prepare('UPDATE port_calls SET version = version + 1, updated_at = ? WHERE id = ?').bind(nowIso(), cur.id));
  await db.batch(stmts);
  publish(c, { type: 'port_call.changed', id: cur.id });
  return c.json(await loadCall(db, cur.id));
});

/** Endringslogg for anløpet: alt som er ført på SO-ene mens de lå her. */
app.get('/:id/log', async c => c.json(await loadCallLog(c.env.DB, c.req.param('id'))));

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
  // SO-ene går tilbake til «venter på båt».
  const snap = logCall(await callSnapshot(db, cur.id));
  const orders = await ordersOnCall(db, cur.id);
  await db.batch([
    db.prepare('UPDATE port_calls SET cancelled_at = ?, cancel_reason = ?, version = version + 1, updated_at = ? WHERE id = ?')
      .bind(nowIso(), reason, nowIso(), cur.id),
    db.prepare('UPDATE order_lines SET port_call_id = NULL WHERE port_call_id = ?').bind(cur.id),
    db.prepare('DELETE FROM port_call_orders WHERE port_call_id = ?').bind(cur.id),
    ...orders.map(o => logStatement(db, { orderId: o.id, callId: cur.id, userId: user.id, kind: 'unassigned', data: { from: snap, reason } })),
    db.prepare(`INSERT INTO audit_log (user_id, entity, entity_id, action, diff) VALUES (?, 'port_call', ?, 'cancel', ?)`)
      .bind(user.id, cur.id, JSON.stringify({ reason })),
  ]);
  publish(c, { type: 'port_call.changed', id: cur.id });
  return c.json(await loadCall(db, cur.id));
});

/**
 * Slett et anløp helt (f.eks. lagt inn ved en feil). SO-ene på båten går tilbake til «venter på båt» og får det i
 * loggen; chat, mannskap og varsler for anløpet slettes. Ikke mulig når kaiboka er levert (da er det historikk).
 */
app.delete('/:id', requireRole(...CAN.plan), async c => {
  const user = c.get('user');
  const db = c.env.DB;
  const cur = await current(db, c.req.param('id'));
  if (cur.completed_at || cur.has_log) throw fail(409, 'Kaibok er levert for anløpet, og det kan ikke slettes.');
  const snap = logCall(await callSnapshot(db, cur.id));
  const orders = await ordersOnCall(db, cur.id);
  const photos = await db.prepare('SELECT r2_key, thumb_key FROM quay_log_photos WHERE port_call_id = ?').bind(cur.id).all<{ r2_key: string; thumb_key: string | null }>();
  await db.batch([
    db.prepare('UPDATE order_lines SET port_call_id = NULL WHERE port_call_id = ?').bind(cur.id),
    ...orders.map(o => logStatement(db, { orderId: o.id, callId: cur.id, userId: user.id, kind: 'unassigned', data: { from: snap, deleted: true } })),
    db.prepare(`INSERT INTO audit_log (user_id, entity, entity_id, action, diff) VALUES (?, 'port_call', ?, 'delete', ?)`)
      .bind(user.id, cur.id, JSON.stringify({ boat: cur.boat_name, eta: cur.eta, etd: cur.etd, quay_id: cur.quay_id, type: cur.type })),
    // Chat, mannskap, varsler og båt-koblinger følger med (ON DELETE CASCADE).
    db.prepare('DELETE FROM port_calls WHERE id = ?').bind(cur.id),
  ]);
  // Bilder lastet opp til en kaibok som aldri ble levert.
  const keys = photos.results.flatMap(p => [p.r2_key, ...(p.thumb_key ? [p.thumb_key] : [])]);
  if (keys.length) c.executionCtx.waitUntil(c.env.PHOTOS.delete(keys).catch(e => console.error('sletting av bilder', e)));
  publish(c, { type: 'port_call.changed', id: cur.id });
  return c.json({ ok: true, orders: orders.length });
});

export default app;

/** GET /api/collisions?from&to – alle kollisjoner i perioden, til dashbordet. */
export const collisionsRoute = new Hono<AppEnv>().get('/', query(rangeQuery), async c => {
  const { from, to } = c.req.valid('query');
  const ctx = await collisionContext(c.env.DB, from, to);
  const views = ctx.calls.filter(v => serviceDate(v.etd) >= from && v.service_date <= to);
  return c.json({ collisions: attachCollisions(views, ctx).all });
});
