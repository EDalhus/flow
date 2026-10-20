import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { looksLikeQuestion, parseActions, parseDay, parseScope } from '../../shared/domain/search.ts';
import { propose } from '../lib/actions.ts';
import { ANTHROPIC_URL, TOOLS, ask, periodReport, runTool, translateTexts } from '../lib/ask.ts';
import { api, at, call, soNumber } from './fixtures.ts';

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
    const long = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `tur ${i}` }));
    expect((await api('/ask', { body: { question: 'Og så?', history: long } })).status).toBe(503); // ikke 400 for lang samtale
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
    expect(Object.keys(TOOLS)).toHaveLength(11);
    expect(await runTool(env, 'ais_sok', { sok: ['Alfa'] })).toMatchObject({ ais_feil: expect.stringMatching(/ikke satt opp/), resultater: [{ i_batregisteret: { navn: 'Alfa' } }] });
    expect(await runTool(env, 'hjelp', {})).toMatchObject({ handbok: expect.stringContaining('Ny sjåfør') });
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
    expect(await propose(env.DB, 'u_jonas', { handling: 'ny_bat', oppsummering: 'Legg til Alfa', parametere: { name: 'Alfa' } }))
      .toMatchObject({ ok: false, feil: expect.stringMatching(/finnes allerede/i) });
    // Feil fra selve ruten (SO-nummeret tas mellom forslag og utførelse) vises på kortet.
    const so = soNumber();
    const p = await propose(env.DB, 'u_jonas', { handling: 'ny_salgsordre', oppsummering: `Ny SO ${so}`, parametere: { so_number: so, customer: 'X', lines: [{ sku_id: 's_hav_bb', quantity: 2 }] } });
    if (!p.ok) throw new Error(p.feil);
    await api('/orders', { body: { so_number: so, customer: 'Y', lines: [{ sku_id: 's_hav_bb', quantity: 1, direction: 'ut' }] } });
    expect((await api(`/ask/actions/${p.action.id}/confirm`, { body: {} })).json).toMatchObject({ status: 'feilet', error: expect.any(String) });
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

describe('Claude: før båten kommer, rapport og hjelp', () => {
  it('uten nøkkel: ingen sammendrag, rapport og sjåførhjelp gir 503', async () => {
    expect((await api('/ask/boat/b_a')).json).toEqual({ text: null });
    expect((await api('/ask/report', { body: { from: '2030-01-01', to: '2030-01-31' } })).status).toBe(503);
    expect((await api('/ask/report', { body: { from: '2030-02-01', to: '2030-01-31' } })).status).toBe(400);
  });

  it('rapporten henter tall for perioden og perioden før', async () => {
    const asked: string[] = [];
    let n = 0;
    const fetcher = async (_u: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string);
      if (n++ === 0) {
        expect(b.system).toMatch(/2029-12-01 til 2029-12-31/); // perioden før januar (31 dager)
        return Response.json({ stop_reason: 'tool_use', content: [
          { type: 'tool_use', id: 's1', name: 'salg', input: { from: '2030-01-01', to: '2030-01-31' } },
          { type: 'tool_use', id: 's2', name: 'salg', input: { from: '2029-12-01', to: '2029-12-31' } },
        ] });
      }
      asked.push(...b.messages[2].content.map((r: { content: string }) => r.content));
      return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: '### Hovedtall\n- **Tonn ut:** 0 t' }] });
    };
    expect(await periodReport({ ...env, ANTHROPIC_API_KEY: 'k' }, '2030-01-01', '2030-01-31', 'nb', fetcher)).toMatch(/Hovedtall/);
    expect(asked).toHaveLength(2);
    expect(JSON.parse(asked[0])).toHaveProperty('sum_tonn');
  });
});

describe('Spør Flow: ferdigstill og kaibok i chatten', () => {
  it('henter fakta om anløpet, og leverer kaiboka med rapporten når brukeren bekrefter', async () => {
    const c = (await api('/port-calls', { body: call('2030-06-10', '08:00', '12:00') })).json;
    await api(`/port-calls/${c.id}/messages`, { body: { body: 'Kranen på båten hakker' } });
    const g = await runTool(env, 'kaibok_grunnlag', { port_call_id: c.id }) as { anlop: { bat: string; kaibok_levert: boolean }; siste_chat: { tekst: string }[] };
    expect(g.anlop).toMatchObject({ bat: 'Alfa', kaibok_levert: false });
    expect(g.siste_chat.map(m => m.tekst)).toContain('Kranen på båten hakker');

    const report = 'Hendelse: Båtkrana stoppet under lossing kl. 09:40.\nOmfang: 3 paller havsalt skadet (ca. 3 t).\nTiltak: Lossing fortsatte med truck fra kaia.\nOppfølging: Rederiet varslet.';
    const p = await propose(env.DB, 'u_jonas', { handling: 'lever_kaibok', oppsummering: 'Ferdigstill Alfa med avvik (utstyr/kran)', parametere: {
      port_call_id: c.id, had_deviation: true, categories: ['utstyr_kran', 'skade_gods'], description: report, r_punctuality: 4, r_cooperation: 3, r_equipment: 2, boat_note: 'Sjekk krana før lossing.',
    } });
    if (!p.ok) throw new Error(p.feil);
    expect((await api(`/ask/actions/${p.action.id}/confirm`, { body: {} })).json).toMatchObject({ status: 'utfort', link: '/kaibok' });
    const after = (await api(`/port-calls/${c.id}`)).json;
    expect(after).toMatchObject({ status: 'ferdig', has_quay_log: true });
    // Kan ikke leveres to ganger.
    expect(await propose(env.DB, 'u_jonas', { handling: 'lever_kaibok', oppsummering: 'Igjen', parametere: { port_call_id: c.id, had_deviation: false, r_punctuality: 5, r_cooperation: 5, r_equipment: 5 } }))
      .toMatchObject({ ok: false, feil: expect.stringMatching(/allerede levert/) });
  });
});

describe('Spør Flow: nettsøk og mange båter', () => {
  it('sender nettsøk, fortsetter etter pause, samler kilder og lager én samlejobb', async () => {
    let n = 0;
    const fetcher = async (_u: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string);
      n++;
      if (n === 1) {
        expect(b.tools[0]).toMatchObject({ type: 'web_search_20250305', name: 'web_search' });
        return Response.json({ stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 'w1', name: 'web_search', input: { query: 'Wagenborg fleet' } }] });
      }
      if (n === 2) {
        expect(b.messages.at(-1).role).toBe('assistant'); // fortsetter etter pause
        return Response.json({ stop_reason: 'tool_use', content: [
          { type: 'web_search_tool_result', tool_use_id: 'w1', content: [] },
          { type: 'tool_use', id: 't1', name: 'foresla_handling', input: { handling: 'nye_bater', oppsummering: 'Legg til 3 Wagenborg-båter', parametere: { bater: [
            { name: 'Egbert Wagenborg', imo: '9364568' }, { name: 'Alfa' }, { name: 'Egbert Wagenborg', imo: '9364568' }, { name: 'Kroonborg', imo: 'IMO 9396579' },
          ] } } },
        ] });
      }
      return Response.json({ stop_reason: 'end_turn', content: [
        { type: 'text', text: 'Jeg fant ' }, { type: 'text', text: 'to nye båter.', citations: [{ type: 'web_search_result_location', url: 'https://www.wagenborg.com/fleet', title: 'Fleet' }] },
      ] });
    };
    const r = await ask({ ...env, ANTHROPIC_API_KEY: 'k' }, 'legg til alle båtene til wagenborg', 'nb', { id: 'u_kari', name: 'Kari', roles: ['salg'] }, [], fetcher);
    expect(r.answer).toBe('Jeg fant to nye båter.');
    expect(r.sources).toEqual([{ url: 'https://www.wagenborg.com/fleet', title: 'Fleet' }]);
    expect(r.tools).toContain('web_search');
    expect(r.actions).toHaveLength(1);
    const done = await api(`/ask/actions/${r.actions[0].id}/confirm`, { body: {}, as: 'kari' });
    expect(done.json).toMatchObject({ status: 'utfort', link: '/baater', error: null });
    const boats = (await api('/boats')).json as { name: string; imo: string | null }[];
    expect(boats.filter(b => /Wagenborg|Kroonborg/.test(b.name)).map(b => [b.name, b.imo]).sort()).toEqual([['Egbert Wagenborg', '9364568'], ['Kroonborg', '9396579']]);
    // Alle finnes nå: forslaget avvises før brukeren ser det.
    expect(await propose(env.DB, 'u_kari', { handling: 'nye_bater', oppsummering: 'Igjen', parametere: { bater: [{ name: 'Kroonborg' }] } }))
      .toMatchObject({ ok: false, feil: expect.stringMatching(/finnes allerede/i) });
  });

  it('prøver uten nettsøk når det ikke er slått på hos Anthropic', async () => {
    let n = 0;
    const fetcher = async (_u: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string);
      if (n++ === 0) return new Response('{"error":{"message":"web_search is not enabled for this organization"}}', { status: 400 });
      expect(b.tools.some((t: { name: string }) => t.name === 'web_search')).toBe(false);
      return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Uten nettsøk.' }] });
    };
    expect((await ask({ ...env, ANTHROPIC_API_KEY: 'k' }, 'hei der borte', 'nb', ADA, [], fetcher)).answer).toBe('Uten nettsøk.');
  });
});
