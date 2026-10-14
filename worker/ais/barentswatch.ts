// BarentsWatch AIS (Kystverkets AIS-data). OAuth client credentials; nøkkel og hemmelighet
// ligger som Cloudflare-secrets (BW_CLIENT_ID / BW_CLIENT_SECRET), aldri i koden.
// Dokumentasjon: https://developer.barentswatch.no/docs/AIS/live-ais-api/

export const TOKEN_URL = 'https://id.barentswatch.no/connect/token';
export const LATEST_URL = 'https://live.ais.barentswatch.no/live/v1/latest/combined';

/** Siste posisjon per MMSI (modelType "Simple"). */
export interface AisPosition {
  mmsi: number;
  name?: string | null;
  latitude: number;
  longitude: number;
  speedOverGround?: number | null;
  courseOverGround?: number | null;
  trueHeading?: number | null;
  navigationalStatus?: number | null;
  msgtime: string;
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

// Tokenet lever en time; vi gjenbruker det i isolatet til det nesten er utløpt.
let cached: { token: string; expires: number; key: string } | null = null;

export function resetTokenCache() {
  cached = null;
}

async function token(clientId: string, clientSecret: string, fetcher: Fetcher): Promise<string> {
  const key = clientId;
  if (cached && cached.key === key && cached.expires > Date.now() + 60_000) return cached.token;
  const res = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: 'ais', grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(await tokenError(res));
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('BarentsWatch svarte uten access_token');
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000, key };
  return cached.token;
}

// OAuth-feilkoder fra id.barentswatch.no, forklart. Koden inneholder aldri nøkler.
const OAUTH_ERRORS: Record<string, string> = {
  invalid_client: 'klient-ID eller hemmelighet er feil. Klient-ID-en skal være nøyaktig som hos BarentsWatch, typisk «din@epost.no:klientnavn».',
  invalid_scope: 'klienten har ikke AIS-tilgang. Registrer en klient av typen «AIS» på Min side hos BarentsWatch.',
  unauthorized_client: 'klienten har ikke lov til å bruke client credentials. Sjekk klienttypen hos BarentsWatch.',
  invalid_request: 'forespørselen ble avvist. Sjekk at klient-ID og hemmelighet ikke inneholder ekstra tegn.',
};

async function tokenError(res: Response): Promise<string> {
  let code = '';
  try { code = String(((await res.json()) as { error?: string }).error ?? ''); } catch { /* ikke JSON */ }
  const why = OAUTH_ERRORS[code];
  return `BarentsWatch-innlogging feilet (${res.status}${code ? ` ${code}` : ''})${why ? `: ${why}` : '.'}`;
}

export async function fetchLatest(
  creds: { clientId: string; clientSecret: string },
  mmsi: number[],
  fetcher: Fetcher = fetch,
): Promise<AisPosition[]> {
  if (!mmsi.length) return [];
  // Innlimte verdier får ofte et usynlig linjeskift eller mellomrom på slutten.
  const clientId = creds.clientId.trim();
  const clientSecret = creds.clientSecret.trim();
  const call = async (retry: boolean): Promise<AisPosition[]> => {
    const t = await token(clientId, clientSecret, fetcher);
    const res = await fetcher(LATEST_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
      body: JSON.stringify({ mmsi, modelType: 'Simple', modelFormat: 'Json' }),
    });
    // Tokenet kan være trukket tilbake; prøv én gang med nytt.
    if (res.status === 401 && retry) { resetTokenCache(); return call(false); }
    if (!res.ok) throw new Error(`BarentsWatch AIS svarte ${res.status}`);
    return (await res.json()) as AisPosition[];
  };
  return call(true);
}
