import { describe, expect, it } from 'vitest';
import { LATEST_URL, TOKEN_URL, fetchAllLatest, matchVessels, resetFleetCache, resetTokenCache, type AisVesselInfo } from '../ais/barentswatch.ts';
import { toExternal } from '../routes/search.ts';
import { api, call } from './fixtures.ts';

const FLEET: AisVesselInfo[] = [
  { mmsi: 257123450, name: 'NORDKYN', callSign: 'LADA', imoNumber: 9123456, shipType: 70, shipLength: 88, latitude: 62.5, longitude: 6.1, msgtime: '2030-01-01T10:00:00Z' },
  { mmsi: 257999000, name: 'NORDKAPP SENIOR', shipType: 30 },
  { mmsi: 231000111, name: 'POLARSTRAND', shipType: 0 },
];

describe('globalt søk', () => {
  it('finner båter, anløp og folk i Flow', async () => {
    await api('/port-calls', { body: call('2030-04-01', '08:00', '10:00') });
    const res = await api('/search?q=alf');
    expect(res.status).toBe(200);
    expect(res.json.boats).toEqual([expect.objectContaining({ id: 'b_a', name: 'Alfa' })]);
    expect(res.json.vessels).toEqual([]);
    expect(res.json.ais_error).toMatch(/ikke satt opp/);
    expect((await api('/search?q=jonas')).json.users[0]).toMatchObject({ id: 'u_jonas' });
  });

  it('matcher fartøy på navn uten «MS», MMSI og kallesignal', () => {
    expect(matchVessels(FLEET, 'MS Nordkyn').map(v => v.mmsi)).toEqual([257123450]);
    expect(matchVessels(FLEET, 'nord').map(v => v.mmsi)).toEqual([257999000, 257123450]);
    expect(matchVessels(FLEET, '2310').map(v => v.mmsi)).toEqual([231000111]);
    expect(matchVessels(FLEET, 'lada').map(v => v.mmsi)).toEqual([257123450]);
    expect(matchVessels(FLEET, 'x')).toEqual([]);
    expect(toExternal(FLEET[0], null)).toMatchObject({ mmsi: '257123450', imo: '9123456', ship_type: 'Lasteskip', length: 88, lat: 62.5 });
    expect(toExternal(FLEET[2], 'b_x')).toMatchObject({ ship_type: null, lat: null, boat_id: 'b_x' });
  });

  it('henter hele flåten fra BarentsWatch og holder den i minnet', async () => {
    resetTokenCache(); resetFleetCache();
    let latest = 0;
    const fetcher = async (url: string) => {
      if (url === TOKEN_URL) return Response.json({ access_token: 't', expires_in: 3600 });
      expect(url).toBe(`${LATEST_URL}?modelType=Full`);
      latest++;
      return Response.json(FLEET);
    };
    const creds = { clientId: 'id', clientSecret: 'hemmelig' };
    expect(await fetchAllLatest(creds, fetcher)).toHaveLength(3);
    await fetchAllLatest(creds, fetcher);
    expect(latest).toBe(1);
    resetFleetCache();
  });
});
