// Tynn fetch-klient mot /api. Feil fra API-et kastes som ApiError med norsk melding.

export class ApiError extends Error {
  status: number;
  issues: { path: string; message: string }[];
  field?: string;
  constructor(status: number, body: { error?: string; issues?: { path: string; message: string }[]; field?: string }) {
    super(body.error ?? `Feil ${status}`);
    this.status = status;
    this.issues = body.issues ?? [];
    this.field = body.field;
  }
  /** Første valideringsmelding, eller hovedmeldingen. */
  get detail() {
    return this.issues[0]?.message ?? this.message;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data ?? {});
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof ApiError ? e.detail : e instanceof Error ? e.message : 'Noe gikk galt.');
