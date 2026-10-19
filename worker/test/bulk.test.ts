import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { api } from './fixtures.ts';

// Bulkutlevering: registre, sjåførinnlogging (telefon + PIN), lasting med veiing, nødstopp, følgeseddel og rapporter.

/** Kall sjåfør-API-et (egen innlogging, ikke Flow-brukere). */
async function driverApi(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await exports.default.fetch(new Request(`http://flow.test/api/driver${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  }));
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, type, json: type.includes('json') ? await res.json() as any : null };
}

let reg: any;
let token: string;
const byName = (list: any[], n: string): any => list.find(x => x.name === n || x.reg_no === n);

beforeAll(async () => {
  expect((await api('/bulk/registry/haulers', { body: { name: 'Tafjord Transport' } })).status).toBe(201);
  reg = (await api('/bulk/registry')).json;
  const own = byName(reg.haulers, 'Egne biler'), ext = byName(reg.haulers, 'Tafjord Transport');
  await api('/bulk/registry/customers', { body: { name: 'Fiskebruket AS' } });
  await api('/bulk/registry/customers', { body: { name: 'Statens vegvesen', requires_project: true } });
  await api('/bulk/registry/vehicles', { body: { reg_no: 'su 20 110', hauler_id: own.id, description: 'Bil 1' } });
  await api('/bulk/registry/vehicles', { body: { reg_no: 'EL 12 908', hauler_id: ext.id, has_trailer: false } });
  expect((await api('/bulk/registry/drivers', { body: { name: 'Per Hansen', phone: '400 10 203', hauler_id: own.id } })).status).toBe(400); // PIN mangler
  expect((await api('/bulk/registry/drivers', { body: { name: 'Per Hansen', phone: '400 10 203', hauler_id: own.id, pin: '1234' } })).status).toBe(201);
  expect((await api('/bulk/registry/drivers', { body: { name: 'Dup', phone: '+47 40010203', hauler_id: own.id, pin: '1234' } })).status).toBe(409);
  reg = (await api('/bulk/registry')).json;
});

describe('bulk: registre og innlogging', () => {
  it('lagrer registre; reg.nr. med store bokstaver og telefon som sifre', () => {
    expect(byName(reg.vehicles, 'SU 20 110')).toMatchObject({ description: 'Bil 1', has_trailer: true });
    expect(byName(reg.drivers, 'Per Hansen')).toMatchObject({ phone: '4740010203', has_pin: true, hauler: { name: 'Egne biler', own: true } });
    expect(byName(reg.customers, 'Statens vegvesen').requires_project).toBe(true);
  });

  it('sjåfør logger inn med telefon + PIN, og låses etter fem feil', async () => {
    expect((await driverApi('/me')).status).toBe(401);
    expect((await driverApi('/login', { body: { phone: '40010203', pin: '9999' } })).status).toBe(401);
    const ok = await driverApi('/login', { body: { phone: '400 10 203', pin: '1234' } });
    expect(ok.status).toBe(200);
    token = ok.json.token;
    const me = await driverApi('/me', { token });
    expect(me.json.driver).toMatchObject({ name: 'Per Hansen', hauler: { name: 'Egne biler' } });
    expect(me.json.vehicles.map((v: { reg_no: string }) => v.reg_no)).toEqual(['SU 20 110']); // bare eget transportfirma
    // Sjåføren har ikke tilgang til resten av Flow.
    expect((await exports.default.fetch(new Request('http://flow.test/api/bulk/registry', { headers: { Authorization: `Bearer ${token}`, 'X-Dev-User': 'ukjent@x.no' } }))).status).toBe(403);

    const ext = byName(reg.haulers, 'Tafjord Transport');
    await api('/bulk/registry/drivers', { body: { name: 'Lås Test', phone: '99999999', hauler_id: ext.id, pin: '4321' } });
    for (let i = 0; i < 5; i++) await driverApi('/login', { body: { phone: '99999999', pin: '0000' } });
    expect((await driverApi('/login', { body: { phone: '99999999', pin: '4321' } })).status).toBe(429);
  });
});

describe('bulk: lasting', () => {
  it('bestilling krever prosjektnummer for noen kunder, og egen bil', async () => {
    const vegvesen = byName(reg.customers, 'Statens vegvesen');
    const own = byName(reg.vehicles, 'SU 20 110'), ext = byName(reg.vehicles, 'EL 12 908');
    const base = { vehicle_id: own.id, customer_id: vegvesen.id, steps: [{ quality_id: 'veisalt', tonnes: 16, target: 'bil' }] };
    expect((await driverApi('/orders', { token, body: base })).json).toMatchObject({ field: 'project_no', error: 'Statens vegvesen krever prosjektnummer.' });
    expect((await driverApi('/orders', { token, body: { ...base, vehicle_id: ext.id, project_no: 'P-1' } })).status).toBe(403);
    expect((await driverApi('/orders', { token, body: { ...base, project_no: 'P-1', so_number: '123' } })).status).toBe(400);
    const ok = await driverApi('/orders', { token, body: { ...base, project_no: 'P-1' } });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ customer: { name: 'Statens vegvesen' }, project_no: 'P-1', vehicle: { reg_no: 'SU 20 110' }, booked_by: 'sjafor' });
    // Kontoret ser den i køen.
    expect((await api('/bulk/orders')).json.some((o: { id: string }) => o.id === ok.json.id)).toBe(true);
  });

  it('start → veid bil → pause → henger → nødstopp → fortsett → ferdig med følgeseddel', async () => {
    const cust = byName(reg.customers, 'Fiskebruket AS'), car = byName(reg.vehicles, 'SU 20 110');
    const o = (await driverApi('/orders', { token, body: {
      vehicle_id: car.id, customer_id: cust.id, so_number: '2045555',
      steps: [{ quality_id: 'havsalt', tonnes: 16, target: 'bil' }, { quality_id: 'blandet', tonnes: 12, target: 'henger' }],
    } })).json;
    const act = (a: string, body: unknown = {}) => driverApi(`/orders/${o.id}/${a}`, { token, body });
    expect((await act('step-done', { weighed_tonnes: 16 })).status).toBe(409);
    expect((await act('start')).json.status).toBe('lastes');
    expect((await act('step-done', {})).status).toBe(400);
    const s1 = await act('step-done', { weighed_tonnes: 15.84 });
    expect(s1.json.steps[0]).toMatchObject({ weighed_tonnes: 15.84 });
    expect(s1.json.status).toBe('lastes');
    await act('start'); // henger
    const stop = await act('stop');
    expect(stop.json.stopped_at).toBeTruthy();
    expect((await act('step-done', { weighed_tonnes: 12 })).status).toBe(409); // stoppet
    const notes = (await api('/notifications')).json.items;
    expect(notes.some((n: { text: string }) => n.text.startsWith('NØDSTOPP ved utlastingen: SU 20 110'))).toBe(true);
    await act('continue');
    const done = await act('step-done', { weighed_tonnes: 12.1 });
    expect(done.json).toMatchObject({ status: 'ferdig', weighed_tonnes: 27.94, has_pdf: true });
    expect(done.json.delivery_no).toBeGreaterThan(1000);

    const pdf = await driverApi(`/orders/${o.id}/pdf`, { token });
    expect(pdf).toMatchObject({ status: 200, type: 'application/pdf' });
    const log = (await api(`/bulk/orders/${o.id}/log`)).json.map((l: { kind: string }) => l.kind).reverse();
    expect(log).toEqual(['booked', 'started', 'weighed', 'started', 'stopped', 'continued', 'weighed', 'finished']);
    expect((await act('cancel')).status).toBe(409);
  });

  it('viser dagens veiinger og rapport per kvalitet, kunde, bil og sjåfør', async () => {
    const w = (await api('/bulk/weighings')).json;
    expect(w.filter((x: { customer: string }) => x.customer === 'Fiskebruket AS').map((x: { weighed: number }) => x.weighed).sort()).toEqual([12.1, 15.84]);
    const q = (await api('/bulk/report?group=kvalitet')).json;
    expect(q.rows).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Havsalt', weighed: 15.84, loads: 1 })]));
    for (const group of ['kunde', 'bil', 'sjafor', 'transportor', 'prosjekt', 'dag']) {
      const r = (await api(`/bulk/report?group=${group}`)).json;
      expect(r.total).toMatchObject({ loads: 1, weighed: 27.94 });
    }
    expect((await api('/bulk/report?group=sjafor')).json.rows[0].label).toBe('Per Hansen');
    expect((await api('/bulk/report?group=feil')).status).toBe(400);
  });

  it('sjåfør kan avbestille før start, men ikke andres bestillinger', async () => {
    const cust = byName(reg.customers, 'Fiskebruket AS'), car = byName(reg.vehicles, 'SU 20 110');
    const o = (await api('/bulk/orders', { body: { vehicle_id: car.id, customer_id: cust.id, steps: [{ quality_id: 'havsalt', tonnes: 10, target: 'bil' }] } })).json;
    expect((await driverApi(`/orders/${o.id}/cancel`, { token, body: {} })).status).toBe(404); // ikke hans
    const mine = (await driverApi('/orders', { token, body: { vehicle_id: car.id, customer_id: cust.id, steps: [{ quality_id: 'havsalt', tonnes: 10, target: 'bil' }] } })).json;
    expect((await driverApi(`/orders/${mine.id}/cancel`, { token, body: {} })).json.status).toBe('avlyst');
    // Hjelp med Claude: av uten nøkkel.
    expect((await driverApi('/me', { token })).json.ai).toBe(false);
    expect((await driverApi('/help', { token, body: { question: 'Hvordan starter jeg?' } })).status).toBe(503);
  });
});
