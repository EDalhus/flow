// BarentsWatch AIS (Kystverkets AIS-data). OAuth client credentials; nøkkel og hemmelighet
// ligger som Cloudflare-secrets (BW_CLIENT_ID / BW_CLIENT_SECRET), aldri i koden.
// Dokumentasjon: https://developer.barentswatch.no/docs/AIS/live-ais-api/

export const TOKEN_URL = 'https://id.barentswatch.no/connect/token';
/** Siste posisjon – se https://developer.barentswatch.no/docs/AIS/examples/ */
export const LATEST_URL = 'https://live.ais.barentswatch.no/v1/latest/combined';

/** Siste posisjon per MMSI (default JSON-format fra Live AIS). */
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
      body: JSON.stringify({ mmsi }),
    });
    // Tokenet kan være trukket tilbake; prøv én gang med nytt.
    if (res.status === 401 && retry) { resetTokenCache(); return call(false); }
    if (!res.ok) throw new Error(`BarentsWatch AIS svarte ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('BarentsWatch AIS svarte uten posisjonsliste');
    return data as AisPosition[];
  };
  return call(true);
}

// ---------------------------------------------------------------- søk på navn

/** Skipsdata og siste posisjon fra «latest/combined» (modelType Full). Feltene kan mangle. */
export interface AisVesselInfo {
  mmsi: number;
  name?: string | null;
  callSign?: string | null;
  imoNumber?: number | null;
  shipType?: number | null;
  shipLength?: number | null;
  shipWidth?: number | null;
  draught?: number | null;
  destination?: string | null;
  eta?: string | null;
  countryCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  speedOverGround?: number | null;
  courseOverGround?: number | null;
  msgtime?: string | null;
}

// Alle fartøy BarentsWatch har sett siste 24 timer. BarentsWatch kan ikke søke på navn,
// så listen hentes samlet og filtreres her. Den holdes i minnet et par minutter per isolat.
let fleet: { at: number; key: string; list: AisVesselInfo[] } | null = null;
const FLEET_TTL = 3 * 60_000;

export async function fetchAllLatest(creds: { clientId: string; clientSecret: string }, fetcher: Fetcher = fetch): Promise<AisVesselInfo[]> {
  const clientId = creds.clientId.trim();
  const clientSecret = creds.clientSecret.trim();
  if (fleet && fleet.key === clientId && Date.now() - fleet.at < FLEET_TTL) return fleet.list;
  const call = async (retry: boolean): Promise<AisVesselInfo[]> => {
    const t = await token(clientId, clientSecret, fetcher);
    const res = await fetcher(`${LATEST_URL}?modelType=Full`, { headers: { authorization: `Bearer ${t}` } });
    if (res.status === 401 && retry) { resetTokenCache(); return call(false); }
    if (!res.ok) throw new Error(`BarentsWatch AIS svarte ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('BarentsWatch AIS svarte uten fartøyliste');
    return data as AisVesselInfo[];
  };
  const list = await call(true);
  fleet = { at: Date.now(), key: clientId, list };
  return list;
}

export function resetFleetCache() {
  fleet = null;
}

const norm = (s: string) => s.toLowerCase().replace(/^(ms|mv|mf|m\/s|m\/v)\s+/, '').replace(/[^a-z0-9æøå]/g, '');

/** Treff på navn (uten «MS»/«MV» og tegnsetting), MMSI, IMO eller kallesignal. Best treff først. */
export function matchVessels(list: AisVesselInfo[], q: string, limit = 8): AisVesselInfo[] {
  const needle = norm(q);
  const digits = q.replace(/\D/g, '');
  if (needle.length < 2 && digits.length < 4) return [];
  const scored: { v: AisVesselInfo; score: number }[] = [];
  for (const v of list) {
    const name = norm(v.name ?? '');
    let score = 0;
    if (digits.length >= 4 && (String(v.mmsi).startsWith(digits) || String(v.imoNumber ?? '').startsWith(digits))) score = 3;
    else if (name && name === needle) score = 3;
    else if (name.startsWith(needle)) score = 2;
    else if (needle.length >= 3 && name.includes(needle)) score = 1;
    else if (v.callSign && norm(v.callSign) === needle) score = 2;
    if (score) scored.push({ v, score });
  }
  return scored.sort((a, b) => b.score - a.score || (a.v.name ?? '').localeCompare(b.v.name ?? '')).slice(0, limit).map(x => x.v);
}
