import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { STALE_MIN, destination, mergeArea, metersAfter, shipCategory, thin } from '../../shared/domain/ais.ts';
import { distanceM, insideGeofence } from '../../shared/domain/geo.ts';
import { syncArea } from '../ais/area.ts';
import { LATEST_URL, TOKEN_URL, resetTokenCache, type AisPosition } from '../ais/barentswatch.ts';
import { syncAis } from '../ais/sync.ts';
import { api } from './fixtures.ts';

const FENCE = { lat: 62.47918, lon: 6.19292, radius_m: 300 };
const withKeys = { ...env, BW_CLIENT_ID: 'test-id', BW_CLIENT_SECRET: 'test-hemmelighet' } as Env;

/** Falsk BarentsWatch: teller kall og svarer med gitte posisjoner. */
function fakeBarentsWatch(positions: () => AisPosition[]) {
  const calls = { token: 0, latest: 0, body: null as unknown };
  const fetcher = async (url: string, init?: RequestInit) => {
    if (url === TOKEN_URL) {
      calls.token++;
      const form = new URLSearchParams(init?.body as string);
      expect(form.get('grant_type')).toBe('client_credentials');
      expect(form.get('scope')).toBe('ais');
      expect(form.get('client_secret')).toBe('test-hemmelighet');
      return Response.json({ access_token: 'tok', expires_in: 3600 });
    }
    if (url === LATEST_URL) {
      calls.latest++;
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok');
      calls.body = JSON.parse(init?.body as string);
      return Response.json(positions());
    }
    return new Response('ukjent', { status: 404 });
  };
  return { calls, fetcher };
}

describe('geofence', () => {
  it('måler avstand og sjekker radius', () => {
    expect(distanceM(FENCE, { lat: FENCE.lat + 0.001, lon: FENCE.lon })).toBeCloseTo(111, 0);
    expect(insideGeofence({ lat: 62.4793, lon: 6.1925 }, FENCE)).toBe(true);
    expect(insideGeofence({ lat: 62.47, lon: 6.15 }, FENCE)).toBe(false);
  });
});

describe('AIS-synk', () => {
  beforeEach(() => resetTokenCache());

  it('hopper over uten nøkler og lagrer status', async () => {
    const r = await syncAis(env);
    expect(r).toMatchObject({ ok: false, configured: false });
    const view = await api('/ais');
    expect(view.json.status.configured).toBe(false);
  });

  it('setter ankomst og avgang fra geofence, og gjenbruker token', async () => {
    await env.DB.prepare(`INSERT OR IGNORE INTO boats (id, name, mmsi) VALUES ('b_ais', 'Aisbåt', '257000001')`).run();
    const now = new Date();
    const created = await api('/port-calls', {
      body: {
        boat_id: 'b_ais', type: 'levering', quay_id: 'q_kai1',
        eta: new Date(now.getTime() - 3_600_000).toISOString(), etd: new Date(now.getTime() + 2 * 3_600_000).toISOString(),
        goods: [{ sku_id: 's_hav_bb', quantity: 10 }], crew: [],
      },
    });
    const id = created.json.id;

    let pos: AisPosition = { mmsi: 257000001, latitude: 62.4793, longitude: 6.1925, speedOverGround: 0.2, msgtime: now.toISOString() };
    const bw = fakeBarentsWatch(() => [pos]);

    const r1 = await syncAis(withKeys, now, bw.fetcher);
    expect(r1).toMatchObject({ ok: true, positions: 1, arrived: [id] });
    expect((bw.calls.body as { mmsi: number[] }).mmsi).toContain(257000001);
    let call = await api(`/port-calls/${id}`);
    expect(call.json).toMatchObject({ status: 'ved_kai', status_basis: 'ais', arrived_at: now.toISOString() });

    // Samme posisjon igjen: ingen ny ankomst.
    const r2 = await syncAis(withKeys, now, bw.fetcher);
    expect(r2.arrived).toEqual([]);

    // Båten går ut av geofencen.
    const later = new Date(now.getTime() + 90 * 60_000);
    pos = { ...pos, latitude: 62.47, longitude: 6.15, speedOverGround: 9, msgtime: later.toISOString() };
    const r3 = await syncAis(withKeys, later, bw.fetcher);
    expect(r3.departed).toEqual([id]);
    call = await api(`/port-calls/${id}`);
    expect(call.json).toMatchObject({ status: 'kaibok_mangler', status_basis: 'ais' });
    expect(bw.calls.token).toBe(1);

    const view = await api('/ais');
    const v = view.json.vessels.find((x: { mmsi: string }) => x.mmsi === '257000001');
    expect(v).toMatchObject({ name: 'Aisbåt', in_geofence: false, sog: 9 });
    expect(v.track.length).toBeGreaterThanOrEqual(2);
  });

  it('lar admin kjøre sjekk nå, uten å avsløre nøkkelverdier', async () => {
    expect((await api('/ais/sync', { body: {} })).status).toBe(403); // jonas er ikke admin
    const res = await api('/ais/sync', { as: 'admin', body: {} });
    expect(res.status).toBe(200);
    expect(res.json.secrets).toEqual({ BW_CLIENT_ID: false, BW_CLIENT_SECRET: false });
    expect(res.json.client_name).toBeNull();
    expect(res.json.result).toMatchObject({ ok: false, configured: false });
    expect(res.json.result.message).toContain('BW_CLIENT_ID og BW_CLIENT_SECRET');
    expect(res.json.result.message).toContain('ikke under Build');
  });

  it('melder feil fra BarentsWatch uten å krasje', async () => {
    await env.DB.prepare(`INSERT OR IGNORE INTO boats (id, name, mmsi) VALUES ('b_ais2', 'Aisbåt 2', '257000002')`).run();
    const r = await syncAis(withKeys, new Date(), async () => new Response('nei', { status: 500 }));
    expect(r).toMatchObject({ ok: false, configured: true, message: 'BarentsWatch-innlogging feilet (500).' });

    // OAuth-feil forklares, og verdier med mellomrom/linjeskift renskes.
    const r2 = await syncAis(withKeys, new Date(), async () => Response.json({ error: 'invalid_scope' }, { status: 400 }));
    expect(r2.message).toBe('BarentsWatch-innlogging feilet (400 invalid_scope): klienten har ikke AIS-tilgang. Registrer en klient av typen «AIS» på Min side hos BarentsWatch.');
    resetTokenCache();
    const padded = { ...withKeys, BW_CLIENT_ID: '  test-id\n', BW_CLIENT_SECRET: 'test-hemmelighet\n' } as Env;
    const bw = fakeBarentsWatch(() => []);
    expect((await syncAis(padded, new Date(), bw.fetcher)).ok).toBe(true);
  });
});

describe('trafikkbildet rundt kaia', () => {
  beforeEach(() => resetTokenCache());

  it('bygger opp spor, kutter gamle punkter og fjerner fartøy som er borte', () => {
    const t0 = new Date('2026-10-16T10:00:00Z');
    const at = (min: number) => new Date(t0.getTime() + min * 60_000);
    const msg = (min: number, lat: number) => ({ mmsi: 257111222, name: 'NORFRAKT ', shipType: 70, latitude: lat, longitude: 6.1, speedOverGround: 9, courseOverGround: 210, msgtime: at(min).toISOString() });
    let area = mergeArea([], [msg(0, 62.5)], at(0));
    area = mergeArea(area, [msg(1, 62.49)], at(1));
    area = mergeArea(area, [msg(1, 62.49)], at(2)); // samme melding: ikke nytt punkt
    expect(area).toHaveLength(1);
    expect(area[0]).toMatchObject({ mmsi: '257111222', name: 'NORFRAKT', ship_type: 70, lat: 62.49, sog: 9 });
    expect(area[0].trail).toHaveLength(2);
    area = mergeArea(area, [msg(20, 62.4)], at(20));
    expect(area[0].trail.map(p => p[1])).toEqual([62.4]);
    expect(mergeArea(area, [], at(20 + STALE_MIN + 1))).toEqual([]);
  });

  it('henter området rundt geofencen og viser det i /ais', async () => {
    let body: { geometry?: { coordinates: number[][][] }; modelType?: string } = {};
    const fetcher = async (url: string, init?: RequestInit) => {
      if (url === TOKEN_URL) return Response.json({ access_token: 'tok', expires_in: 3600 });
      if (url === LATEST_URL) {
        body = JSON.parse(init?.body as string);
        return Response.json([{ mmsi: 257999000, name: 'NABOBÅT', shipType: 30, latitude: 62.5, longitude: 6.2, speedOverGround: 7, msgtime: new Date().toISOString() }]);
      }
      return new Response('ukjent', { status: 404 });
    };
    expect(await syncArea(withKeys, new Date(), fetcher)).toBe(1);
    expect(body.modelType).toBe('Full');
    const [w, s] = body.geometry!.coordinates[0][0];
    expect(w).toBeLessThan(6.19292);
    expect(s).toBeLessThan(62.47918);
    const view = await api('/ais');
    expect(view.json.area).toEqual([expect.objectContaining({ mmsi: '257999000', name: 'NABOBÅT', ship_type: 30 })]);
  });

  it('beregner punkt langs kursen og tynner ut spor', () => {
    const [lon, lat] = destination(62.5, 6.2, 0, metersAfter(10, 6));
    expect(lon).toBeCloseTo(6.2, 6);
    expect(distanceM({ lat: 62.5, lon: 6.2 }, { lat, lon })).toBeCloseTo(1852, -1);
    expect(thin([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([1, 4, 7, 10]);
    expect(shipCategory(30)).toBe('fiske');
    expect(shipCategory(75)).toBe('last');
  });
});
