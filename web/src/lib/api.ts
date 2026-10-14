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

// Uten Cloudflare Access velger brukeren selv hvem hen er; valget huskes i nettleseren.
const CHOSEN_KEY = 'flow-as';
export function chosenUser(): string | null {
  try { return localStorage.getItem(CHOSEN_KEY); } catch { return null; }
}
export function chooseUser(email: string | null) {
  try {
    if (email) localStorage.setItem(CHOSEN_KEY, email);
    else localStorage.removeItem(CHOSEN_KEY);
  } catch { /* privat modus: valget gjelder bare denne fanen */ }
}
/** Header som forteller API-et hvem som er valgt (ignoreres når Access er på). */
export const chosenHeaders = (): Record<string, string> => {
  const c = chosenUser();
  return c ? { 'X-Flow-As': c } : {};
};

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { ...chosenHeaders(), ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data ?? {});
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof ApiError ? e.detail : e instanceof Error ? e.message : 'Noe gikk galt.');
