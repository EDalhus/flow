import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { looksLikeQuestion, parseActions, parseDay, parseScope } from '../../shared/domain/search.ts';
import { propose } from '../lib/actions.ts';
import { ANTHROPIC_URL, TOOLS, ask, runTool, translateTexts } from '../lib/ask.ts';
import { api, at, call } from './fixtures.ts';

const ADA = { id: 'u_admin', name: 'Ada', roles: ['admin'] };

// Søkefeltet: tolking av datoer, handlinger, prefiks og spørsmål, og «Spør Flow» (Claude med verktøy som leser).

describe('søk: tolking av teksten', () => {
  const today = '2030-04-03'; // onsdag
  it('forstår dager og uker', () => {
    expect(parseDay('i dag', today)).toEqual({ from: today, to: today });
    expect(parseDay('I morgen', today)).toEqual({ from: '2030-04-04', to: '2030-04-04' });
    expect(parseDay('fredag', today)).toEqual({ from: '2030-04-05', to: '2030-04-05' });
    expect(parseDay('mandag', today)).toEqual({ from: '2030-04-08', to: '2030-04-08' });
    expect(parseDay('onsdag', today)).toEqual({ from: today, to: today });
    expect(parseDay('neste uke', today)).toEqual({ from: '2030-04-08', to: '2030-04-14' });
    expect(parseDay('uke 1', today)).toEqual({ from: '2029-12-31', to: '2030-01-06' });
    expect(parseDay('23.10', today)).toEqual({ from: '2030-10-23', to: '2030-10-23' });
    expect(parseDay('coneste', today)).toBeNull();
    expect(parseDay('uke 60', today)).toBeNull();
  });
  it('forstår prefiks, handlinger og spørsmål', () => {
    expect(parseScope('båt: coneste')).toEqual({ scope: 'bat', q: 'coneste' });
    expect(parseScope('Sjåfør:per')).toEqual({ scope: 'sjafor', q: 'per' });
    expect(parseScope('kl: 10')).toEqual({ scope: null, q: 'kl: 10' });
    expect(parseActions('ny bulk SU 20 110')).toEqual([{ kind: 'bulk', text: 'SU 20 110' }]);
    expect(parseActions('ny so 2043644')).toEqual([{ kind: 'so', text: '2043644' }]);
    expect(parseActions('legg til båt Coneste')).toEqual([{ kind: 'bat', text: 'Coneste' }]);
    expect(parseActions('ny').map(a => a.kind)).toEqual(['bulk', 'bil', 'so', 'bat']);
    expect(parseActions('nordkyn')).toEqual([]);
    expect(looksLikeQuestion('Hvilken båt har vi oftest problemer med?')).toBe(true);
    expect(looksLikeQuestion('hva er det mest populære produktet')).toBe(true);
    expect(looksLikeQuestion('Flytt Nordkyn til kai 2 i morgen kl 14')).toBe(true);
    expect(looksLikeQuestion('coneste')).toBe(false);
  });
});

describe('søk: smart gjenkjenning og dato', () => {
  it('finner dagens agenda, prefiks og bil på reg.nr.', async () => {
    const r = await api('/search?q=i%20dag');
    expect(r.status).toBe(200);
    expect(r.json.agenda).toMatchObject({ from: expect.any(String), calls: expect.any(Array), trucks: expect.any(Array), bulk: expect.any(Array) });
    const b = (await api('/search?q=b%C3%A5t%3A%20alf')).json;
    expect(b.scope).toBe('bat');
    expect(b.boats[0]).toMatchObject({ name: 'Alfa' });
    expect(b.users).toEqual([]);
    const h = (await api('/bulk/registry')).json.haulers[0];
    await api('/bulk/registry/vehicles', { body: { reg_no: 'ZZ 99 123', hauler_id: h.id } });
    expect((await api('/search?q=zz99123')).json.vehicles[0]).toMatchObject({ reg_no: 'ZZ 99 123', today: 0, total: 0 });
  });
});

describe('Spør Flow', () => {
  it('svarer 503 når nøkkelen mangler', async () => {
    const r = await api('/ask', { body: { question: 'Hvilken båt har vi oftest problemer med?' } });
    expect(r.status).toBe(503);
    expect(r.json.error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('alle verktøyene kjører mot databasen og avviser ugyldige parametere', async () => {
    const p = { from: '2029-01-01', to: '2030-12-31' };
    for (const [name, input] of Object.entries({
      bat_kvalitet: p, salg: { ...p, group_by: 'kunde' }, bulk: p, anlop: p, status_na: {}, bat_info: { navn: 'Alfa' },
      salgsordre: { kunde: 'a' }, bilhentinger: p,
    })) {
      const r = await runTool(env, name, input) as Record<string, unknown>;
      expect(r.feil, name).toBeUndefined();
    }
    expect(await runTool(env, 'salg', { from: 'i fjor', to: '2030-01-01' })).toMatchObject({ feil: 'Ugyldige parametere' });
    expect(await runTool(env, 'salg', { from: '2030-01-01', to: '2029-01-01' })).toMatchObject({ feil: expect.stringMatching(/to må være/) });
    expect(await runTool(env, 'slett_alt', {})).toMatchObject({ feil: expect.stringMatching(/Ukjent/) });
    expect(Object.keys(TOOLS)).toHaveLength(8);
  });

  it('kjører verktøyene Claude ber om og returnerer svaret', async () => {
    const sent: { tools: { name: string }[]; messages: { role: string; content: unknown }[]; system: string }[] = [];
    const fetcher = async (url: string, init: RequestInit) => {
      expect(url).toBe(ANTHROPIC_URL);
      expect((init.headers as Record<string, string>)['x-api-key']).toBe('test-key');
      const body = JSON.parse(init.body as string);
      sent.push(body);
      if (sent.length === 1) {
        return Response.json({ stop_reason: 'tool_use', content: [
          { type: 'text', text: 'Ser på kaibøkene.' },
          { type: 'tool_use', id: 't1', name: 'bat_kvalitet', input: { from: '2029-01-01', to: '2030-12-31' } },
        ] });
      }
      return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: '[Alfa](/baater?id=b_a) har flest avvik.' }] });
    };
    const r = await ask({ ...env, ANTHROPIC_API_KEY: 'test-key' }, 'Hvilken båt har vi oftest problemer med?', 'en', ADA, [], fetcher);
    expect(r).toMatchObject({ answer: '[Alfa](/baater?id=b_a) har flest avvik.', tools: ['bat_kvalitet'], model: 'claude-sonnet-5-5' });
    expect(sent[0].tools.map(t => t.name)).toContain('salg');
    expect(sent[0].system).toMatch(/English/);
    const result = (sent[1].messages[2].content as { type: string; tool_use_id: string; content: string }[])[0];
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
    expect(JSON.parse(result.content)).toHaveProperty('bater');
  });

  it('gir forståelige feil fra Claude', async () => {
    const bad = async () => new Response('{}', { status: 401 });
    await expect(ask({ ...env, ANTHROPIC_API_KEY: 'x' }, 'hva solgte vi i fjor?', 'nb', ADA, [], bad)).rejects.toThrow(/ugyldig/);
  });
});

describe('Spør Flow: jobber', () => {
  it('foreslår en jobb via Claude, og bekreftelse kjører den vanlige ruten som brukeren', async () => {
    const c = (await api('/port-calls', { body: call('2030-06-03', '08:00', '12:00') })).json;
    let n = 0;
    const fetcher = async (_url: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string);
      expect(b.tools.map((t: { name: string }) => t.name)).toContain('foresla_handling');
      n++;
      if (n === 1) return Response.json({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'a1', name: 'foresla_handling', input: {
        handling: 'flytt_anlop', oppsummering: 'Flytt Alfa til Kai 2 kl. 10–14',
        parametere: { port_call_id: c.id, quay_id: 'q_kai2', eta: at('2030-06-03', '10:00'), etd: at('2030-06-03', '14:00') }, detaljer: ['Kai 2', '10:00–14:00'],
      } }] });
      return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Trykk Utfør for å flytte Alfa.' }] });
    };
    const jonas = { id: 'u_jonas', name: 'Jonas', roles: ['produksjon', 'kaiarbeider'] };
    const r = await ask({ ...env, ANTHROPIC_API_KEY: 'k' }, 'flytt alfa til kai 2 kl 10', 'nb', jonas, [{ role: 'user', content: 'hei' }, { role: 'assistant', content: 'Hei!' }], fetcher);
    expect(r.actions).toEqual([expect.objectContaining({ kind: 'flytt_anlop', status: 'foreslatt', summary: 'Flytt Alfa til Kai 2 kl. 10–14' })]);
    // Ingenting er endret før brukeren bekrefter.
    expect((await api(`/port-calls/${c.id}`)).json.quay.id).toBe('q_kai1');
    // En annen bruker kan ikke bekrefte.
    expect((await api(`/ask/actions/${r.actions[0].id}/confirm`, { body: {}, as: 'kari' })).status).toBe(404);
    const done = await api(`/ask/actions/${r.actions[0].id}/confirm`, { body: {} });
    expect(done.json).toMatchObject({ status: 'utfort', link: `/?id=${c.id}` });
    const after = (await api(`/port-calls/${c.id}`)).json;
    expect(after).toMatchObject({ quay: { id: 'q_kai2' }, eta: at('2030-06-03', '10:00') });
    expect((await api(`/ask/actions/${r.actions[0].id}/confirm`, { body: {} })).status).toBe(409); // ikke to ganger
  });

  it('avviser ugyldige forslag før brukeren ser dem, og viser feil fra ruten', async () => {
    expect(await propose(env.DB, 'u_jonas', { handling: 'slett_alt', oppsummering: 'x x x' })).toMatchObject({ ok: false });
    expect(await propose(env.DB, 'u_jonas', { handling: 'flytt_anlop', oppsummering: 'Flytt', parametere: { port_call_id: 'finnes_ikke' } }))
      .toMatchObject({ ok: false, feil: expect.stringMatching(/Fant ikke/) });
    expect(await propose(env.DB, 'u_jonas', { handling: 'ny_bilhenting', oppsummering: 'Ny henting', parametere: { customer: 'X', so_number: '123', expected_date: '2030-06-04', goods: [{ sku_id: 's_hav_bb', quantity: 2 }] } }))
      .toMatchObject({ ok: false, feil: expect.stringMatching(/so_number/) });
    const p = await propose(env.DB, 'u_jonas', { handling: 'ny_bat', oppsummering: 'Legg til Alfa', parametere: { name: 'Alfa' } });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const r = await api(`/ask/actions/${p.action.id}/confirm`, { body: {} });
    expect(r.json).toMatchObject({ status: 'feilet', error: expect.any(String) }); // navnet finnes fra før
    const q = await propose(env.DB, 'u_jonas', { handling: 'ny_bat', oppsummering: 'Legg til Zulu', parametere: { name: 'Zulu' } });
    if (!q.ok) throw new Error('forventet ok');
    expect((await api(`/ask/actions/${q.action.id}/cancel`, { body: {} })).json.status).toBe('avbrutt');
    expect((await api(`/ask/actions/${q.action.id}/confirm`, { body: {} })).status).toBe(409);
  });
});

describe('Claude: brief, kaibok og oversettelse', () => {
  it('uten nøkkel: ingen brief, og tekster vises uoversatt', async () => {
    expect((await api('/ask/brief')).json).toEqual({ brief: null });
    expect((await api('/ask/translate', { body: { texts: ['Labas'], lang: 'nb' } })).json).toEqual([{ text: null, source_lang: null }]);
    expect((await api('/ask/kaibok', { body: { port_call_id: 'x', text: 'alt gikk fint' }, as: 'kari' })).status).toBe(403);
  });

  it('oversetter flere tekster i ett kall', async () => {
    const fetcher = async (_u: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string);
      expect(b.model).toBe('claude-haiku-5-5');
      expect(b.tool_choice).toEqual({ type: 'tool', name: 'oversettelser' });
      return Response.json({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'oversettelser', input: { items: [
        { i: 0, source_lang: 'lt', same: false, text: 'Kranen er ødelagt' }, { i: 1, source_lang: 'nb', same: true },
      ] } }] });
    };
    expect(await translateTexts({ ...env, ANTHROPIC_API_KEY: 'k' }, ['Kranas sugedęs', 'Alt ok'], 'nb', fetcher))
      .toEqual([{ text: 'Kranen er ødelagt', source_lang: 'lt' }, { text: null, source_lang: 'nb' }]);
  });
});
