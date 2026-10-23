import { describe, expect, it } from 'vitest';
import { api, at, call, soNumber } from './fixtures.ts';

// Salgsordre (SO) er sannheten; anløpet er båten. Testene bruker egne dager i april 2030.

const line = (quantity: number, sku = 's_hav_bb', direction = 'ut') => ({ sku_id: sku, quantity, direction });
const order = (extra: Record<string, unknown> = {}) => ({ so_number: soNumber(), customer: 'Hessa Seafood', lines: [line(100)], ...extra });
const newCall = (day: string, from: string, to: string, boat = 'b_a', quay = 'q_kai1') =>
  ({ kind: 'new', call: { boat_id: boat, quay_id: quay, eta: at(day, from), etd: at(day, to) } });
const kinds = (log: { kind: string }[]) => log.map(l => l.kind).reverse();

describe('salgsordre', () => {
  it('validerer SO-nummer (20 + fem siffer) og avviser duplikater', async () => {
    const bad = await api('/orders', { body: order({ so_number: '1943644' }) });
    expect(bad.status).toBe(400);
    expect(bad.json.issues[0]).toMatchObject({ path: 'so_number', message: 'SO-nummeret må være 20 og fem siffer, f.eks. 2043644.' });
    expect((await api('/orders', { body: order({ so_number: '204364' }) })).status).toBe(400);

    const ok = await api('/orders', { as: 'ola', body: order() });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ status: 'venter', calls: [], tonnes: 100, customer: 'Hessa Seafood' });
    const dup = await api('/orders', { body: order({ so_number: ok.json.so_number, customer: 'Annen' }) });
    expect(dup).toMatchObject({ status: 409, json: { field: 'so_number', error: `SO ${ok.json.so_number} finnes allerede (Hessa Seafood).` } });

    // Kan slås opp på SO-nummeret.
    expect((await api(`/orders/${ok.json.so_number}`)).json.id).toBe(ok.json.id);
  });

  it('flere SO-er på samme båt, med lasterekkefølge', async () => {
    const day = '2030-04-02';
    const a = await api('/orders', { body: order({ placement: newCall(day, '08:00', '11:00') }) });
    expect(a.status).toBe(201);
    const callId = a.json.calls[0].id;
    expect(a.json).toMatchObject({ status: 'planlagt', calls: [{ boat_name: 'Alfa', load_seq: 1 }] });

    const b = await api('/orders', { body: order({ customer: 'Vartdal Fisk', lines: [line(40, 's_stein_bb', 'inn')], placement: { kind: 'call', port_call_id: callId } }) });
    const c = await api('/orders', { body: order({ customer: 'Fjordlaks', lines: [line(20)], placement: { kind: 'call', port_call_id: callId } }) });
    let pc = (await api(`/port-calls/${callId}`)).json;
    expect(pc.orders.map((o: { customer: string; load_seq: number }) => [o.load_seq, o.customer])).toEqual([[1, 'Hessa Seafood'], [2, 'Vartdal Fisk'], [3, 'Fjordlaks']]);
    expect(pc).toMatchObject({ type: 'begge', tonnes_in: 40, tonnes_out: 120 });

    const reorder = await api(`/port-calls/${callId}/load-order`, { method: 'PUT', body: { order_ids: [c.json.id, a.json.id, b.json.id] } });
    expect(reorder.status).toBe(200);
    expect(reorder.json.orders.map((o: { customer: string }) => o.customer)).toEqual(['Fjordlaks', 'Hessa Seafood', 'Vartdal Fisk']);
    expect(reorder.json.goods.map((g: { sales_order_id: string }) => g.sales_order_id)).toEqual([c.json.id, a.json.id, b.json.id]);
    expect((await api(`/port-calls/${callId}/load-order`, { method: 'PUT', body: { order_ids: [a.json.id] } })).status).toBe(400);

    const log = (await api(`/orders/${c.json.id}`)).json.log;
    expect(log[0]).toMatchObject({ kind: 'load_order', data: { from: 3, to: 1 }, user: { short_name: 'Jonas B.' } });
    pc = (await api(`/port-calls/${callId}/log`)).json;
    expect(pc.filter((l: { kind: string }) => l.kind === 'load_order')).toHaveLength(3);
  });

  it('bytter båt i siste liten og fører det i loggen til hver SO, og selgeren får beskjed', async () => {
    const day = '2030-04-03';
    const a = await api('/orders', { as: 'kari', body: order({ placement: newCall(day, '08:00', '11:00') }) });
    const callId = a.json.calls[0].id;
    const b = await api('/orders', { as: 'kari', body: order({ placement: { kind: 'call', port_call_id: callId } }) });
    const pc = (await api(`/port-calls/${callId}`)).json;

    // Rederiet sender Bravo i stedet, og ETA flyttes.
    const changed = await api(`/port-calls/${callId}`, { method: 'PATCH', body: { version: pc.version, boat_id: 'b_b', eta: at(day, '09:15'), etd: at(day, '12:00') } });
    expect(changed.status).toBe(200);
    for (const id of [a.json.id, b.json.id]) {
      const o = (await api(`/orders/${id}`)).json;
      expect(o.calls[0].boat_name).toBe('Bravo');
      expect(o.log[1]).toMatchObject({ kind: 'boat_changed', data: { from: 'Alfa', to: 'Bravo' }, port_call_id: callId });
      expect(o.log[0]).toMatchObject({ kind: 'eta_changed', data: { from: { eta: at(day, '08:00') }, to: { eta: at(day, '09:15') } } });
    }
    const notes = (await api('/notifications', { as: 'kari' })).json.items;
    const texts = notes.filter((n: { kind: string }) => n.kind === 'order').map((n: { text: string }) => n.text);
    expect(texts).toEqual(expect.arrayContaining([a, b].map(o => `SO ${o.json.so_number} på Bravo er endret av Jonas B.`)));
  });

  it('flytter én SO til en annen båt, og spør om tomt anløp', async () => {
    const day = '2030-04-04';
    const a = await api('/orders', { body: order({ placement: newCall(day, '08:00', '11:00') }) });
    const from = a.json.calls[0].id;
    const moved = await api(`/orders/${a.json.id}/assign`, { body: { version: a.json.version, placement: newCall(day, '13:00', '15:00', 'b_c', 'q_kai2') } });
    expect(moved.status).toBe(200);
    expect(moved.json.order.calls).toEqual([expect.objectContaining({ boat_name: 'Charlie', quay: expect.objectContaining({ id: 'q_kai2' }) })]);
    expect(moved.json.emptied).toEqual([{ id: from, boat_name: 'Alfa' }]);
    expect(moved.json.order.log[0]).toMatchObject({ kind: 'moved', data: { from: { boat: 'Alfa' }, to: { boat: 'Charlie', quay: 'Kai 2' } } });
    expect(moved.json.order.log[0].data.lines).toBeUndefined();

    // Av båten igjen: venter på båt.
    const off = await api(`/orders/${a.json.id}/assign`, { body: { version: moved.json.order.version, placement: { kind: 'none' } } });
    expect(off.json.order).toMatchObject({ status: 'venter', calls: [] });
    expect(off.json.order.log[0]).toMatchObject({ kind: 'unassigned', data: { from: { boat: 'Charlie' }, to: null } });
    expect((await api(`/orders/${a.json.id}/assign`, { body: { version: 1, placement: { kind: 'none' } } })).status).toBe(409);
  });

  it('deler en SO på to båter (delleveranse)', async () => {
    const day = '2030-04-05';
    const a = await api('/orders', { body: order({ lines: [line(300)], placement: newCall(day, '08:00', '11:00') }) });
    const lineId = a.json.lines[0].id;
    const split = await api(`/orders/${a.json.id}/assign`, {
      body: { version: a.json.version, placement: newCall(day, '13:00', '16:00', 'b_b', 'q_kai2'), lines: [{ line_id: lineId, quantity: 120 }] },
    });
    expect(split.status).toBe(200);
    const o = split.json.order;
    expect(o.calls.map((c: { boat_name: string }) => c.boat_name)).toEqual(['Alfa', 'Bravo']);
    expect(o.lines.map((l: { quantity: number }) => l.quantity).sort()).toEqual([120, 180]);
    expect(o.log[0]).toMatchObject({ kind: 'moved', data: { lines: ['120 BB Hav salt'] } });
    const pc = (await api(`/port-calls/${a.json.calls[0].id}`)).json;
    expect(pc.orders[0]).toMatchObject({ split: true, tonnes: 180 });
    expect(split.json.emptied).toEqual([]);
  });

  it('logger varer lagt til, endret og fjernet, og kunde', async () => {
    const day = '2030-04-06';
    const a = await api('/orders', { body: order({ lines: [line(100), line(20, 's_hav_eur')], placement: newCall(day, '08:00', '11:00') }) });
    const [l1, l2] = a.json.lines;
    const res = await api(`/orders/${a.json.id}`, {
      method: 'PATCH',
      body: {
        version: a.json.version, customer: 'Hessa Seafood AS',
        lines: [{ id: l1.id, sku_id: 's_hav_bb', quantity: 80, direction: 'ut' }, { sku_id: 's_stein_bb', quantity: 10, direction: 'ut' }],
      },
    });
    expect(res.status).toBe(200);
    const o = res.json.order;
    expect(o.lines.map((l: { label: string }) => l.label)).toEqual(['80 BB Hav salt', '10 BB Stein salt']);
    // Den nye linjen følger SO-en til båten.
    expect(o.lines.every((l: { port_call_id: string }) => l.port_call_id === a.json.calls[0].id)).toBe(true);
    expect(kinds(o.log)).toEqual(['created', 'assigned', 'customer', 'line_removed', 'line_changed', 'line_added']);
    expect(o.log.find((l: { kind: string }) => l.kind === 'line_removed').data.line).toBe(l2.label);
    expect(o.log.find((l: { kind: string }) => l.kind === 'line_changed').data).toEqual({ from: '100 BB Hav salt', to: '80 BB Hav salt' });
    expect((await api(`/orders/${a.json.id}`, { method: 'PATCH', body: { version: 1, customer: 'X' } })).status).toBe(409);
  });

  it('avlyst anløp sender SO-ene tilbake til «venter på båt»; kansellert SO tas av båten', async () => {
    const day = '2030-04-07';
    const a = await api('/orders', { body: order({ placement: newCall(day, '08:00', '11:00') }) });
    const callId = a.json.calls[0].id;
    const b = await api('/orders', { body: order({ placement: { kind: 'call', port_call_id: callId } }) });

    const cancelled = await api(`/orders/${b.json.id}/cancel`, { body: { version: b.json.version, reason: 'Feil i Dynamics' } });
    expect(cancelled.json.order).toMatchObject({ status: 'kansellert', calls: [] });
    expect(cancelled.json.emptied).toEqual([]);

    const pc = (await api(`/port-calls/${callId}`)).json;
    expect(pc.orders).toHaveLength(1);
    await api(`/port-calls/${callId}/cancel`, { body: { reason: 'Båten kom ikke' } });
    const o = (await api(`/orders/${a.json.id}`)).json;
    expect(o).toMatchObject({ status: 'venter', calls: [] });
    expect(o.log[0]).toMatchObject({ kind: 'unassigned', data: { reason: 'Båten kom ikke', from: { boat: 'Alfa' } } });
  });

  it('kaibok gjør SO-ene ferdige', async () => {
    const day = '2030-04-08';
    const a = await api('/orders', { body: order({ placement: newCall(day, '08:00', '09:00') }) });
    const callId = a.json.calls[0].id;
    const delivered = await api(`/port-calls/${callId}/quay-log`, {
      body: { had_deviation: false, categories: [], description: '', ratings: { punctuality: 4, cooperation: 4, equipment: 4 }, boat_note: null, photo_ids: [] },
    });
    expect(delivered.status).toBe(201);
    const o = (await api(`/orders/${a.json.id}`)).json;
    expect(o.status).toBe('ferdig');
    expect(o.log[0]).toMatchObject({ kind: 'completed', data: { boat: 'Alfa' } });
    // Levert vare kan ikke endres eller flyttes.
    const edit = await api(`/orders/${a.json.id}`, { method: 'PATCH', body: { version: o.version, lines: [line(50)] } });
    expect(edit.status).toBe(409);
    expect((await api(`/orders/${a.json.id}/assign`, { body: { version: o.version, placement: { kind: 'none' } } })).status).toBe(409);
  });

  it('finnes i søket på SO-nummer og kunde', async () => {
    const a = await api('/orders', { body: order({ customer: 'Unik Kunde Sjømat' }) });
    const bySo = await api(`/search?q=${a.json.so_number}`);
    expect(bySo.json.orders[0]).toMatchObject({ id: a.json.id, status: 'venter' });
    expect((await api('/search?q=Unik%20Kunde')).json.orders[0].so_number).toBe(a.json.so_number);
  });

  it('nytt anløp uten SO-er er lov, og kan få ordre senere', async () => {
    const created = await api('/port-calls', { body: call('2030-04-09', '08:00', '10:00') });
    const a = await api('/orders', { body: order({ placement: { kind: 'call', port_call_id: created.json.id } }) });
    expect(a.json.calls[0].id).toBe(created.json.id);
    expect(a.json.log.map((l: { kind: string }) => l.kind)).toEqual(['assigned', 'created']);
  });
});

describe('PO (innkjøpsordre) ved leveringer', () => {
  it('lager PO med prefiks-nummer, og sjekker formatet for SO og PO', async () => {
    const line = [{ sku_id: 's_hav_bb', quantity: 10, direction: 'inn' }];
    const po = await api('/orders', { body: { kind: 'PO', so_number: 'po-000123', customer: 'GCR Minerals', lines: line } });
    expect(po.status).toBe(201);
    expect(po.json).toMatchObject({ kind: 'PO', so_number: 'PO-000123' });
    expect((await api('/orders/PO-000123')).json).toMatchObject({ kind: 'PO', customer: 'GCR Minerals' });
    expect((await api('/orders', { body: { kind: 'PO', so_number: 'PO 12', customer: 'X', lines: line } })).status).toBe(400);
    expect((await api('/orders', { body: { kind: 'SO', so_number: 'PO-000124', customer: 'X', lines: line } })).status).toBe(400);
    expect((await api('/orders', { body: { kind: 'PO', so_number: 'PO-000123', customer: 'Y', lines: line } })).json.error).toMatch(/PO-000123 finnes allerede/);
    // Uten kind er det SO, som før.
    expect((await api('/orders', { body: { so_number: soNumber(), customer: 'Z', lines: [{ sku_id: 's_hav_bb', quantity: 1, direction: 'ut' }] } })).json.kind).toBe('SO');
  });
});

describe('anløp over flere dager', () => {
  it('kan bli ferdig en annen dag, vises alle dagene, og maks 14 døgn', async () => {
    const c = await api('/port-calls', { body: call('2030-07-01', '12:00', '13:00', { etd: at('2030-07-03', '15:00') }) });
    expect(c.status).toBe(201);
    for (const day of ['2030-07-01', '2030-07-02', '2030-07-03']) {
      expect((await api(`/port-calls?from=${day}&to=${day}`)).json.calls.map((x: { id: string }) => x.id)).toContain(c.json.id);
    }
    expect((await api('/port-calls?from=2030-07-04&to=2030-07-04')).json.calls.map((x: { id: string }) => x.id)).not.toContain(c.json.id);
    expect((await api('/port-calls', { body: call('2030-07-10', '12:00', '13:00', { etd: at('2030-07-30', '12:00') }) })).status).toBe(400);
    expect((await api(`/port-calls/${c.json.id}`, { method: 'PATCH', body: { version: c.json.version, etd: at('2030-07-20', '12:00') } })).status).toBe(400);
  });
});

describe('løs bulk med båt', () => {
  it('bulk-vare måles i tonn og vises som «… t … (bulk)»', async () => {
    const c = (await api('/port-calls', { body: call('2030-07-15', '08:00', '20:00') })).json;
    const o = await api('/orders', { body: { kind: 'PO', so_number: 'PO-BULK1', customer: 'Salt AS', lines: [{ sku_id: 's_hav_bulk', quantity: 1200, direction: 'inn' }],
      placement: { kind: 'call', port_call_id: c.id } } });
    expect(o.status).toBe(201);
    expect(o.json).toMatchObject({ tonnes: 1200, lines: [{ unit: 'bulk', label: '1200 t Hav salt (bulk)' }] });
    expect((await api('/products')).json.find((p: { id: string }) => p.id === 'p_hav').skus.map((s: { unit: string }) => s.unit)).toContain('bulk');
  });
});
