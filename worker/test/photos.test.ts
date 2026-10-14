import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { cleanupOrphanPhotos } from '../routes/photos.ts';
import { api, call } from './fixtures.ts';

const webp = (extra = 'bilde') => new File([new TextEncoder().encode(`RIFF\0\0\0\0WEBPVP8 ${extra}`)], 'a.webp', { type: 'image/webp' });

async function upload(callId: string, form: FormData, as = 'ola') {
  const res = await exports.default.fetch(new Request(`http://flow.test/api/port-calls/${callId}/photos`, {
    method: 'POST', body: form, headers: { 'X-Dev-User': `${as}@flow.example` },
  }));
  return { status: res.status, json: (await res.json()) as any };
}

describe('avviksbilder', () => {
  it('laster opp til R2, kobler til kaiboka og serverer bildet', async () => {
    const created = await api('/port-calls', { body: call('2030-03-18', '08:00', '10:00') });
    const id = created.json.id;
    const form = new FormData();
    form.set('image', webp('stort'));
    form.set('thumb', webp('lite'));
    form.set('width', '2048');
    form.set('height', '1536');
    const up = await upload(id, form);
    expect(up.status).toBe(201);
    expect(up.json.url).toBe(`/api/photos/${up.json.id}`);

    const obj = await env.PHOTOS.get(`kaibok/${id}/${up.json.id}.webp`);
    expect(obj?.httpMetadata?.contentType).toBe('image/webp');
    expect(await obj?.text()).toContain('stort');

    const img = await exports.default.fetch(new Request(`http://flow.test${up.json.thumb_url}`, { headers: { 'X-Dev-User': 'per@flow.example' } }));
    expect(img.headers.get('content-type')).toBe('image/webp');
    expect(img.headers.get('cache-control')).toContain('immutable');
    expect(await img.text()).toContain('lite');

    const log = await api(`/port-calls/${id}/quay-log`, {
      as: 'ola', body: { had_deviation: true, categories: ['skade_gods'], description: 'Knust pall', ratings: { punctuality: 4, cooperation: 4, equipment: 4 }, photo_ids: [up.json.id] },
    });
    expect(log.status).toBe(201);
    expect(log.json.quay_log.photos).toEqual([{ id: up.json.id, url: up.json.url, thumb_url: up.json.thumb_url }]);

    // Bilder i en levert kaibok kan ikke slettes, og ferdige anløp tar ikke imot flere.
    expect((await api(`/photos/${up.json.id}`, { method: 'DELETE', as: 'ola' })).status).toBe(409);
    const late = new FormData();
    late.set('image', webp());
    expect((await upload(id, late)).status).toBe(409);
  });

  it('avviser feil filtype og manglende tilgang', async () => {
    const created = await api('/port-calls', { body: call('2030-03-19', '08:00', '10:00') });
    const png = new FormData();
    png.set('image', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])], 'a.png', { type: 'image/png' }));
    expect((await upload(created.json.id, png)).status).toBe(415);

    const ok = new FormData();
    ok.set('image', webp());
    expect((await upload(created.json.id, ok, 'kari')).status).toBe(403);
  });

  it('lar opplasteren slette ventende bilder, og rydder gamle', async () => {
    const created = await api('/port-calls', { body: call('2030-03-20', '08:00', '10:00') });
    const form = new FormData();
    form.set('image', webp());
    const a = await upload(created.json.id, form);
    expect((await api(`/photos/${a.json.id}`, { method: 'DELETE', as: 'per' })).status).toBe(403);
    expect((await api(`/photos/${a.json.id}`, { method: 'DELETE', as: 'ola' })).json).toEqual({ deleted: true });
    expect(await env.PHOTOS.head(`kaibok/${created.json.id}/${a.json.id}.webp`)).toBeNull();

    const b = await upload(created.json.id, form);
    expect(await cleanupOrphanPhotos(env, new Date(Date.now() + 49 * 3_600_000))).toBeGreaterThanOrEqual(1);
    expect((await api(`/photos/${b.json.id}`)).status).toBe(404);
  });
});
