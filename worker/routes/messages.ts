import { Hono } from 'hono';
import type { MessageView, NotificationView } from '../../shared/api.ts';
import { findMentions } from '../../shared/domain/mentions.ts';
import { messageCreate, notificationsRead } from '../../shared/schemas.ts';
import { body, fail, newId, nowIso } from '../lib/http.ts';
import { publish } from '../lib/realtime.ts';
import type { AppEnv } from '../types.ts';

type MessageRow = {
  id: string; port_call_id: string; kind: 'user' | 'system'; body: string; created_at: string;
  author_id: string | null; name: string | null; short_name: string | null; initials: string | null; mentions: string | null;
};

const toView = (m: MessageRow): MessageView => ({
  id: m.id, port_call_id: m.port_call_id, kind: m.kind, body: m.body, created_at: m.created_at,
  author: m.author_id ? { id: m.author_id, name: m.name ?? '', short_name: m.short_name ?? '', initials: m.initials ?? '' } : null,
  mentions: m.mentions ? m.mentions.split(',') : [],
});

const SELECT = `
  SELECT m.id, m.port_call_id, m.kind, m.body, m.created_at, u.id AS author_id, u.name, u.short_name, u.initials,
         (SELECT group_concat(user_id) FROM message_mentions mm WHERE mm.message_id = m.id) AS mentions
  FROM messages m LEFT JOIN users u ON u.id = m.author_id`;

/** Montert på /api/port-calls. */
export const messages = new Hono<AppEnv>();

messages.get('/:id/messages', async c => {
  const { results } = await c.env.DB.prepare(`${SELECT} WHERE m.port_call_id = ? ORDER BY m.created_at`).bind(c.req.param('id')).all<MessageRow>();
  return c.json(results.map(toView));
});

messages.post('/:id/messages', body(messageCreate), async c => {
  const { body: text } = c.req.valid('json');
  const user = c.get('user');
  const db = c.env.DB;
  const callId = c.req.param('id');
  const call = await db
    .prepare(`SELECT b.name AS boat FROM port_calls pc JOIN boats b ON b.id = pc.boat_id WHERE pc.id = ? AND pc.source = 'app'`)
    .bind(callId)
    .first<{ boat: string }>();
  if (!call) throw fail(404, 'Fant ikke anløpet.');

  const { results: users } = await db.prepare('SELECT id, short_name FROM users WHERE active = 1').all<{ id: string; short_name: string }>();
  const mentioned = findMentions(text, users);
  const notify = mentioned.filter(u => u !== user.id);
  const id = newId('m');
  const at = nowIso();

  await db.batch([
    db.prepare(`INSERT INTO messages (id, port_call_id, author_id, kind, body, created_at) VALUES (?, ?, ?, 'user', ?, ?)`)
      .bind(id, callId, user.id, text, at),
    ...mentioned.map(u => db.prepare('INSERT INTO message_mentions (message_id, user_id) VALUES (?, ?)').bind(id, u)),
    ...notify.map(u =>
      db.prepare(`INSERT INTO notifications (id, user_id, kind, port_call_id, message_id, text, created_at) VALUES (?, ?, 'mention', ?, ?, ?, ?)`)
        .bind(newId('n'), u, callId, id, `${user.short_name} nevnte deg · ${call.boat}`, at)),
  ]);
  publish(c, { type: 'message.created', port_call_id: callId, message_id: id }, ...notify.map(u => ({ type: 'notification' as const, user_id: u })));
  const row = await db.prepare(`${SELECT} WHERE m.id = ?`).bind(id).first<MessageRow>();
  return c.json(toView(row!), 201);
});

/** Montert på /api/notifications. */
export const notifications = new Hono<AppEnv>();

notifications.get('/', async c => {
  const user = c.get('user');
  const [items, unread] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT id, kind, text, port_call_id, message_id, created_at, read_at FROM notifications
                      WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`).bind(user.id),
    c.env.DB.prepare('SELECT count(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').bind(user.id),
  ]);
  return c.json({ unread: (unread.results[0] as { n: number }).n, items: items.results as unknown as NotificationView[] });
});

notifications.post('/read', body(notificationsRead), async c => {
  const { ids, all } = c.req.valid('json');
  const user = c.get('user');
  if (!all && !ids?.length) throw fail(400, 'Oppgi ids eller all: true.');
  const stmt = all
    ? c.env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').bind(nowIso(), user.id)
    : c.env.DB.prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (SELECT value FROM json_each(?))`)
        .bind(nowIso(), user.id, JSON.stringify(ids));
  const res = await stmt.run();
  return c.json({ updated: res.meta.changes });
});
