import { Hono } from 'hono';
import { z } from 'zod';
import type { AiReport, AskAction, AskAnswer, KaibokDraft, MorningBrief, Translation } from '../../shared/api.ts';
import { todayOslo } from '../../shared/time.ts';
import { CAN, requireRole } from '../auth/access.ts';
import { expired, linkFor } from '../lib/actions.ts';
import { AskError, ask, boatBrief, kaibokDraft, morningBrief, periodReport, translateTexts } from '../lib/ask.ts';
import { body, fail, nowIso } from '../lib/http.ts';
import { INTERNAL_HEADER, internalToken } from '../lib/internal.ts';
import { sha256 } from '../lib/pin.ts';
import type { AppEnv } from '../types.ts';

// Claude i Flow: «Spør Flow» (spørsmål og jobber), morgenbrief, kaibok med egne ord og oversettelse av fritekst.
// Alle spørsmål logges (ai_questions), og hver bruker kan stille et begrenset antall per time.
const app = new Hono<AppEnv>();

const PER_HOUR = 40;
const lang = z.enum(['nb', 'en', 'lt', 'da', 'sv', 'is']);

/** Gjør om AskError til HTTP-feil. */
async function guard<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (e) { if (e instanceof AskError) throw fail(e.status, e.message); throw e; }
}

app.post('/', body(z.object({
  question: z.string().trim().min(2).max(1000), lang: lang.optional(),
  // Lange samtaler (f.eks. kaibok-intervju) kuttes til de siste 40 meldingene i stedet for å avvises.
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) })).max(200).default([]).transform(h => h.slice(-40)),
})), async c => {
  const { question, lang: l, history } = c.req.valid('json');
  const user = c.get('user');
  const db = c.env.DB;
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const used = await db.prepare('SELECT count(*) AS n FROM ai_questions WHERE user_id = ? AND created_at >= ?').bind(user.id, hourAgo).first<{ n: number }>();
  if ((used?.n ?? 0) >= PER_HOUR) throw fail(429, 'Du har stilt mange spørsmål den siste timen. Prøv igjen litt senere.');
  const t0 = Date.now();
  try {
    const r = await ask(c.env, question, l ?? user.prefs.lang ?? 'nb', { id: user.id, name: user.name, roles: user.roles }, history);
    await db.prepare('INSERT INTO ai_questions (user_id, question, answer, tools, model, ms) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(user.id, question, r.answer, JSON.stringify(r.tools), r.model, Date.now() - t0).run();
    return c.json({ question, answer: r.answer, tools: r.tools, actions: r.actions, sources: r.sources } satisfies AskAnswer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ukjent feil';
    await db.prepare('INSERT INTO ai_questions (user_id, question, ms, error) VALUES (?, ?, ?, ?)').bind(user.id, question, Date.now() - t0, msg).run();
    if (e instanceof AskError) throw fail(e.status, e.message);
    throw e;
  }
});

// ---------------------------------------------------------------- jobber

type ActionRow = { id: number; user_id: string; kind: string; summary: string; details: string; method: string; path: string; body: string; status: AskAction['status']; result: string | null; error: string | null; created_at: string };
const view = (r: ActionRow, link: string | null = null): AskAction => ({
  id: r.id, kind: r.kind, summary: r.summary, details: JSON.parse(r.details), status: r.status, link, error: r.error,
});
async function own(c: { env: Env; get: (k: 'user') => { id: string } }, id: string) {
  const r = await c.env.DB.prepare('SELECT * FROM ai_actions WHERE id = ?').bind(Number(id)).first<ActionRow>();
  if (!r || r.user_id !== c.get('user').id) throw fail(404, 'Fant ikke forslaget.');
  return r;
}

/** Brukeren bekrefter: jobben kjøres gjennom den vanlige API-ruten som brukeren selv. */
app.post('/actions/:id/confirm', async c => {
  const r = await own(c, c.req.param('id'));
  if (r.status !== 'foreslatt') throw fail(409, r.status === 'utfort' ? 'Jobben er allerede gjort.' : 'Forslaget er ikke aktivt lenger.');
  if (expired(r.created_at)) throw fail(409, 'Forslaget er for gammelt. Spør på nytt, så lager Flow et nytt.');
  // Marker først, så samme forslag ikke kan kjøres to ganger samtidig.
  const claimed = await c.env.DB.prepare("UPDATE ai_actions SET status = 'utfort', done_at = ? WHERE id = ? AND status = 'foreslatt'").bind(nowIso(), r.id).run();
  if (!claimed.meta.changes) throw fail(409, 'Jobben er allerede gjort.');
  const { app: api } = await import('../app.ts');
  const run = (body: string) => api.request(`/api${r.path}`, {
    method: r.method, body, headers: { 'content-type': 'application/json', [INTERNAL_HEADER]: internalToken(c.get('user')) },
  }, c.env, c.executionCtx);
  const parsed = JSON.parse(r.body);
  if (Array.isArray(parsed)) {
    // Samlejobb (f.eks. mange båter): én forespørsel per element; feil på ett stopper ikke resten.
    const errors: string[] = [];
    let ok = 0;
    for (const item of parsed) {
      const res = await run(JSON.stringify(item));
      if (res.ok) ok++;
      else {
        const e = await res.json().catch(() => ({})) as { error?: string };
        errors.push(`${(item as { name?: string }).name ?? '?'}: ${e.error ?? `Feil ${res.status}`}`);
      }
    }
    const status = ok ? 'utfort' : 'feilet';
    const err = errors.length ? `${errors.length} av ${parsed.length} feilet – ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? ' …' : ''}` : null;
    await c.env.DB.prepare('UPDATE ai_actions SET status = ?, error = ?, result = ? WHERE id = ?').bind(status, err, JSON.stringify({ ok, errors }), r.id).run();
    return c.json(view({ ...r, status, error: err }, ok ? linkFor(r.kind, {}, r.path, parsed) : null));
  }
  const res = await run(r.body);
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* ikke JSON */ }
  if (!res.ok) {
    const err = typeof data.error === 'string' ? data.error : `Feil ${res.status}`;
    await c.env.DB.prepare("UPDATE ai_actions SET status = 'feilet', error = ?, result = ? WHERE id = ?").bind(err, text.slice(0, 4000), r.id).run();
    return c.json(view({ ...r, status: 'feilet', error: err }), 200);
  }
  await c.env.DB.prepare('UPDATE ai_actions SET result = ? WHERE id = ?').bind(text.slice(0, 4000), r.id).run();
  return c.json(view({ ...r, status: 'utfort' }, linkFor(r.kind, data, r.path, JSON.parse(r.body))));
});

app.post('/actions/:id/cancel', async c => {
  const r = await own(c, c.req.param('id'));
  if (r.status === 'foreslatt') await c.env.DB.prepare("UPDATE ai_actions SET status = 'avbrutt', done_at = ? WHERE id = ?").bind(nowIso(), r.id).run();
  return c.json(view({ ...r, status: r.status === 'foreslatt' ? 'avbrutt' : r.status }));
});

// ---------------------------------------------------------------- morgenbrief

/** Dagens brief første gang brukeren åpner Flow i dag; null når den er sett (eller Claude ikke er satt opp). */
app.get('/brief', async c => {
  const user = c.get('user');
  const db = c.env.DB;
  const day = todayOslo();
  if (!c.env.ANTHROPIC_API_KEY?.trim()) return c.json({ brief: null });
  const seen = await db.prepare('SELECT 1 FROM ai_brief_views WHERE user_id = ? AND day = ?').bind(user.id, day).first();
  if (seen) return c.json({ brief: null });
  const roles = [...user.roles].sort().join(',') || 'admin';
  const l = user.prefs.lang ?? 'nb';
  let row = await db.prepare('SELECT text FROM ai_briefs WHERE day = ? AND roles = ? AND lang = ?').bind(day, roles, l).first<{ text: string }>();
  if (!row) {
    const text = await guard(() => morningBrief(c.env, roles.split(','), l));
    await db.prepare('INSERT OR IGNORE INTO ai_briefs (day, roles, lang, text) VALUES (?, ?, ?, ?)').bind(day, roles, l, text).run();
    row = { text };
  }
  return c.json({ brief: { day, text: row.text } satisfies MorningBrief });
});

app.post('/brief/seen', async c => {
  await c.env.DB.prepare('INSERT OR IGNORE INTO ai_brief_views (user_id, day) VALUES (?, ?)').bind(c.get('user').id, todayOslo()).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- kaibok med egne ord

app.post('/kaibok', requireRole(...CAN.quayLog), body(z.object({ port_call_id: z.string().min(1).max(64), text: z.string().trim().min(3).max(4000) })), async c => {
  const { port_call_id, text } = c.req.valid('json');
  const call = await c.env.DB.prepare('SELECT b.name AS boat, pc.type, pc.eta FROM port_calls pc JOIN boats b ON b.id = pc.boat_id WHERE pc.id = ?')
    .bind(port_call_id).first<{ boat: string; type: string; eta: string }>();
  if (!call) throw fail(404, 'Fant ikke anløpet.');
  const draft = await guard(() => kaibokDraft(c.env, call, text));
  return c.json(draft satisfies KaibokDraft);
});

// ---------------------------------------------------------------- før båten kommer

/** Sammendrag av båten til anløpet. Lages på nytt når kaibøker, flagg eller merknad endres, ellers etter en uke. */
app.get('/boat/:id', async c => {
  if (!c.env.ANTHROPIC_API_KEY?.trim()) return c.json({ text: null });
  const db = c.env.DB;
  const l = c.get('user').prefs.lang ?? 'nb';
  const b = await db.prepare(`SELECT id, name, rating_count, last_log_at, flag_auto, flag_override, note FROM boats WHERE id = ?`).bind(c.req.param('id'))
    .first<{ id: string; name: string; rating_count: number; last_log_at: string | null; flag_auto: string; flag_override: string | null; note: string | null }>();
  if (!b) throw fail(404, 'Fant ikke båten.');
  const basis = await sha256([b.rating_count, b.last_log_at, b.flag_override ?? b.flag_auto, b.note].join('|'));
  const row = await db.prepare('SELECT basis, text, created_at FROM ai_boat_briefs WHERE boat_id = ? AND lang = ?').bind(b.id, l).first<{ basis: string; text: string; created_at: string }>();
  if (row && row.basis === basis && Date.parse(row.created_at) > Date.now() - 7 * 86_400_000) return c.json({ text: row.text });
  const text = await guard(() => boatBrief(c.env, b.name, l));
  await db.prepare('INSERT OR REPLACE INTO ai_boat_briefs (boat_id, lang, basis, text) VALUES (?, ?, ?, ?)').bind(b.id, l, basis, text).run();
  return c.json({ text });
});

// ---------------------------------------------------------------- rapport med forklaringer

const date = z.iso.date();
app.post('/report', body(z.object({ from: date, to: date, fresh: z.boolean().optional() })), async c => {
  const { from, to, fresh } = c.req.valid('json');
  if (to < from) throw fail(400, 'Til-dato må være etter fra-dato.');
  if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) throw fail(400, 'Velg en periode på maks ett år.');
  const db = c.env.DB;
  const user = c.get('user');
  const l = user.prefs.lang ?? 'nb';
  if (!fresh) {
    const row = await db.prepare('SELECT text, created_at FROM ai_reports WHERE period_from = ? AND period_to = ? AND lang = ?').bind(from, to, l).first<{ text: string; created_at: string }>();
    if (row) return c.json({ from, to, text: row.text, created_at: row.created_at } satisfies AiReport);
  }
  const text = await guard(() => periodReport(c.env, from, to, l));
  const created = nowIso();
  await db.prepare('INSERT OR REPLACE INTO ai_reports (period_from, period_to, lang, text, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(from, to, l, text, user.id, created).run();
  return c.json({ from, to, text, created_at: created } satisfies AiReport);
});

// ---------------------------------------------------------------- oversettelse

/** Oversetter fritekst til leserens språk. Hver tekst oversettes én gang per språk og lagres. */
app.post('/translate', body(z.object({ texts: z.array(z.string().max(4000)).min(1).max(50), lang })), async c => {
  const { texts, lang: l } = c.req.valid('json');
  const db = c.env.DB;
  const hashes = await Promise.all(texts.map(t => sha256(t.trim())));
  const cached = await db.prepare(`SELECT hash, source_lang, text FROM translations WHERE lang = ? AND hash IN (SELECT value FROM json_each(?))`)
    .bind(l, JSON.stringify(hashes)).all<{ hash: string; source_lang: string | null; text: string | null }>();
  const have = new Map(cached.results.map(r => [r.hash, r]));
  const missing = [...new Set(hashes.filter(h => !have.has(h)))];
  if (missing.length && c.env.ANTHROPIC_API_KEY?.trim()) {
    const src = missing.map(h => texts[hashes.indexOf(h)].trim());
    try {
      const out = await translateTexts(c.env, src, l);
      await db.batch(out.map((o, i) => db.prepare('INSERT OR REPLACE INTO translations (hash, lang, source_lang, text) VALUES (?, ?, ?, ?)')
        .bind(missing[i], l, o.source_lang, o.text)));
      out.forEach((o, i) => have.set(missing[i], { hash: missing[i], ...o }));
    } catch (e) {
      console.error('oversettelse', e);
    }
  }
  return c.json(hashes.map(h => ({ text: have.get(h)?.text ?? null, source_lang: have.get(h)?.source_lang ?? null }) satisfies Translation));
});

export default app;
