import { describe, expect, it } from 'vitest';
import { findCollisions, suggest, type CollisionCall } from '../../shared/domain/collisions.ts';
import { autoFlag } from '../../shared/domain/flags.ts';
import { forecastSeries } from '../../shared/domain/forecast.ts';
import { findMentions } from '../../shared/domain/mentions.ts';
import { resolveResponsible } from '../../shared/domain/responsible.ts';
import { deriveStatus } from '../../shared/domain/status.ts';
import { DEFAULT_SETTINGS, type Capacity } from '../../shared/domain/types.ts';
import { isoWeek, osloToUtc, serviceDate } from '../../shared/time.ts';
import { buildWeekly, type GoodsFact } from '../db/reports.ts';

const D = '2030-03-05';
const iso = (hm: string, date = D) => osloToUtc(date, hm);
const cap: Capacity = { truck: 4, anhuker: 3, kaikran: 1 };
const capFor = () => cap;

describe('tid', () => {
  it('regner om mellom Oslo-tid og UTC, også over sommertid', () => {
    expect(osloToUtc('2026-01-15', '07:30')).toBe('2026-01-15T06:30:00.000Z');
    expect(osloToUtc('2026-07-15', '07:30')).toBe('2026-07-15T05:30:00.000Z');
    expect(osloToUtc('2026-03-29', '03:30')).toBe('2026-03-29T01:30:00.000Z'); // første time med sommertid
    expect(serviceDate('2026-10-14T22:30:00.000Z')).toBe('2026-10-15');
  });

  it('bruker ISO-uker', () => {
    expect(isoWeek('2026-01-01')).toEqual({ year: 2026, week: 1 });
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 });
    expect(isoWeek('2026-10-14')).toEqual({ year: 2026, week: 42 });
  });
});

describe('status', () => {
  const base = { eta: iso('08:00'), etd: iso('11:00'), arrived_at: null, departed_at: null, completed_at: null, cancelled_at: null };
  const opts = { missingAfterMinutes: 60 };
  const at = (hm: string) => new Date(iso(hm));

  it('utleder status fra kaibok og AIS-tider', () => {
    expect(deriveStatus({ ...base, cancelled_at: iso('07:00') }, at('09:00'), opts).status).toBe('avlyst');
    expect(deriveStatus({ ...base, completed_at: iso('10:00') }, at('09:00'), opts)).toEqual({ status: 'ferdig', basis: 'kaibok' });
    expect(deriveStatus({ ...base, arrived_at: iso('08:10') }, at('09:00'), opts)).toEqual({ status: 'ved_kai', basis: 'ais' });
    expect(deriveStatus({ ...base, arrived_at: iso('08:10'), departed_at: iso('10:50') }, at('11:00'), opts))
      .toEqual({ status: 'kaibok_mangler', basis: 'ais' });
  });

  it('faller tilbake til klokka uten AIS', () => {
    expect(deriveStatus(base, at('07:00'), opts)).toEqual({ status: 'planlagt', basis: 'plan' });
    expect(deriveStatus(base, at('08:30'), opts)).toEqual({ status: 'ved_kai', basis: 'tid' });
    expect(deriveStatus(base, at('11:30'), opts)).toEqual({ status: 'ved_kai', basis: 'tid' });
    expect(deriveStatus(base, at('12:00'), opts)).toEqual({ status: 'kaibok_mangler', basis: 'tid' });
  });

  it('bruker fersk AIS for «på vei» og geofence', () => {
    const moving = { fetched_at: iso('06:55'), sog: 9, in_geofence: false };
    expect(deriveStatus({ ...base, ais: moving }, at('07:00'), opts)).toEqual({ status: 'paa_vei', basis: 'ais' });
    expect(deriveStatus({ ...base, ais: { ...moving, in_geofence: true } }, at('07:00'), opts).status).toBe('ved_kai');
    // Gammel posisjon (over 15 min) ignoreres.
    expect(deriveStatus({ ...base, ais: { ...moving, fetched_at: iso('06:00') } }, at('07:00'), opts).status).toBe('planlagt');
  });
});

describe('kollisjoner', () => {
  const c = (id: string, quay: string, from: string, to: string, crew: CollisionCall['crew'] = []): CollisionCall =>
    ({ id, boat_name: id.toUpperCase(), quay_id: quay, eta: iso(from), etd: iso(to), crew });

  it('finner samme kai med overlappende tid, men ikke anløp som bare møtes', () => {
    const found = findCollisions([c('a', 'k1', '09:15', '12:30'), c('b', 'k1', '11:45', '14:30'), c('x', 'k1', '14:30', '16:00')], capFor);
    expect(found).toEqual([{ kind: 'quay', quay_id: 'k1', calls: ['a', 'b'], from: iso('11:45'), to: iso('12:30') }]);
  });

  it('finner samme person på to overlappende anløp', () => {
    const found = findCollisions([
      c('a', 'k1', '08:00', '10:00', [{ crew_role: 'truck', user_id: 'per' }]),
      c('b', 'k2', '09:00', '11:00', [{ crew_role: 'truck', user_id: 'per' }, { crew_role: 'anhuker', user_id: null }]),
    ], capFor);
    expect(found).toEqual([{ kind: 'person', user_id: 'per', calls: ['a', 'b'], from: iso('09:00'), to: iso('10:00') }]);
  });

  it('summerer rollebehov mot kapasitet på vakt', () => {
    const trucks = (n: number) => Array.from({ length: n }, () => ({ crew_role: 'truck' as const, user_id: null }));
    const calls = [c('a', 'k1', '08:00', '12:00', trucks(2)), c('b', 'k2', '09:00', '11:00', trucks(2)), c('x', 'k3', '10:00', '13:00', trucks(1))];
    const found = findCollisions(calls, capFor);
    expect(found).toEqual([{ kind: 'capacity', role: 'truck', needed: 5, capacity: 4, calls: ['a', 'b', 'x'], from: iso('10:00'), to: iso('11:00') }]);
    expect(findCollisions(calls, () => ({ ...cap, truck: 5 }))).toEqual([]);
    // Ett anløp alene kan også trenge flere enn det er på vakt.
    expect(findCollisions([c('a', 'k1', '08:00', '09:00', trucks(5))], capFor)[0]).toMatchObject({ kind: 'capacity', needed: 5, calls: ['a'] });
  });

  it('foreslår ledig kai og utsettelse til forrige anløp er ferdig', () => {
    const calls = [c('a', 'k1', '09:15', '12:30'), c('b', 'k1', '11:45', '14:30')];
    const [col] = findCollisions(calls, capFor);
    expect(suggest(col, calls, { quayIds: ['k1', 'k2'], capacityFor: capFor, bufferMinutes: 15 })).toEqual([
      { kind: 'move_quay', call_id: 'b', quay_id: 'k2' },
      { kind: 'postpone', call_id: 'b', eta: iso('12:45'), etd: iso('15:30') },
    ]);
  });

  it('hopper over opptatte tidsrom og kaier når den foreslår', () => {
    const calls = [
      c('a', 'k1', '09:00', '11:00'), c('b', 'k1', '10:00', '12:00'),
      c('blokk1', 'k2', '08:00', '13:00'), c('blokk2', 'k1', '11:00', '12:30'),
    ];
    const col = findCollisions(calls, capFor).find(x => x.kind === 'quay' && x.calls.join() === 'a,b')!;
    // Kai 2 er opptatt; etter a (11:15) er blokk2 i veien; første ledige start er 12:45.
    expect(suggest(col, calls, { quayIds: ['k1', 'k2'], capacityFor: capFor, bufferMinutes: 15, target: 'b' })).toEqual([
      { kind: 'postpone', call_id: 'b', eta: iso('12:45'), etd: iso('14:45') },
    ]);
  });
});

describe('ansvarlig', () => {
  it('setter eneste person automatisk', () => {
    expect(resolveResponsible([{ user_id: 'ola' }], undefined, null)).toEqual({ ok: true, responsible: 'ola' });
    expect(resolveResponsible([{ user_id: 'ola' }], 'per', null)).toEqual({ ok: true, responsible: 'ola' });
    expect(resolveResponsible([{ user_id: null }], undefined, null)).toEqual({ ok: true, responsible: null });
  });

  it('krever manuelt valg blant personene ved flere roller', () => {
    const slots = [{ user_id: 'ola' }, { user_id: 'per' }, { user_id: null }];
    expect(resolveResponsible(slots, undefined, null)).toEqual({ ok: true, responsible: null });
    expect(resolveResponsible(slots, 'per', null)).toEqual({ ok: true, responsible: 'per' });
    expect(resolveResponsible(slots, 'kari', null).ok).toBe(false);
    expect(resolveResponsible(slots, undefined, 'per')).toEqual({ ok: true, responsible: 'per' });
    // Ansvarlig som tas av anløpet nullstilles.
    expect(resolveResponsible([{ user_id: 'ola' }, { user_id: null }], undefined, 'per')).toEqual({ ok: true, responsible: null });
  });
});

describe('@-tagging', () => {
  const users = [{ id: 'u1', short_name: 'Ola N.' }, { id: 'u2', short_name: 'Jonas B.' }, { id: 'u3', short_name: 'Ola Nordmann' }];
  it('finner taggede brukere', () => {
    expect(findMentions('@Jonas B. rekker dere? @ola n. tar trucken', users).sort()).toEqual(['u1', 'u2']);
    expect(findMentions('Spør @Ola Nordmann!', users)).toEqual(['u3']);
    expect(findMentions('e-post ola@firma.no og @Ukjent P.', users)).toEqual([]);
  });
});

describe('flagg', () => {
  const rules = DEFAULT_SETTINGS.flag_rules;
  const boat = (p: number, s: number, u: number, recent: { had_deviation: boolean; categories: never[] | ('forsinkelse' | 'skade_gods' | 'utstyr_kran')[] }[] = []) =>
    ({ count: 9, avg_punctuality: p, avg_cooperation: s, avg_equipment: u, avg_total: (p + s + u) / 3, recent });

  it('gir samme flagg som designet', () => {
    expect(autoFlag(boat(4.8, 4.7, 4.3, [{ had_deviation: false, categories: [] }, { had_deviation: false, categories: [] }]), rules))
      .toEqual({ flag: 'green', reason: 'Ingen avvik siste 2 anløp.' });
    expect(autoFlag(boat(2.4, 1.8, 2.2), rules).flag).toBe('red'); // Polarstrand
    expect(autoFlag(boat(2.6, 4.2, 4.0), rules)).toEqual({ flag: 'yellow', reason: 'Lav punktlighet (2,6).' }); // Nordkyn
    expect(autoFlag(boat(3.0, 3.8, 2.8), rules).flag).toBe('yellow'); // Kystlast
    expect(autoFlag(boat(4.2, 4.3, 3.6), rules).flag).toBe('green'); // Fjordvik
    expect(autoFlag({ ...boat(4, 4, 4), count: 0, avg_total: null }, rules).flag).toBe('none');
  });

  it('gir rødt ved alvorlig avvik og gult ved avvik sist', () => {
    expect(autoFlag(boat(4.5, 4.5, 4.5, [{ had_deviation: false, categories: [] }, { had_deviation: true, categories: ['skade_gods'] }]), rules))
      .toEqual({ flag: 'red', reason: 'Skade på gods ved et av de siste anløpene.' });
    expect(autoFlag(boat(4.5, 4.5, 4.5, [{ had_deviation: true, categories: ['forsinkelse'] }]), rules))
      .toEqual({ flag: 'yellow', reason: 'Avvik ved forrige anløp (forsinkelse).' });
  });
});

describe('prognose', () => {
  it('ganger fjorårets uke med årets trend siste 8 uker', () => {
    const prev = Array.from({ length: 52 }, () => 100);
    const cur = Array.from({ length: 52 }, (_, i) => (i < 10 ? 110 : 0));
    const f = forecastSeries(prev, cur, 10);
    expect(f.trend).toBeCloseTo(1.1);
    expect(f.values[9]).toBe(110); // faktisk
    expect(f.values[10]).toBeCloseTo(110); // prognose
  });

  it('bygger ukerapport med filter på produkt og retning', () => {
    const fact = (date: string, product_id: string, direction: 'inn' | 'ut', t: number, id = date + product_id + direction): GoodsFact =>
      ({ call_id: id, service_date: date, product_id, direction, kg: t * 1000 });
    const facts = [
      fact('2025-03-04', 'hav', 'inn', 100), fact('2025-03-04', 'stein', 'ut', 50),
      fact('2026-03-03', 'hav', 'inn', 120), fact('2026-03-03', 'stein', 'ut', 60),
    ];
    const all = buildWeekly(facts, 2026, '2026-10-14', { direction: 'begge' });
    expect(all.last_actual_week).toBe(41);
    expect(all.weeks[9]).toMatchObject({ week: 10, kind: 'faktisk', tonnes_prev: 150, tonnes: 180, calls_prev: 2, calls: 2 });
    expect(all.weeks[45]).toMatchObject({ kind: 'prognose', tonnes: null });
    expect(all.totals).toMatchObject({ ytd_tonnes: 180, ytd_tonnes_prev: 150, ytd_calls: 2, ytd_calls_prev: 2 });

    const inn = buildWeekly(facts, 2026, '2026-10-14', { direction: 'inn' });
    expect(inn.totals.ytd_tonnes).toBe(120);
    const stein = buildWeekly(facts, 2026, '2026-10-14', { direction: 'begge', product_id: 'stein' });
    expect(stein.totals).toMatchObject({ ytd_tonnes: 60, ytd_calls: 1 });
  });

  it('bruker fjorårets uke 52 når året har 53 uker og fjoråret 52', () => {
    const facts: GoodsFact[] = [{ call_id: 'x', service_date: '2025-12-23', product_id: 'hav', direction: 'inn', kg: 80_000 }];
    const r = buildWeekly(facts, 2026, '2026-10-14', { direction: 'begge' });
    expect(r.weeks_in_year).toBe(53);
    expect(r.weeks[51]).toMatchObject({ week: 52, tonnes_prev: 80 });
    expect(r.weeks[52]).toMatchObject({ week: 53, tonnes_prev: 80, forecast_tonnes: 80 });
  });
});
