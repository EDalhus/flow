import { describe, expect, it } from 'vitest';
import { bulkDemand, bulkPhase, formatMinSec, parseMinSec } from '../../shared/domain/bulk.ts';
import { siloState } from '../../shared/domain/production.ts';
import { api } from './fixtures.ts';

const T0 = Date.parse('2030-04-01T08:00:00Z');
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const step = (seq: number, extra: Partial<Parameters<typeof bulkPhase>[1][number]> = {}) =>
  ({ seq, quality_id: 'havsalt', tonnes: 10, pause_after_sec: 0, started_at: null, finished_at: null, ...extra });

describe('bulk: steg og pause', () => {
  it('går fra venter til laster, pause og ferdig', () => {
    expect(bulkPhase('bestilt', [step(1), step(2)], T0)).toEqual({ kind: 'venter' });
    expect(bulkPhase('lastes', [step(1, { started_at: iso(0) }), step(2)], T0 + 60_000)).toEqual({ kind: 'laster', step: 1 });
    // Steg 1 ferdig etter 5 min, pause 2:30 → steg 2 starter 7:30.
    const s = [step(1, { started_at: iso(0), finished_at: iso(5), pause_after_sec: 150 }), step(2, { started_at: iso(7.5) })];
    expect(bulkPhase('lastes', s, T0 + 6 * 60_000)).toEqual({ kind: 'pause', next: 2, untilMs: T0 + 7.5 * 60_000 });
    expect(bulkPhase('lastes', s, T0 + 8 * 60_000)).toEqual({ kind: 'laster', step: 2 });
    expect(bulkPhase('ferdig', s, T0)).toEqual({ kind: 'ferdig' });
  });

  it('summerer det traktene trenger, og leser mm:ss', () => {
    const demand = bulkDemand([
      { status: 'bestilt', steps: [step(1, { quality_id: 'blandet', tonnes: 16 }), step(2, { tonnes: 12 })] },
      { status: 'lastes', steps: [step(1, { tonnes: 8, finished_at: iso(1) }), step(2, { quality_id: 'blandet', tonnes: 4 })] },
      { status: 'ferdig', steps: [step(1, { tonnes: 99 })] },
    ]);
    expect(demand).toEqual({ blandet: 20, havsalt: 12 });
    expect(parseMinSec('2:30')).toBe(150);
    expect(parseMinSec('45')).toBe(45);
    expect(parseMinSec('2:75')).toBeNull();
    expect(formatMinSec(150)).toBe('2:30');
  });
});

describe('produksjon: beregnet silo', () => {
  const base = { capacity: 30, rateTph: 10 };
  it('anbefaler påfylling, men aldri mer enn ordren trenger', () => {
    // 60 t ordre, startet for 1 t siden, 30 t fylt → 10 t pakket, 20 t i silo, fyll 10 t.
    const s = siloState({ ...base, order: { tonnes: 60, started_at: iso(0) }, filledForOrder: 30 }, T0 + 3_600_000);
    expect(s).toMatchObject({ packed: 10, level: 20, remaining: 50, fillNow: 10, enoughForOrder: false, advice: 'ok', minutesToEmpty: 120 });
    // Nok fylt til hele ordren → stopp, selv om siloen ikke er full.
    const stop = siloState({ ...base, order: { tonnes: 40, started_at: iso(0) }, filledForOrder: 40 }, T0 + 3_600_000);
    expect(stop).toMatchObject({ level: 30, enoughForOrder: true, fillNow: 0, advice: 'stopp' });
    // Nesten tom → fyll.
    expect(siloState({ ...base, order: { tonnes: 60, started_at: iso(0) }, filledForOrder: 12 }, T0 + 3_600_000).advice).toBe('fyll');
    expect(siloState({ ...base, order: null, filledForOrder: 0 }, T0).advice).toBe('ingen');
  });
});

describe('API: biler, bulk og produksjon', () => {
  it('biler: opprett, marker hentet og angre', async () => {
    const truck = { customer: 'Fiskebruket AS', carrier: 'Tafjord Transport', expected_date: '2030-04-02', goods: [{ sku_id: 's_hav_eur', quantity: 24 }] };
    expect((await api('/trucks', { as: 'kari', body: truck })).status).toBe(400);
    expect((await api('/trucks', { as: 'kari', body: { ...truck, so_number: '40245' } })).status).toBe(400);
    const res = await api('/trucks', { as: 'kari', body: { ...truck, so_number: '2040245' } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ customer: 'Fiskebruket AS', so_number: '2040245', tonnes: 24, picked_up_at: null });
    // SO-nummeret brukes bare én gang, på bil eller båt.
    expect((await api('/trucks', { as: 'kari', body: { ...truck, so_number: '2040245' } })).status).toBe(409);
    const boat = await api('/orders', { body: { so_number: '2040245', customer: 'Y', lines: [{ sku_id: 's_hav_bb', quantity: 1, direction: 'ut' }] } });
    expect(boat).toMatchObject({ status: 409, json: { error: 'SO 2040245 finnes allerede (Fiskebruket AS).' } });
    expect((await api('/search?q=2040245')).json.trucks[0].so_number).toBe('2040245');
    const picked = await api(`/trucks/${res.json.id}/pickup`, { as: 'ola', body: {} });
    expect(picked.json.picked_up_by.id).toBe('u_ola');
    expect((await api(`/trucks/${res.json.id}/pickup`, { as: 'ola', body: { undo: true } })).json.picked_up_at).toBeNull();
    expect((await api('/trucks', { as: 'kari', body: { customer: 'X', expected_date: '2030-04-02', goods: [] } })).status).toBe(400);
  });

  it('bulk: bestill i steg, start, pause og ferdig', async () => {
    const order = await api('/bulk/orders', {
      as: 'ola',
      body: { truck: 'Bil 2', destination: 'Fiskebruket', steps: [
        { quality_id: 'blandet', tonnes: 16, target: 'henger', pause_after_sec: 150 },
        { quality_id: 'havsalt', tonnes: 12, target: 'bil', pause_after_sec: 999 },
      ] },
    });
    expect(order.status).toBe(201);
    expect(order.json.steps.map((s: { quality_name: string; pause_after_sec: number }) => [s.quality_name, s.pause_after_sec]))
      .toEqual([['Blandet salt', 150], ['Havsalt', 0]]); // siste steg har aldri pause
    const id = order.json.id;
    expect((await api(`/bulk/orders/${id}/start`, { as: 'ola', body: {} })).json.status).toBe('lastes');
    const afterStep1 = await api(`/bulk/orders/${id}/next`, { as: 'ola', body: {} });
    const s2start = Date.parse(afterStep1.json.steps[1].started_at);
    expect(s2start - Date.parse(afterStep1.json.steps[0].finished_at)).toBe(150_000);
    // Under pausen: «neste» starter steg 2 med en gang; så ferdig.
    await api(`/bulk/orders/${id}/next`, { as: 'ola', body: {} });
    const done = await api(`/bulk/orders/${id}/next`, { as: 'ola', body: {} });
    expect(done.json.status).toBe('ferdig');
    expect((await api('/bulk/orders', { as: 'ola', body: { truck: 'Bil 2', steps: [{ quality_id: 'gull', tonnes: 5 }] } })).status).toBe(400);
  });

  it('produksjon: ordre, start, påfylling og ferdig', async () => {
    const o = await api('/production/orders', { body: { line_id: 'linje1', product_id: 'p_hav', tonnes: 40 } });
    expect(o.status).toBe(201);
    expect((await api('/production/fills', { body: { line_id: 'linje1', tonnes: 10 } })).status).toBe(409); // ingen ordre pakker
    await api(`/production/orders/${o.json.id}/start`, { body: {} });
    const filled = await api('/production/fills', { as: 'ola', body: { line_id: 'linje1', tonnes: 25 } });
    const line = filled.json.find((l: { id: string }) => l.id === 'linje1');
    expect(line).toMatchObject({ filled_for_order: 25, active_order: { id: o.json.id, status: 'pakker' }, last_fill: { tonnes: 25 } });
    expect((await api('/production/orders', { as: 'kari', body: { line_id: 'linje1', product_id: 'p_hav', tonnes: 5 } })).status).toBe(403);
    const fin = await api(`/production/orders/${o.json.id}/finish`, { body: {} });
    expect(fin.json.find((l: { id: string }) => l.id === 'linje1').active_order).toBeNull();
  });
});
