import { Hono } from 'hono';
import { z } from 'zod';
import type { AskAnswer } from '../../shared/api.ts';
import { AskError, ask } from '../lib/ask.ts';
import { body, fail } from '../lib/http.ts';
import type { AppEnv } from '../types.ts';

// «Spør Flow»: spørsmål med vanlige ord fra søkefeltet. Svaret lages av Claude med verktøy som bare leser data.
// Alle spørsmål logges (ai_questions), og hver bruker kan stille et begrenset antall per time.
const app = new Hono<AppEnv>();

const PER_HOUR = 40;

app.post('/', body(z.object({ question: z.string().trim().min(3).max(300), lang: z.enum(['nb', 'en', 'lt', 'da', 'sv', 'is']).optional() })), async c => {
  const { question, lang } = c.req.valid('json');
  const user = c.get('user');
  const db = c.env.DB;
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const used = await db.prepare('SELECT count(*) AS n FROM ai_questions WHERE user_id = ? AND created_at >= ?').bind(user.id, hourAgo).first<{ n: number }>();
  if ((used?.n ?? 0) >= PER_HOUR) throw fail(429, 'Du har stilt mange spørsmål den siste timen. Prøv igjen litt senere.');
  const t0 = Date.now();
  try {
    const r = await ask(c.env, question, lang ?? user.prefs.lang ?? 'nb', user.name);
    await db.prepare('INSERT INTO ai_questions (user_id, question, answer, tools, model, ms) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(user.id, question, r.answer, JSON.stringify(r.tools), r.model, Date.now() - t0).run();
    return c.json({ question, answer: r.answer, tools: r.tools } satisfies AskAnswer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ukjent feil';
    await db.prepare('INSERT INTO ai_questions (user_id, question, ms, error) VALUES (?, ?, ?, ?)').bind(user.id, question, Date.now() - t0, msg).run();
    if (e instanceof AskError) throw fail(e.status, e.message);
    throw e;
  }
});

export default app;
