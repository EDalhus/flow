import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { validator } from 'hono/validator';
import type { z } from 'zod';

/** Feil med JSON-kropp { error, ...extra } og riktig statuskode. */
export function fail(status: ContentfulStatusCode, error: string, extra: Record<string, unknown> = {}): HTTPException {
  return new HTTPException(status, { res: Response.json({ error, ...extra }, { status }) });
}

function invalid(e: z.ZodError): HTTPException {
  return fail(400, 'Ugyldige data.', { issues: e.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
}

export const body = <S extends z.ZodType>(schema: S) =>
  validator('json', value => {
    const r = schema.safeParse(value);
    if (!r.success) throw invalid(r.error);
    return r.data as z.output<S>;
  });

export const query = <S extends z.ZodType>(schema: S) =>
  validator('query', value => {
    const r = schema.safeParse(value);
    if (!r.success) throw invalid(r.error);
    return r.data as z.output<S>;
  });

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;

export const nowIso = () => new Date().toISOString();

/** D1-feil fra en UNIQUE-/CHECK-/FK-begrensning. */
export const isConstraintError = (e: unknown, kind: 'UNIQUE' | 'FOREIGN KEY' | 'CHECK' = 'UNIQUE') =>
  e instanceof Error && e.message.includes(`${kind} constraint failed`);
