import { Hono } from 'hono';
import { CATEGORY_LABEL, FLAG_LABEL } from '../../shared/domain/types.ts';
import { quayLogCreate, quayLogQuery } from '../../shared/schemas.ts';
import { addDays, osloToUtc, todayOslo } from '../../shared/time.ts';
import { CAN, requireRole } from '../auth/access.ts';
import { loadQuayLogs, recomputeBoat } from '../db/boats.ts';
import { loadCall } from '../db/portCalls.ts';
import { body, fail, isConstraintError, newId, nowIso, query } from '../lib/http.ts';
import { publish } from '../lib/realtime.ts';
import { loadSettings } from '../lib/settings.ts';
import type { AppEnv } from '../types.ts';

const fr = (n: number) => n.toFixed(1).replace('.', ',');

/** Montert på /api/port-calls: levering av kaibok. */
export const deliver = new Hono<AppEnv>();

deliver.post('/:id/quay-log', requireRole(...CAN.quayLog), body(quayLogCreate), async c => {
  const input = c.req.valid('json');
  const user = c.get('user');
  const db = c.env.DB;
  const callId = c.req.param('id');

  const call = await db
    .prepare(`SELECT pc.id, pc.boat_id, pc.seller_id, pc.responsible_user_id, pc.cancelled_at, pc.completed_at, b.name AS boat
              FROM port_calls pc JOIN boats b ON b.id = pc.boat_id WHERE pc.id = ? AND pc.source = 'app'`)
    .bind(callId)
    .first<{ id: string; boat_id: string; seller_id: string | null; responsible_user_id: string | null; cancelled_at: string | null; completed_at: string | null; boat: string }>();
  if (!call) throw fail(404, 'Fant ikke anløpet.');
  if (call.cancelled_at) throw fail(409, 'Anløpet er avlyst.');
  if (call.completed_at) throw fail(409, 'Kaibok er allerede levert for dette anløpet.');

  if (input.photo_ids.length) {
    const { results } = await db
      .prepare(`SELECT id FROM quay_log_photos WHERE port_call_id = ? AND quay_log_id IS NULL AND id IN (SELECT value FROM json_each(?))`)
      .bind(callId, JSON.stringify(input.photo_ids))
      .all();
    if (results.length !== new Set(input.photo_ids).size) throw fail(400, 'Ukjent bilde, eller bildet hører til et annet anløp.', { field: 'photo_ids' });
  }

  const logId = newId('ql');
  const at = nowIso();
  const r = input.ratings;
  const avg = (r.punctuality + r.cooperation + r.equipment) / 3;
  const summary = input.had_deviation
    ? `avvik${input.categories.length ? `: ${input.categories.map(k => CATEGORY_LABEL[k].toLowerCase()).join(', ')}` : ''}`
    : 'ingen avvik';
  const systemText = `Kaibok levert av ${user.short_name} · ${summary} · ${fr(avg)} av 5. Anløpet er satt til Ferdig.`;
  const notify = [...new Set([call.seller_id, call.responsible_user_id])].filter((u): u is string => !!u && u !== user.id);
  const messageId = newId('m');

  try {
    await db.batch([
      db.prepare(`INSERT INTO quay_logs (id, port_call_id, had_deviation, description, r_punctuality, r_cooperation, r_equipment, boat_note, delivered_by, delivered_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(logId, callId, input.had_deviation ? 1 : 0, input.description || null, r.punctuality, r.cooperation, r.equipment,
          input.boat_note, user.id, at),
      ...input.categories.map(k => db.prepare('INSERT INTO quay_log_categories (quay_log_id, category) VALUES (?, ?)').bind(logId, k)),
      db.prepare(`UPDATE quay_log_photos SET quay_log_id = ? WHERE port_call_id = ? AND id IN (SELECT value FROM json_each(?))`)
        .bind(logId, callId, JSON.stringify(input.photo_ids)),
      db.prepare('UPDATE port_calls SET completed_at = ?, version = version + 1, updated_at = ? WHERE id = ?').bind(at, at, callId),
      db.prepare(`INSERT INTO messages (id, port_call_id, author_id, kind, body, created_at) VALUES (?, ?, NULL, 'system', ?, ?)`)
        .bind(messageId, callId, systemText, at),
      ...notify.map(u =>
        db.prepare(`INSERT INTO notifications (id, user_id, kind, port_call_id, message_id, text, created_at) VALUES (?, ?, 'quay_log', ?, ?, ?, ?)`)
          .bind(newId('n'), u, callId, messageId, `Kaibok levert · ${call.boat}${input.had_deviation ? ' · avvik' : ''}`, at)),
      db.prepare(`INSERT INTO audit_log (user_id, entity, entity_id, action, diff) VALUES (?, 'quay_log', ?, 'create', ?)`)
        .bind(user.id, logId, JSON.stringify(input)),
    ]);
  } catch (e) {
    // To samtidige innsendinger: UNIQUE(port_call_id) stopper den andre.
    if (isConstraintError(e, 'UNIQUE')) throw fail(409, 'Kaibok er allerede levert for dette anløpet.');
    throw e;
  }

  const settings = await loadSettings(db);
  const boat = await recomputeBoat(db, call.boat_id, settings.flag_rules);
  publish(
    c,
    { type: 'port_call.changed', id: callId },
    { type: 'message.created', port_call_id: callId, message_id: messageId },
    { type: 'boat.changed', id: call.boat_id },
    ...notify.map(u => ({ type: 'notification' as const, user_id: u })),
  );

  const [log] = await loadQuayLogs(db, { id: logId });
  return c.json({
    quay_log: log,
    port_call: await loadCall(db, callId),
    boat: { ...boat, flag_label: FLAG_LABEL[boat.flag_auto] },
  }, 201);
});

/** Montert på /api/quay-logs: loggen. */
export const quayLogs = new Hono<AppEnv>();

quayLogs.get('/', query(quayLogQuery), async c => {
  const { days, filter, q } = c.req.valid('query');
  // Hele kalenderdager i Oslo-tid: «siste 60 dager» tar med hele dag nr. 60.
  const since = osloToUtc(addDays(todayOslo(), -days), 0);
  let items = await loadQuayLogs(c.env.DB, { sinceIso: since, deviation: filter === 'alle' ? undefined : filter === 'avvik' });
  if (q) {
    const needle = q.toLowerCase();
    items = items.filter(l =>
      [l.boat.name, l.responsible?.name, l.responsible?.short_name, ...l.crew.flatMap(u => [u.name, u.short_name])]
        .some(s => s?.toLowerCase().includes(needle)));
  }
  // Nøkkeltall gjelder hele perioden, uavhengig av filter og søk (som i designet).
  const all = filter === 'alle' && !q ? items : await loadQuayLogs(c.env.DB, { sinceIso: since });
  const withDeviation = all.filter(l => l.had_deviation).length;
  return c.json({
    items,
    stats: {
      count: all.length,
      with_deviation: withDeviation,
      deviation_share: all.length ? withDeviation / all.length : null,
      avg: all.length ? all.reduce((s, l) => s + l.avg, 0) / all.length : null,
    },
  });
});

quayLogs.get('/:id', async c => {
  const [log] = await loadQuayLogs(c.env.DB, { id: c.req.param('id') });
  if (!log) throw fail(404, 'Fant ikke kaiboka.');
  return c.json(log);
});
