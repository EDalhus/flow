import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { api, at, call } from './fixtures.ts';

describe('innlogging og tilgang', () => {
  it('helsesjekk krever ikke innlogging', async () => {
    const res = await exports_default_fetch('/api/health');
    expect(res.status).toBe(200);
  });

  it('returnerer innlogget bruker med roller', async () => {
    const { status, json } = await api('/me');
    expect(status).toBe(200);
    expect(json).toMatchObject({ id: 'u_jonas', short_name: 'Jonas B.' });
    expect(json.roles.sort()).toEqual(['kaiarbeider', 'produksjon']);
  });

  it('avviser ukjente e-poster, men oppretter admin fra ADMIN_EMAILS', async () => {
    expect((await api('/me', { as: 'fremmed@example.com' })).status).toBe(403);
    const boss = await api('/me', { as: 'sjef@flow.example' });
    expect(boss.status).toBe(200);
    expect(boss.json.roles).toEqual(['admin']);
  });

  it('kaiarbeidere kan ikke opprette anløp', async () => {
    const res = await api('/port-calls', { as: 'ola', body: call('2030-03-01', '08:00', '10:00') });
    expect(res.status).toBe(403);
  });

  it('svarer med JSON på ukjente ruter', async () => {
    const res = await api('/finnes-ikke');
    expect(res).toEqual({ status: 404, json: { error: 'Fant ikke ressursen.' } });
  });
});

describe('anløp', () => {
  it('validerer input med zod', async () => {
    const res = await api('/port-calls', { body: call('2030-03-02', '10:00', '09:00') });
    expect(res.status).toBe(400);
    expect(res.json.issues).toContainEqual({ path: 'etd', message: 'ETD må være etter ETA.' });

    const bad = await api('/port-calls', { body: { ...call('2030-03-02', '08:00', '09:00'), goods: [{ sku_id: 's_hav_bb', quantity: -1 }] } });
    expect(bad.status).toBe(400);
    expect(bad.json.issues[0].path).toBe('goods.0.quantity');

    const unknownBoat = await api('/port-calls', { body: call('2030-03-02', '08:00', '09:00', { boat_id: 'b_finnes_ikke' }) });
    expect(unknownBoat).toMatchObject({ status: 400, json: { field: 'boat_id' } });
  });

  it('salg kan opprette med antall roller, men ikke navn', async () => {
    const withNames = await api('/port-calls', {
      as: 'kari', body: call('2030-03-03', '08:00', '10:00', { crew: [{ crew_role: 'truck', user_id: 'u_per' }] }),
    });
    expect(withNames.status).toBe(403);

    const ok = await api('/port-calls', {
      as: 'kari', body: call('2030-03-03', '08:00', '10:00', { crew: [{ crew_role: 'truck' }, { crew_role: 'anhuker' }] }),
    });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ status: 'planlagt', seller: { id: 'u_kari' }, responsible: null, responsible_auto: false });
    expect(ok.json.crew).toHaveLength(2);
    expect(ok.json.goods[0]).toMatchObject({ direction: 'inn', tonnes: 100, label: '100 BB Hav salt' });
  });

  it('gjør eneste person til ansvarlig automatisk', async () => {
    const res = await api('/port-calls', { body: call('2030-03-04', '08:00', '10:00', { crew: [{ crew_role: 'truck', user_id: 'u_ola' }] }) });
    expect(res.json).toMatchObject({ responsible: { id: 'u_ola' }, responsible_auto: true });
  });

  it('avviser personer som ikke kan rollen', async () => {
    const res = await api('/port-calls', { body: call('2030-03-04', '12:00', '13:00', { crew: [{ crew_role: 'kaikran', user_id: 'u_ola' }] }) });
    expect(res).toMatchObject({ status: 400, json: { error: 'Ola N. er ikke registrert som kaikran.' } });
  });

  it('melder kollisjon på samme kai med forslag til løsning', async () => {
    const day = '2030-03-05';
    const first = await api('/port-calls', { body: call(day, '09:15', '12:30') });
    const check = await api('/port-calls/check', { body: call(day, '11:45', '14:30', { boat_id: 'b_b' }) });
    expect(check.status).toBe(200);
    expect(check.json.collisions).toHaveLength(1);
    expect(check.json.collisions[0]).toMatchObject({
      kind: 'quay', text: 'Kai 1 dobbeltbooket', with: [{ id: first.json.id, boat_name: 'Alfa' }],
      suggestions: [
        { kind: 'move_quay', quay_id: 'q_kai2', text: 'Flytt til Kai 2' },
        { kind: 'postpone', eta: at(day, '12:45'), etd: at(day, '15:30'), text: 'Utsett til 12:45–15:30' },
      ],
    });

    // Sjekken lagrer ingenting; opprettelse lagrer og viser kollisjonen på begge.
    const second = await api('/port-calls', { body: call(day, '11:45', '14:30', { boat_id: 'b_b' }) });
    expect(second.status).toBe(201);
    expect(second.json.collisions[0].with[0].boat_name).toBe('Alfa');
    const list = await api(`/port-calls?from=${day}&to=${day}`);
    expect(list.json.calls).toHaveLength(2);
    expect(list.json.collisions).toHaveLength(1);
    expect(list.json.calls.every((c: { collisions: unknown[] }) => c.collisions.length === 1)).toBe(true);
  });

  it('melder samme person på to anløp og for mange på samme rolle', async () => {
    const day = '2030-03-06';
    const trucks = (n: number, first?: string) => Array.from({ length: n }, (_, i) => ({ crew_role: 'truck', user_id: i === 0 ? first ?? null : null }));
    await api('/port-calls', { body: call(day, '08:00', '12:00', { crew: trucks(3, 'u_per') }) });
    const res = await api('/port-calls', { body: call(day, '10:00', '13:00', { quay_id: 'q_kai2', boat_id: 'b_b', crew: trucks(2, 'u_per') }) });
    const kinds = res.json.collisions.map((c: { kind: string; text: string }) => [c.kind, c.text]);
    expect(kinds).toContainEqual(['person', 'Per H. står på begge']);
    expect(kinds).toContainEqual(['capacity', '5 trucksjåfører trengs, 4 på vakt']);

    // Med fem på vakt den dagen er kapasiteten ok.
    const shifts = await api(`/shifts/${day}`, {
      method: 'PUT',
      body: { entries: ['u_jonas', 'u_ola', 'u_per'].map(user_id => ({ user_id, crew_role: 'truck' })).concat([{ user_id: 'u_morten', crew_role: 'truck' }, { user_id: 'u_stian', crew_role: 'truck' }]) },
    });
    expect(shifts.json.capacity.truck).toBe(5);
    const after = await api(`/port-calls/${res.json.id}`);
    expect(after.json.collisions.map((c: { kind: string }) => c.kind)).toEqual(['person']);
  });

  it('bruker optimistisk låsing ved endring', async () => {
    const created = await api('/port-calls', { body: call('2030-03-07', '08:00', '10:00') });
    const id = created.json.id;
    const ok = await api(`/port-calls/${id}`, { method: 'PATCH', body: { version: 1, quay_id: 'q_kai2', etd: at('2030-03-07', '11:00') } });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ version: 2, quay: { id: 'q_kai2' }, etd: at('2030-03-07', '11:00') });

    const stale = await api(`/port-calls/${id}`, { method: 'PATCH', body: { version: 1, notes: 'gammel' } });
    expect(stale.status).toBe(409);

    const flipped = await api(`/port-calls/${id}`, { method: 'PATCH', body: { version: 2, type: 'henting' } });
    expect(flipped.json.goods[0].direction).toBe('ut');

    const bad = await api(`/port-calls/${id}`, { method: 'PATCH', body: { version: 3, etd: at('2030-03-07', '07:00') } });
    expect(bad.status).toBe(400);
  });

  it('setter mannskap og ansvarlig, og varsler de som blir satt opp', async () => {
    const created = await api('/port-calls', { body: call('2030-03-08', '08:00', '10:00', { crew: [{ crew_role: 'truck' }, { crew_role: 'anhuker' }] }) });
    const id = created.json.id;
    const slots = [{ crew_role: 'truck', user_id: 'u_per' }, { crew_role: 'anhuker', user_id: 'u_stian' }];

    const wrongResp = await api(`/port-calls/${id}/crew`, { method: 'PUT', body: { version: 1, slots, responsible_user_id: 'u_ola' } });
    expect(wrongResp.status).toBe(400);

    const salg = await api(`/port-calls/${id}/crew`, { as: 'kari', method: 'PUT', body: { version: 1, slots } });
    expect(salg.status).toBe(403);

    const ok = await api(`/port-calls/${id}/crew`, { method: 'PUT', body: { version: 1, slots, responsible_user_id: 'u_per' } });
    expect(ok.status).toBe(200);
    expect(ok.json.responsible.id).toBe('u_per');
    expect(ok.json.crew.map((s: { user: { id: string } }) => s.user.id)).toEqual(['u_per', 'u_stian']);

    const notes = await api('/notifications', { as: 'stian' });
    expect(notes.json.items[0]).toMatchObject({ kind: 'assigned', port_call_id: id });
    expect(notes.json.items[0].text).toMatch(/^Du er satt opp som anhuker · Alfa 08\.03 08:00$/);

    // Salg kan legge til en tom rolle uten å røre navnene.
    const more = await api(`/port-calls/${id}/crew`, { as: 'kari', method: 'PUT', body: { version: 2, slots: [...slots, { crew_role: 'truck' }] } });
    expect(more.status).toBe(200);
    expect(more.json.responsible.id).toBe('u_per');
  });
});

describe('kaibok', () => {
  it('leverer kaibok: ferdig, ny snittrating, melding i chatten', async () => {
    const created = await api('/port-calls', {
      as: 'kari', body: call('2030-03-11', '08:00', '10:00', { boat_id: 'b_c', crew: [{ crew_role: 'truck' }] }),
    });
    const id = created.json.id;

    const missing = await api(`/port-calls/${id}/quay-log`, { as: 'ola', body: { had_deviation: true, ratings: { punctuality: 2, cooperation: 3, equipment: 1 } } });
    expect(missing.status).toBe(400);
    expect(missing.json.issues[0].path).toBe('description');

    const salg = await api(`/port-calls/${id}/quay-log`, { as: 'kari', body: { had_deviation: false, ratings: { punctuality: 5, cooperation: 5, equipment: 5 } } });
    expect(salg.status).toBe(403);

    const res = await api(`/port-calls/${id}/quay-log`, {
      as: 'ola',
      body: {
        had_deviation: true, categories: ['utstyr_kran', 'forsinkelse'], description: 'Båtkrana stoppet to ganger.',
        ratings: { punctuality: 2, cooperation: 3, equipment: 1 }, boat_note: 'Ha egne stropper klare.',
      },
    });
    expect(res.status).toBe(201);
    expect(res.json.port_call).toMatchObject({ status: 'ferdig', has_quay_log: true });
    expect(res.json.quay_log).toMatchObject({ had_deviation: true, avg: 2, delivered_by: { id: 'u_ola' } });
    expect(res.json.boat).toMatchObject({ rating_count: 1, avg_total: 2, flag_auto: 'red' });

    const msgs = await api(`/port-calls/${id}/messages`);
    expect(msgs.json.at(-1)).toMatchObject({
      kind: 'system', author: null,
      body: 'Kaibok levert av Ola N. · avvik: utstyr / kran, forsinkelse · 2,0 av 5. Anløpet er satt til Ferdig.',
    });
    const seller = await api('/notifications', { as: 'kari' });
    expect(seller.json.items[0]).toMatchObject({ kind: 'quay_log', text: 'Kaibok levert · Charlie · avvik' });

    // Bare én kaibok, og ferdige anløp kan ikke endres.
    expect((await api(`/port-calls/${id}/quay-log`, { as: 'ola', body: { had_deviation: false, ratings: { punctuality: 5, cooperation: 5, equipment: 5 } } })).status).toBe(409);
    expect((await api(`/port-calls/${id}`, { method: 'PATCH', body: { version: 1, notes: 'x' } })).status).toBe(409);

    const boat = await api('/boats/b_c');
    expect(boat.json).toMatchObject({ flag: 'red', rating_count: 1, avg_equipment: 1 });
    expect(boat.json.recent_logs[0].boat_note).toBe('Ha egne stropper klare.');
  });

  it('lister kaibøker med filter og nøkkeltall', async () => {
    const created = await api('/port-calls', { body: call('2030-03-12', '08:00', '10:00', { boat_id: 'b_d', crew: [{ crew_role: 'truck', user_id: 'u_per' }] }) });
    await api(`/port-calls/${created.json.id}/quay-log`, { body: { had_deviation: false, ratings: { punctuality: 5, cooperation: 4, equipment: 3 } } });
    const all = await api('/quay-logs?days=60&q=delta');
    expect(all.json.items).toHaveLength(1);
    expect(all.json.items[0]).toMatchObject({ boat: { name: 'Delta' }, avg: 4, crew: [{ id: 'u_per' }] });
    const ok = await api('/quay-logs?filter=ok');
    expect(ok.json.items.every((l: { had_deviation: boolean }) => !l.had_deviation)).toBe(true);
  });
});

describe('chat og varsler', () => {
  it('lagrer @-tagging og varsler den som blir tagget', async () => {
    const created = await api('/port-calls', { body: call('2030-03-13', '08:00', '10:00') });
    const id = created.json.id;
    const msg = await api(`/port-calls/${id}/messages`, { as: 'kari', body: { body: '@Jonas B. og @Ola N. – rekker vi avgang 11:00?' } });
    expect(msg.status).toBe(201);
    expect(msg.json.mentions.sort()).toEqual(['u_jonas', 'u_ola']);

    const ola = await api('/notifications', { as: 'ola' });
    const n = ola.json.items.find((x: { message_id: string }) => x.message_id === msg.json.id);
    expect(n).toMatchObject({ kind: 'mention', text: 'Kari S. nevnte deg · Alfa', read_at: null });

    const read = await api('/notifications/read', { as: 'ola', body: { ids: [n.id] } });
    expect(read.json.updated).toBe(1);
    expect((await api('/messages-finnes-ikke')).status).toBe(404);
    expect((await api(`/port-calls/${id}/messages`, { body: { body: '   ' } })).status).toBe(400);
  });
});

describe('sanntid', () => {
  it('sender hendelser over WebSocket, og varsler bare til den som er tagget', async () => {
    const { exports } = await import('cloudflare:workers');
    const connect = async (user: string) => {
      const res = await exports.default.fetch(new Request('http://flow.test/api/ws', { headers: { Upgrade: 'websocket', 'X-Dev-User': `${user}@flow.example` } }));
      expect(res.status).toBe(101);
      const ws = res.webSocket!;
      ws.accept();
      const events: { type: string }[] = [];
      ws.addEventListener('message', e => events.push(JSON.parse(e.data as string)));
      return { ws, events };
    };
    const ola = await connect('ola');
    const per = await connect('per');

    const created = await api('/port-calls', { body: call('2030-03-14', '08:00', '10:00') });
    await api(`/port-calls/${created.json.id}/messages`, { body: { body: 'Hei @Ola N.' } });
    await vi.waitFor(() => expect(ola.events.map(e => e.type)).toEqual(['port_call.changed', 'message.created', 'notification']));
    await vi.waitFor(() => expect(per.events.map(e => e.type)).toEqual(['port_call.changed', 'message.created']));
    ola.ws.close();
    per.ws.close();
  });

  it('krever WebSocket-oppgradering', async () => {
    expect((await api('/ws')).status).toBe(426);
  });
});

describe('båter', () => {
  it('overstyrer flagg med begrunnelse, og fjerner overstyringen', async () => {
    expect((await api('/boats/b_a/flag', { method: 'PUT', body: { flag: 'red' } })).status).toBe(400);
    expect((await api('/boats/b_a/flag', { as: 'kari', method: 'PUT', body: { flag: 'red', reason: 'Prøver' } })).status).toBe(403);
    const set = await api('/boats/b_a/flag', { method: 'PUT', body: { flag: 'yellow', reason: 'Ny skipper, følg med.' } });
    expect(set.json).toMatchObject({ flag: 'yellow', flag_overridden: true, flag_reason: 'Ny skipper, følg med.', flag_override_by: { id: 'u_jonas' } });
    const cleared = await api('/boats/b_a/flag', { method: 'DELETE' });
    expect(cleared.json).toMatchObject({ flag: 'none', flag_overridden: false });
  });

  it('oppretter båt og avviser duplikat', async () => {
    const res = await api('/boats', { as: 'kari', body: { name: 'Echo', mmsi: '257123450', ship_phone: '+47 400 10 999' } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ name: 'Echo', flag: 'none', rating_count: 0 });
    expect((await api('/boats', { as: 'kari', body: { name: 'echo' } })).status).toBe(409);
    expect((await api('/boats', { as: 'kari', body: { name: 'Foxtrot', mmsi: '123' } })).status).toBe(400);
  });
});

describe('rapporter', () => {
  it('summerer per uke med filter på produkt og retning', async () => {
    // Importert historikk i 2029; 2030 ligger i fremtiden, så hele året blir prognose (trend 1).
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO port_calls (id, boat_id, type, quay_id, eta, etd, service_date, source, completed_at)
                      VALUES ('r1', 'b_a', 'levering', 'q_kai1', '2029-03-06T08:00:00Z', '2029-03-06T10:00:00Z', '2029-03-06', 'import', '2029-03-06T10:00:00Z'),
                             ('r2', 'b_b', 'henting', 'q_kai2', '2029-03-07T08:00:00Z', '2029-03-07T10:00:00Z', '2029-03-07', 'import', '2029-03-07T10:00:00Z')`),
      env.DB.prepare(`INSERT INTO port_call_goods (id, port_call_id, sku_id, quantity, direction) VALUES
                      ('rg1', 'r1', 's_hav_bb', 100, 'inn'), ('rg2', 'r2', 's_stein_bb', 40, 'ut'), ('rg3', 'r2', 's_hav_eur', 20, 'ut')`),
    ]);
    const all = await api('/reports/weekly?year=2030');
    expect(all.status).toBe(200);
    const w10 = all.json.weeks[9];
    expect(w10).toMatchObject({ week: 10, kind: 'prognose', tonnes_prev: 160, calls_prev: 2, forecast_tonnes: 160, forecast_calls: 2 });

    const inn = await api('/reports/weekly?year=2030&direction=inn');
    expect(inn.json.weeks[9]).toMatchObject({ tonnes_prev: 100, calls_prev: 1 });
    const stein = await api('/reports/weekly?year=2030&product_id=p_stein');
    expect(stein.json.weeks[9]).toMatchObject({ tonnes_prev: 40, calls_prev: 1 });
    expect((await api('/reports/weekly?year=2030&product_id=p_ukjent')).status).toBe(400);

    const products = await api('/reports/products?year=2030&direction=ut');
    expect(products.json.rows).toContainEqual(expect.objectContaining({ name: 'Hav salt', packaging: 'BB + pall', forecast_tonnes_prev: 20 }));
  });

  it('gir punktlighet, avvik og båtsnitt', async () => {
    const res = await api('/reports/quality?weeks=8');
    expect(res.status).toBe(200);
    expect(res.json.punctuality).toHaveLength(8);
    expect(res.json).toHaveProperty('deviations.categories');
    expect(res.json).toHaveProperty('boat_ratings');
  });
});

describe('kaier hos nabobedrifter', () => {
  it('lar admin legge til nabokai med kallenavn og booke anløp der', async () => {
    expect((await api('/quays', { body: { name: 'Kai A', company: 'Nabo AS' } })).status).toBe(403);
    const created = await api('/quays', {
      as: 'admin',
      body: { name: 'Kai A', nickname: 'Fiskebrygga', company: 'Nabo AS', lat: 62.48, lon: 6.19 },
    });
    expect(created).toMatchObject({
      status: 201,
      json: { name: 'Kai A', nickname: 'Fiskebrygga', company: 'Nabo AS', active: true, lat: 62.48, lon: 6.19 },
    });
    const list = await api('/quays');
    expect(list.json.find((q: { id: string }) => q.id === created.json.id)).toMatchObject({ nickname: 'Fiskebrygga', company: 'Nabo AS' });

    const booked = await api('/port-calls', {
      body: call('2030-04-01', '09:00', '11:00', { quay_id: created.json.id, boat_id: 'b_b' }),
    });
    expect(booked).toMatchObject({
      status: 201,
      json: { quay: { id: created.json.id, name: 'Kai A', nickname: 'Fiskebrygga', company: 'Nabo AS' } },
    });

    // Samme formelle navn hos oss og nabo er OK; kollisjon bruker kallenavn + bedrift.
    await api('/quays', { as: 'admin', body: { name: 'Kai A', nickname: 'Ytre' } });
    const clash = await api('/port-calls/check', {
      body: call('2030-04-01', '10:00', '12:00', { quay_id: created.json.id, boat_id: 'b_a' }),
    });
    expect(clash.json.collisions[0]).toMatchObject({ kind: 'quay', text: 'Fiskebrygga · Nabo AS dobbeltbooket' });
  });
});

async function exports_default_fetch(path: string) {
  const { exports } = await import('cloudflare:workers');
  return exports.default.fetch(new Request(`http://flow.test${path}`));
}
