import { Hono } from 'hono';
import { CAN, hasRole, requireRole } from '../auth/access.ts';
import { fail, newId } from '../lib/http.ts';
import type { AppEnv } from '../types.ts';

// Avviksbilder. Nettleseren skalerer ned og koder til WebP (eller JPEG) før opplasting,
// så Workeren bare validerer og lagrer i R2. Bildene serveres gjennom Workeren (bak Access).

const MAX_IMAGE = 4 * 1024 * 1024;
const MAX_THUMB = 400 * 1024;
const MAX_PENDING = 20;
const TYPES: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg' };

/** Sjekker filsignaturen, ikke bare Content-Type. */
async function sniff(file: File): Promise<string | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Montert på /api/port-calls: POST /:id/photos (multipart: image, thumb, width, height). */
export const upload = new Hono<AppEnv>();

upload.post('/:id/photos', requireRole(...CAN.quayLog), async c => {
  const callId = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;
  const call = await db
    .prepare(`SELECT pc.completed_at, pc.cancelled_at, (SELECT count(*) FROM quay_log_photos p WHERE p.port_call_id = pc.id AND p.quay_log_id IS NULL) AS pending
              FROM port_calls pc WHERE pc.id = ? AND pc.source = 'app'`)
    .bind(callId)
    .first<{ completed_at: string | null; cancelled_at: string | null; pending: number }>();
  if (!call) throw fail(404, 'Fant ikke anløpet.');
  if (call.completed_at || call.cancelled_at) throw fail(409, 'Anløpet er avsluttet; bilder kan ikke legges til.');
  if (call.pending >= MAX_PENDING) throw fail(400, `Maks ${MAX_PENDING} bilder per kaibok.`);

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
  const dim = (k: string) => { const n = Number(form.get(k)); return Number.isInteger(n) && n > 0 && n < 20_000 ? n : null; };

  const id = newId('ph');
  const key = `kaibok/${callId}/${id}.${TYPES[type]}`;
  const thumbKey = thumbType ? `kaibok/${callId}/${id}-thumb.${TYPES[thumbType]}` : null;
  const meta = { callId, uploadedBy: user.id };
  await c.env.PHOTOS.put(key, image.stream(), { httpMetadata: { contentType: type }, customMetadata: meta });
  if (thumbKey && thumb instanceof File) {
    await c.env.PHOTOS.put(thumbKey, thumb.stream(), { httpMetadata: { contentType: thumbType! }, customMetadata: meta });
  }
  try {
    await db.prepare(`INSERT INTO quay_log_photos (id, port_call_id, r2_key, thumb_key, content_type, width, height, bytes, uploaded_by)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, callId, key, thumbKey, type, dim('width'), dim('height'), image.size, user.id).run();
  } catch (e) {
    await c.env.PHOTOS.delete([key, ...(thumbKey ? [thumbKey] : [])]);
    throw e;
  }
  return c.json({ id, url: `/api/photos/${id}`, thumb_url: thumbKey ? `/api/photos/${id}?thumb=1` : null }, 201);
});

/** Montert på /api/photos. */
export const photos = new Hono<AppEnv>();

photos.get('/:id', async c => {
  const row = await c.env.DB.prepare('SELECT r2_key, thumb_key FROM quay_log_photos WHERE id = ?').bind(c.req.param('id'))
    .first<{ r2_key: string; thumb_key: string | null }>();
  if (!row) throw fail(404, 'Fant ikke bildet.');
  const key = c.req.query('thumb') && row.thumb_key ? row.thumb_key : row.r2_key;
  const obj = await c.env.PHOTOS.get(key, { onlyIf: c.req.raw.headers });
  if (!obj) throw fail(404, 'Bildet finnes ikke i lageret.');
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  // Bildene endres aldri; privat cache fordi de ligger bak innlogging.
  headers.set('cache-control', 'private, max-age=31536000, immutable');
  if (!('body' in obj)) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers });
});

/** Fjern et bilde som ennå ikke er lagret i en kaibok. */
photos.delete('/:id', requireRole(...CAN.quayLog), async c => {
  const user = c.get('user');
  const row = await c.env.DB.prepare('SELECT r2_key, thumb_key, quay_log_id, uploaded_by FROM quay_log_photos WHERE id = ?').bind(c.req.param('id'))
    .first<{ r2_key: string; thumb_key: string | null; quay_log_id: string | null; uploaded_by: string | null }>();
  if (!row) throw fail(404, 'Fant ikke bildet.');
  if (row.quay_log_id) throw fail(409, 'Bildet hører til en levert kaibok og kan ikke slettes.');
  if (row.uploaded_by !== user.id && !hasRole(user, ...CAN.crew)) throw fail(403, 'Du kan bare slette egne bilder.');
  await c.env.DB.prepare('DELETE FROM quay_log_photos WHERE id = ?').bind(c.req.param('id')).run();
  await c.env.PHOTOS.delete([row.r2_key, ...(row.thumb_key ? [row.thumb_key] : [])]);
  return c.json({ deleted: true });
});

/** Rydder bilder som ble lastet opp men aldri lagret i en kaibok (eldre enn 48 t). */
export async function cleanupOrphanPhotos(env: Env, now = new Date()) {
  const { results } = await env.DB
    .prepare(`SELECT id, r2_key, thumb_key FROM quay_log_photos WHERE quay_log_id IS NULL AND created_at < ? LIMIT 500`)
    .bind(new Date(now.getTime() - 48 * 3_600_000).toISOString())
    .all<{ id: string; r2_key: string; thumb_key: string | null }>();
  if (!results.length) return 0;
  await env.PHOTOS.delete(results.flatMap(r => [r.r2_key, ...(r.thumb_key ? [r.thumb_key] : [])]));
  await env.DB.prepare(`DELETE FROM quay_log_photos WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(results.map(r => r.id))).run();
  return results.length;
}
