import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { looksLikeQuestion, parseActions, parseDay, parseScope } from '../../shared/domain/search.ts';
import { ANTHROPIC_URL, TOOLS, ask, runTool } from '../lib/ask.ts';
import { api } from './fixtures.ts';

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
    const r = await ask({ ...env, ANTHROPIC_API_KEY: 'test-key' }, 'Hvilken båt har vi oftest problemer med?', 'en', 'Ada', fetcher);
    expect(r).toMatchObject({ answer: '[Alfa](/baater?id=b_a) har flest avvik.', tools: ['bat_kvalitet'], model: 'claude-sonnet-5-5' });
    expect(sent[0].tools.map(t => t.name)).toContain('salg');
    expect(sent[0].system).toMatch(/English/);
    const result = (sent[1].messages[2].content as { type: string; tool_use_id: string; content: string }[])[0];
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
    expect(JSON.parse(result.content)).toHaveProperty('bater');
  });

  it('gir forståelige feil fra Claude', async () => {
    const bad = async () => new Response('{}', { status: 401 });
    await expect(ask({ ...env, ANTHROPIC_API_KEY: 'x' }, 'hva solgte vi i fjor?', 'nb', 'Ada', bad)).rejects.toThrow(/ugyldig/);
  });
});
