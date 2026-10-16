import { Hono } from 'hono';
import type { BoatDetail, BoatPhoto } from '../../shared/api.ts';
import { BOAT_PHOTO_CATEGORIES, boatCreate, boatPatch, flagOverride } from '../../shared/schemas.ts';
import { CAN, hasRole, requireRole } from '../auth/access.ts';
import { MAX_IMAGE, MAX_THUMB, TYPES, sniff } from './photos.ts';
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
  const { results } = await db.prepare(`SELECT p.id, p.thumb_key, p.category, p.caption, p.width, p.height, p.created_at, u.short_name AS uploaded_by
      FROM boat_photos p LEFT JOIN users u ON u.id = p.uploaded_by WHERE p.boat_id = ? ORDER BY p.created_at DESC`).bind(id)
    .all<Omit<BoatPhoto, 'url' | 'thumb_url'> & { thumb_key: string | null }>();
  const photos = results.map(({ thumb_key, ...p }) => ({ ...p, url: `/api/boats/${id}/photos/${p.id}`, thumb_url: thumb_key ? `/api/boats/${id}/photos/${p.id}?thumb=1` : null }));
  return { ...boat, recent_logs: await loadQuayLogs(db, { boatId: id, limit: 10 }), photos };
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

// ---------------------------------------------------------------- bilder av båten

const MAX_BOAT_PHOTOS = 60;
/** Alle som jobber med båtene kan legge til bilder (kaiarbeidere tar dem gjerne om bord). */
const CAN_PHOTO = [...new Set([...CAN.boats, ...CAN.quayLog])];

/** Multipart: image, thumb, width, height, category, caption. Bildet er skalert ned i nettleseren. */
app.post('/:id/photos', requireRole(...CAN_PHOTO), async c => {
  const boatId = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;
  const boat = await db.prepare('SELECT (SELECT count(*) FROM boat_photos WHERE boat_id = b.id) AS n FROM boats b WHERE b.id = ?').bind(boatId).first<{ n: number }>();
  if (!boat) throw fail(404, 'Fant ikke båten.');
  if (boat.n >= MAX_BOAT_PHOTOS) throw fail(400, `Maks ${MAX_BOAT_PHOTOS} bilder per båt. Slett noen gamle først.`);

  let form: FormData;
  try { form = await c.req.formData(); } catch { throw fail(400, 'Forventet multipart/form-data.'); }
  const image = form.get('image');
  const thumb = form.get('thumb');
  if (!(image instanceof File)) throw fail(400, 'Bildet mangler.', { field: 'image' });
  if (image.size > MAX_IMAGE) throw fail(413, 'Bildet er for stort (maks 4 MB etter nedskalering).');
  const type = await sniff(image);
  if (!type) throw fail(415, 'Bare WebP eller JPEG er støttet.');
  let thumbType: string | null = null;
  if (thumb instanceof File) {
    if (thumb.size > MAX_THUMB) throw fail(413, 'Miniatyrbildet er for stort.');
    thumbType = await sniff(thumb);
    if (!thumbType) throw fail(415, 'Miniatyrbildet må være WebP eller JPEG.');
  }
  const category = String(form.get('category') ?? 'annet');
  if (!(BOAT_PHOTO_CATEGORIES as readonly string[]).includes(category)) throw fail(400, 'Ukjent bildetype.', { field: 'category' });
  const caption = String(form.get('caption') ?? '').trim().slice(0, 300) || null;
  const dim = (k: string) => { const n = Number(form.get(k)); return Number.isInteger(n) && n > 0 && n < 20_000 ? n : null; };

  const id = newId('bp');
  const key = `baater/${boatId}/${id}.${TYPES[type]}`;
  const thumbKey = thumbType ? `baater/${boatId}/${id}-thumb.${TYPES[thumbType]}` : null;
  const meta = { boatId, uploadedBy: user.id };
  await c.env.PHOTOS.put(key, image.stream(), { httpMetadata: { contentType: type }, customMetadata: meta });
  if (thumbKey && thumb instanceof File) await c.env.PHOTOS.put(thumbKey, thumb.stream(), { httpMetadata: { contentType: thumbType! }, customMetadata: meta });
  try {
    await db.prepare(`INSERT INTO boat_photos (id, boat_id, r2_key, thumb_key, content_type, width, height, bytes, category, caption, uploaded_by)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, boatId, key, thumbKey, type, dim('width'), dim('height'), image.size, category, caption, user.id).run();
  } catch (e) {
    await c.env.PHOTOS.delete([key, ...(thumbKey ? [thumbKey] : [])]);
    throw e;
  }
  publish(c, { type: 'boat.changed', id: boatId });
  return c.json(await detail(db, boatId), 201);
});

app.get('/:id/photos/:pid', async c => {
  const row = await c.env.DB.prepare('SELECT r2_key, thumb_key FROM boat_photos WHERE id = ? AND boat_id = ?').bind(c.req.param('pid'), c.req.param('id'))
    .first<{ r2_key: string; thumb_key: string | null }>();
  if (!row) throw fail(404, 'Fant ikke bildet.');
  const key = c.req.query('thumb') && row.thumb_key ? row.thumb_key : row.r2_key;
  const obj = await c.env.PHOTOS.get(key, { onlyIf: c.req.raw.headers });
  if (!obj) throw fail(404, 'Bildet finnes ikke i lageret.');
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'private, max-age=31536000, immutable');
  if (!('body' in obj)) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers });
});

/** Slett: den som lastet opp, eller salg/produksjon. */
app.delete('/:id/photos/:pid', requireRole(...CAN_PHOTO), async c => {
  const user = c.get('user');
  const boatId = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT r2_key, thumb_key, uploaded_by FROM boat_photos WHERE id = ? AND boat_id = ?').bind(c.req.param('pid'), boatId)
    .first<{ r2_key: string; thumb_key: string | null; uploaded_by: string | null }>();
  if (!row) throw fail(404, 'Fant ikke bildet.');
  if (row.uploaded_by !== user.id && !hasRole(user, ...CAN.boats)) throw fail(403, 'Du kan bare slette egne bilder.');
  await c.env.DB.prepare('DELETE FROM boat_photos WHERE id = ?').bind(c.req.param('pid')).run();
  await c.env.PHOTOS.delete([row.r2_key, ...(row.thumb_key ? [row.thumb_key] : [])]);
  publish(c, { type: 'boat.changed', id: boatId });
  return c.json(await detail(c.env.DB, boatId));
});

export default app;
