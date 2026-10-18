// Genererer seed/seed.sql: eksempeldataene fra designet + oppdiktet historikk for 2025/2026.
//
//   npm run seed:gen                       # relativt til dagens dato
//   SEED_TODAY=2026-10-14 npm run seed:gen # fast dato (slik seed.sql i repoet er laget)
//
// Deterministisk: samme SEED_TODAY gir samme fil.
// NB: seed.sql starter med å tømme alle tabeller. Kjør den aldri mot en database med ekte data.

import { addDays, isoWeek, isoWeekMonday, isoWeeksInYear, osloToUtc, todayOslo } from '../shared/time.ts';

const TODAY = process.env.SEED_TODAY ?? todayOslo();

// ---------------------------------------------------------------- hjelpere

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261014);
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const chance = (p: number) => rnd() < p;
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

const seqs: Record<string, number> = {};
const id = (prefix: string) => `${prefix}_${String((seqs[prefix] = (seqs[prefix] ?? 0) + 1)).padStart(5, '0')}`;

const at = (date: string, minutes: number) => osloToUtc(date, minutes);
const plusMin = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60000).toISOString();
/** "03.09" for en dag relativt til TODAY – brukes i tekster som nevner datoer. */
const dm = (offset: number) => { const d = addDays(TODAY, offset); return `${d.slice(8, 10)}.${d.slice(5, 7)}`; };
const weekday = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7; // man = 0

type Row = Record<string, string | number | boolean | null | undefined>;
const tables: Record<string, Row[]> = {};
const order: string[] = [];
function add(table: string, row: Row) {
  if (!tables[table]) { tables[table] = []; order.push(table); }
  tables[table].push(row);
}
function sqlValue(v: Row[string]): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return `'${v.replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------- folk

type CrewRole = 'truck' | 'anhuker' | 'kaikran';
const USERS: { key: string; name: string; short: string; initials: string; title: string; phone: string; roles: string[]; skills: CrewRole[] }[] = [
  { key: 'kari', name: 'Kari Sæther', short: 'Kari S.', initials: 'KS', title: 'Salg', phone: '+47 400 10 203', roles: ['salg'], skills: [] },
  { key: 'henrik', name: 'Henrik Moe', short: 'Henrik M.', initials: 'HM', title: 'Salg', phone: '+47 400 10 204', roles: ['salg'], skills: [] },
  { key: 'mari', name: 'Mari Lien', short: 'Mari L.', initials: 'ML', title: 'Planlegger', phone: '+47 400 10 205', roles: ['produksjon'], skills: [] },
  { key: 'jonas', name: 'Jonas Berg', short: 'Jonas B.', initials: 'JB', title: 'Formann kai', phone: '+47 400 10 206', roles: ['produksjon', 'kaiarbeider'], skills: ['truck', 'anhuker'] },
  { key: 'ola', name: 'Ola Nygård', short: 'Ola N.', initials: 'ON', title: 'Kai · truck', phone: '+47 400 10 207', roles: ['kaiarbeider'], skills: ['truck'] },
  { key: 'per', name: 'Per Hansen', short: 'Per H.', initials: 'PH', title: 'Kai · truck', phone: '+47 400 10 208', roles: ['kaiarbeider'], skills: ['truck'] },
  { key: 'lars', name: 'Lars Tennfjord', short: 'Lars T.', initials: 'LT', title: 'Kai · truck', phone: '+47 400 10 209', roles: ['kaiarbeider'], skills: ['truck'] },
  { key: 'anders', name: 'Anders Krogh', short: 'Anders K.', initials: 'AK', title: 'Kai · anhuker', phone: '+47 400 10 210', roles: ['kaiarbeider'], skills: ['anhuker'] },
  { key: 'stian', name: 'Stian Myklebust', short: 'Stian M.', initials: 'SM', title: 'Kai · anhuker', phone: '+47 400 10 212', roles: ['kaiarbeider'], skills: ['anhuker'] },
  { key: 'morten', name: 'Morten Rønneberg', short: 'Morten R.', initials: 'MR', title: 'Kai · kaikran', phone: '+47 400 10 213', roles: ['kaiarbeider'], skills: ['kaikran', 'anhuker'] },
];
const U = (key: string) => `u_${key}`;
const SKILL = Object.fromEntries(USERS.map(u => [u.key, u.skills[0] ?? 'truck'])) as Record<string, CrewRole>;
const CREW_KEYS = USERS.filter(u => u.skills.length).map(u => u.key);
const SELLERS = ['kari', 'henrik'];

for (const u of USERS) {
  add('users', { id: U(u.key), email: `${u.key}@flow.example`, name: u.name, short_name: u.short, initials: u.initials, title: u.title, phone: u.phone });
}
for (const u of USERS) for (const role of u.roles) add('user_roles', { user_id: U(u.key), role });
for (const u of USERS) for (const s of u.skills) add('crew_skills', { user_id: U(u.key), crew_role: s });

// Vakt: hverdager fra i dag og en uke frem, 4 truck / 3 anhuker / 1 kaikran.
for (let d = 0; d < 8; d++) {
  const date = addDays(TODAY, d);
  if (weekday(date) > 4) continue;
  for (const k of ['per', 'lars', 'ola', 'jonas']) add('shifts', { service_date: date, user_id: U(k), crew_role: 'truck' });
  for (const k of ['stian', 'anders', 'jonas']) add('shifts', { service_date: date, user_id: U(k), crew_role: 'anhuker' });
  add('shifts', { service_date: date, user_id: U('morten'), crew_role: 'kaikran' });
}

// ---------------------------------------------------------------- innstillinger

const SETTINGS: Record<string, unknown> = {
  capacity: { truck: 4, anhuker: 3, kaikran: 1 },
  // Fra Kartverkets adresseregister: Flatholmen havn 81B, 6002 Ålesund.
  geofence: { lat: 62.47918, lon: 6.19292, radius_m: 300, label: 'Flatholmen havn 81B' },
  flag_rules: {
    red_avg_below: 2.5,
    red_categories: ['skade_gods', 'mannskap_hms'],
    red_lookback: 2,
    yellow_avg_below: 3.5,
    yellow_dimension_below: 3.0,
  },
  postpone_buffer_minutes: 15,
  punctuality_window_minutes: 30,
  // Uten AIS: «Kaibok mangler» når ETD er passert med så mange minutter uten levert kaibok.
  quay_log_missing_after_minutes: 60,
};
for (const [key, value] of Object.entries(SETTINGS)) add('settings', { key, value: JSON.stringify(value) });

// ---------------------------------------------------------------- kaier, agenter, båter

// Omtrentlige posisjoner langs kaifronten ved adressen; justeres når AIS kobles på.
add('quays', { id: 'q_kai1', name: 'Kai 1', nickname: 'Ytre', company: null, sort: 1, lat: 62.47935, lon: 6.19240 });
add('quays', { id: 'q_kai2', name: 'Kai 2', nickname: 'Indre', company: null, sort: 2, lat: 62.47900, lon: 6.19345 });
// Eksempel på nabokai for samarbeid om kaiplass.
add('quays', { id: 'q_nabo1', name: 'Kai A', nickname: 'Fiskebrygga', company: 'Ålesund Fiskemottak', sort: 10, lat: 62.4802, lon: 6.1911 });
const QUAYS = ['q_kai1', 'q_kai2', 'q_nabo1'];
const QUAY = { 'Kai 1': 'q_kai1', 'Kai 2': 'q_kai2', 'Kai A': 'q_nabo1' } as const;

const AGENTS = {
  kystagenten: ['Kystagenten AS', '+47 400 10 201'],
  nordvest: ['Nordvest Shipping AS', '+47 400 10 211'],
  fosen: ['Fosen Skipsagentur', '+47 400 10 221'],
  polar: ['Polar Agency AS', '+47 400 10 231'],
} as const;
for (const [key, [name, phone]] of Object.entries(AGENTS)) add('agents', { id: `ag_${key}`, name, phone });

type Flag = 'green' | 'yellow' | 'red' | 'none';
const BOATS: { key: string; name: string; agent: keyof typeof AGENTS; contact: string; phone: string; flag: Flag; flagReason: string | null; note: string; sub: [number, number, number] | null; logs: number }[] = [
  { key: 'havbris', name: 'MV Havbris', agent: 'nordvest', contact: 'Bro', phone: '+47 400 10 212', flag: 'green', flagReason: 'Ingen avvik siste 6 anløp.', note: 'Ingen avvik siste 6 anløp. Mannskapet hjelper til med surring.', sub: [4.8, 4.7, 4.3], logs: 14 },
  { key: 'lyngoy', name: 'Lyngøy', agent: 'kystagenten', contact: 'Skipper', phone: '+47 400 10 262', flag: 'green', flagReason: 'Ryddig og presis.', note: 'Ryddig og presis.', sub: [4.5, 4.4, 4.3], logs: 5 },
  { key: 'senja', name: 'Senja Trader', agent: 'nordvest', contact: 'Bro', phone: '+47 400 10 242', flag: 'green', flagReason: 'Ingen avvik siste 4 anløp.', note: 'Ingen avvik siste 4 anløp.', sub: [4.3, 4.0, 4.1], logs: 8 },
  { key: 'fjordvik', name: 'Fjordvik', agent: 'kystagenten', contact: 'Skipper', phone: '+47 400 10 202', flag: 'green', flagReason: 'Stabil – ingen avvik siste 5 anløp.', note: 'Stabil – ingen avvik siste 5 anløp.', sub: [4.2, 4.3, 3.6], logs: 22 },
  { key: 'kvaloy', name: 'Kvaløy Senior', agent: 'polar', contact: 'Skipper', phone: '+47 400 10 272', flag: 'green', flagReason: 'Ingen merknader.', note: 'Ingen merknader.', sub: [3.8, 4.1, 3.8], logs: 12 },
  { key: 'nordkyn', name: 'MS Nordkyn', agent: 'kystagenten', contact: 'Skipper', phone: '+47 400 10 252', flag: 'yellow', flagReason: 'Ofte 1–2 t forsinket.', note: 'Ofte 1–2 t forsinket – sjekk AIS før mannskap kalles inn.', sub: [2.6, 4.2, 4.0], logs: 11 },
  { key: 'kystlast', name: 'MS Kystlast', agent: 'fosen', contact: 'Skipper', phone: '+47 400 10 222', flag: 'yellow', flagReason: `Båtkrana stoppet to ganger ved forrige anløp (${dm(-41)}).`, note: `Båtkrana stoppet to ganger ved forrige anløp (${dm(-41)}).`, sub: [3.0, 3.8, 2.8], logs: 9 },
  { key: 'brattholm', name: 'Brattholm', agent: 'fosen', contact: 'Skipper', phone: '+47 400 10 282', flag: 'yellow', flagReason: 'Smal luke gir treg lossing – beregn ekstra tid.', note: 'Smal luke gir treg lossing – beregn ekstra tid.', sub: [3.5, 3.3, 2.5], logs: 4 },
  { key: 'polarstrand', name: 'Polarstrand', agent: 'polar', contact: 'Bro', phone: '+47 400 10 232', flag: 'red', flagReason: `Mannskap uten verneutstyr, 3 paller skadet ved lasting (${dm(-54)}).`, note: `Mannskap uten verneutstyr, 3 paller skadet ved lasting (${dm(-54)}).`, sub: [2.4, 1.8, 2.2], logs: 6 },
  { key: 'sorvaer', name: 'Sørvær', agent: 'kystagenten', contact: 'Skipper', phone: '+47 400 10 292', flag: 'none', flagReason: null, note: 'Ny i kaiboka – ingen erfaringer ennå.', sub: null, logs: 0 },
];
const B = (key: string) => `b_${key}`;
for (const b of BOATS) {
  add('boats', {
    id: B(b.key), name: b.name, imo: null, mmsi: null, callsign: null, agent_id: `ag_${b.agent}`,
    ship_contact: `${b.contact}, ${b.name}`, ship_phone: b.phone, note: b.note,
    flag_auto: b.flag, flag_auto_reason: b.flagReason,
  });
}
const HISTORY_BOATS = BOATS.filter(b => b.logs > 0).map(b => b.key);

// ---------------------------------------------------------------- produkter

const PRODUCTS = ['Hav salt', 'Stein salt', 'Blandet salt', 'Fint Rafinert salt', 'Sukker', 'MG Kombi', 'Marsel Hav salt', 'Sukker salt 1:2', 'Nitrite'];
const P = (name: string) => `p_${PRODUCTS.indexOf(name) + 1}`;
PRODUCTS.forEach((name, i) => add('products', { id: P(name), name, sort: i + 1 }));

type Sku = { id: string; product: string; unit: 'BB' | 'pall'; pallet: 'europall' | 'srs' | null; kg: number };
const SKUS: Sku[] = [];
let skuSort = 0;
function sku(product: string, unit: 'BB' | 'pall', pallet: 'europall' | 'srs' | null, bags: number | null) {
  const s: Sku = { id: `s_${PRODUCTS.indexOf(product) + 1}_${unit === 'BB' ? 'bb' : pallet}`, product, unit, pallet, kg: bags ? bags * 25 : 1000 };
  SKUS.push(s);
  add('skus', { id: s.id, product_id: P(product), unit, bags_per_unit: bags, bag_kg: bags ? 25 : null, pallet_type: pallet, kg_per_unit: s.kg, sort: ++skuSort });
}
for (const p of ['Hav salt', 'Stein salt', 'Blandet salt', 'Fint Rafinert salt', 'Sukker', 'MG Kombi', 'Marsel Hav salt']) sku(p, 'BB', null, null);
for (const [p, bags] of [['Hav salt', 40], ['Sukker salt 1:2', 40], ['Nitrite', 42], ['Fint Rafinert salt', 42]] as const) {
  sku(p, 'pall', 'europall', bags);
  sku(p, 'pall', 'srs', bags);
}
const S = (product: string, unit: 'BB' | 'pall', pallet: 'europall' | 'srs' | null = null) => {
  const s = SKUS.find(x => x.product === product && x.unit === unit && x.pallet === pallet);
  if (!s) throw new Error(`Ukjent SKU ${product} ${unit} ${pallet}`);
  return s;
};

// ---------------------------------------------------------------- anløp

type Goods = { sku: Sku; qty: number; dir: 'inn' | 'ut' };
type Call = {
  id: string; boat: string; type: 'levering' | 'henting'; quay: string; date: string;
  start: number; end: number; // minutter etter midnatt, lokal tid
  seller: string | null; crane?: boolean; responsible?: string | null;
  crew?: [CrewRole, string | null][];
  goods: Goods[];
  arrivedDelay?: number | null; // minutter etter ETA; null = ikke ankommet
  departed?: boolean;
  completedAt?: string | null;
  source: 'app' | 'import';
  /** Klokkeslett ikke kjent ennå: lagres som hele dagen. */
  untimed?: boolean;
  /** Salgsordrene (SO) på anløpet, i lasterekkefølge: kunde og indekser i goods. Standard: én SO med alle varene. */
  orders?: { customer: string; goods: number[] }[];
};

// ---------------------------------------------------------------- salgsordre (SO fra Dynamics 365)

const CUSTOMERS = ['Hessa Seafood', 'Vartdal Fisk', 'Fjordlaks', 'Ålesund Fiskemottak', 'Brødrene Sperre', 'Nordic Salt Trading', 'Sunnmøre Sild', 'Kystfisk AS', 'Nergård Sjømat', 'Myklebust Sjømat'];
const usedSo = new Set<string>();
/** Tilfeldig, unikt SO-nummer: 20 + fem siffer. */
function soNumber() {
  for (;;) { const n = `20${String(int(10000, 99999))}`; if (!usedSo.has(n)) { usedSo.add(n); return n; } }
}
/** Legger inn en SO med linjer (på anløpet callId, eller uten båt). */
function addOrder(o: { customer: string; seller: string | null; date: string; goods: Goods[]; callId: string | null; seq?: number; source: 'app' | 'import'; createdAt: string; by: string }) {
  const soId = id('so');
  const so = soNumber();
  add('sales_orders', { id: soId, so_number: so, customer: o.customer, seller_id: o.seller ? U(o.seller) : null, wanted_date: o.date, source: o.source, created_by: U(o.by), created_at: o.createdAt, updated_at: o.createdAt });
  o.goods.forEach((g, i) => add('order_lines', { id: id('ol'), sales_order_id: soId, port_call_id: o.callId, sku_id: g.sku.id, quantity: g.qty, direction: g.dir, sort: i }));
  if (o.callId) add('port_call_orders', { port_call_id: o.callId, sales_order_id: soId, load_seq: o.seq ?? 1 });
  if (o.source === 'app') {
    add('order_log', { sales_order_id: soId, port_call_id: o.callId, user_id: U(o.by), kind: 'created', data: JSON.stringify({ so_number: so }), at: o.createdAt });
  }
  return { soId, so };
}

function addCall(c: Call) {
  const eta = at(c.date, c.untimed ? 0 : c.start), etd = at(c.date, c.untimed ? 23 * 60 + 59 : c.end);
  const slots = c.crew ?? [];
  // Regel: én rolle → den personen er automatisk ansvarlig.
  const responsible = slots.length === 1 ? (slots[0][1] ?? null) : (c.responsible ?? null);
  const arrived = c.arrivedDelay == null ? null : plusMin(eta, c.arrivedDelay);
  const departed = c.departed && arrived ? plusMin(etd, Math.max(0, c.arrivedDelay ?? 0) + int(-10, 20)) : null;
  add('port_calls', {
    id: c.id, boat_id: B(c.boat), type: c.type, quay_id: c.quay, eta, etd, time_known: c.untimed ? 0 : 1, service_date: c.date,
    seller_id: c.seller ? U(c.seller) : null, created_by: U(c.source === 'import' ? 'mari' : pick(['mari', 'kari', 'henrik'])),
    boat_crane: c.crane ? 1 : 0, responsible_user_id: responsible ? U(responsible) : null,
    arrived_at: arrived, departed_at: departed, completed_at: c.completedAt ?? null, source: c.source,
    created_at: plusMin(at(c.date, 0), -60 * 24 * int(2, 10)),
  });
  const createdAt = plusMin(at(c.date, 0), -60 * 24 * int(2, 10));
  const by = c.source === 'import' ? 'mari' : (c.seller ?? 'kari');
  const groups = c.orders ?? [{ customer: pick(CUSTOMERS), goods: c.goods.map((_, i) => i) }];
  const orders = groups.map((o, n) => addOrder({ customer: o.customer, seller: c.seller, date: c.date, goods: o.goods.map(i => c.goods[i]), callId: c.id, seq: n + 1, source: c.source, createdAt, by }));
  slots.forEach(([role, who], i) => add('crew_slots', { id: id('cs'), port_call_id: c.id, crew_role: role, user_id: who ? U(who) : null, sort: i }));
  return { eta, etd, departed, orders };
}

const CATEGORY = { forsinkelse: 'Forsinkelse', utstyr_kran: 'Utstyr / kran', skade_gods: 'Skade på gods', mannskap_hms: 'Mannskap / HMS', annet: 'Annet' };
type Category = keyof typeof CATEGORY;

function addQuayLog(callId: string, deliveredAt: string, by: string, r: [number, number, number], cats: Category[], desc: string, note: string | null) {
  const logId = id('ql');
  add('quay_logs', {
    id: logId, port_call_id: callId, had_deviation: cats.length ? 1 : 0, description: desc || null,
    r_punctuality: r[0], r_cooperation: r[1], r_equipment: r[2], boat_note: note, delivered_by: U(by), delivered_at: deliveredAt,
  });
  for (const c of cats) add('quay_log_categories', { quay_log_id: logId, category: c });
}

function crewFor(people: string[]): [CrewRole, string | null][] {
  return people.map(p => [SKILL[p], p]);
}

function randomGoods(dir: 'inn' | 'ut'): Goods[] {
  const bb = ['Hav salt', 'Stein salt', 'Blandet salt', 'Fint Rafinert salt', 'Marsel Hav salt', 'MG Kombi'];
  const g: Goods[] = [{ sku: S(pick(bb), 'BB'), qty: int(8, 30) * 10, dir }];
  if (chance(0.3)) g.push({ sku: S(pick(['Hav salt', 'Sukker salt 1:2']), 'pall', pick(['europall', 'srs'] as const)), qty: int(2, 8) * 10, dir });
  return g;
}

// ---- Kaibøker fra designet (Kaibok-logg + båtprofiler). Dag er relativt til TODAY.
type Explicit = { boat: string; day: number; kai: 'Kai 1' | 'Kai 2'; ans: string; crew: string[]; cats: Category[]; desc: string; r: [number, number, number]; note: string; by: string; time: string; start?: string; end?: string; arrivedDelay?: number; crane?: boolean; goods?: Goods[]; type?: 'levering' | 'henting' };
const EXPLICIT: Explicit[] = [
  { boat: 'fjordvik', day: 0, kai: 'Kai 2', ans: 'per', crew: ['per', 'lars', 'stian', 'morten'], cats: [], desc: '', r: [4, 4, 4], note: 'Effektiv lossing. Kranen litt treg i starten.', by: 'per', time: '07:04', start: '05:30', end: '07:00', arrivedDelay: 0, type: 'levering', goods: [{ sku: S('Stein salt', 'BB'), qty: 450, dir: 'inn' }] },
  { boat: 'havbris', day: -12, kai: 'Kai 2', ans: 'ola', crew: ['ola', 'per', 'stian'], cats: [], desc: '', r: [5, 5, 5], note: 'Presis og ryddig. Mannskapet hjalp med surring.', by: 'ola', time: '12:40' },
  { boat: 'nordkyn', day: -17, kai: 'Kai 1', ans: 'jonas', crew: ['jonas', 'lars', 'stian', 'morten'], cats: ['forsinkelse'], desc: 'Ankom 07:30, 1,5 t etter ETA. Fire mann ventet uten oppgaver.', r: [2, 4, 4], note: 'Ring skipper kvelden før for oppdatert ETA.', by: 'jonas', time: '11:15', start: '06:00', end: '09:00', arrivedDelay: 90 },
  { boat: 'lyngoy', day: -21, kai: 'Kai 2', ans: 'per', crew: ['per', 'anders'], cats: [], desc: '', r: [5, 5, 5], note: 'Kom før tiden, alt klart til lossing.', by: 'per', time: '10:52', arrivedDelay: -20 },
  { boat: 'havbris', day: -26, kai: 'Kai 1', ans: 'jonas', crew: ['jonas', 'ola', 'stian', 'morten'], cats: [], desc: '', r: [4, 4, 4], note: 'Litt venting på papirer, ellers greit.', by: 'jonas', time: '15:20' },
  { boat: 'senja', day: -33, kai: 'Kai 2', ans: 'ola', crew: ['ola', 'stian', 'morten'], cats: [], desc: '', r: [4, 4, 4], note: 'Godt samarbeid. Egen kran i god stand.', by: 'ola', time: '18:30', crane: true },
  { boat: 'kystlast', day: -41, kai: 'Kai 1', ans: 'ola', crew: ['ola'], cats: ['utstyr_kran', 'forsinkelse'], desc: 'Båtkrana stoppet to ganger under lossing. Ca. 2 t forsinkelse. Brukte egne stropper.', r: [2, 3, 1], note: 'Ha egne stropper klare neste gang.', by: 'ola', time: '14:45', crane: true },
  { boat: 'kvaloy', day: -46, kai: 'Kai 1', ans: 'jonas', crew: ['jonas', 'lars', 'anders'], cats: [], desc: '', r: [4, 4, 4], note: 'Greit anløp.', by: 'jonas', time: '13:05' },
  { boat: 'polarstrand', day: -54, kai: 'Kai 1', ans: 'jonas', crew: ['jonas', 'per', 'anders', 'morten'], cats: ['skade_gods', 'mannskap_hms'], desc: 'Mannskap uten hjelm på kaia. 3 paller skadet ved lasting fra båtkran.', r: [2, 1, 2], note: 'Krev verneutstyr før lasting starter.', by: 'jonas', time: '16:10', crane: true },
  { boat: 'brattholm', day: -60, kai: 'Kai 2', ans: 'per', crew: ['per', 'lars'], cats: [], desc: '', r: [3, 3, 3], note: 'Smal luke, tok 1 t ekstra.', by: 'per', time: '12:25' },
  { boat: 'kystlast', day: -63, kai: 'Kai 1', ans: 'jonas', crew: ['jonas', 'per'], cats: [], desc: '', r: [4, 4, 4], note: 'Greit anløp, hyggelig mannskap.', by: 'jonas', time: '14:10' },
  { boat: 'polarstrand', day: -106, kai: 'Kai 1', ans: 'ola', crew: ['ola', 'per'], cats: [], desc: '', r: [1, 4, 4], note: 'Kom 3 t for sent, ellers ok.', by: 'ola', time: '17:30', arrivedDelay: 180 },
];

const explicitCallIds: Record<string, string> = {};
for (const e of EXPLICIT) {
  const date = addDays(TODAY, e.day);
  const deliveredMin = Number(e.time.slice(0, 2)) * 60 + Number(e.time.slice(3));
  const start = e.start ? Number(e.start.slice(0, 2)) * 60 + Number(e.start.slice(3)) : Math.floor((deliveredMin - 240) / 15) * 15;
  const end = e.end ? Number(e.end.slice(0, 2)) * 60 + Number(e.end.slice(3)) : Math.floor((deliveredMin - 30) / 15) * 15;
  const type = e.type ?? pick(['levering', 'henting'] as const);
  const callId = id('pc');
  if (e.day === 0) explicitCallIds[e.boat] = callId;
  const deliveredAt = at(date, deliveredMin);
  addCall({
    id: callId, boat: e.boat, type, quay: QUAY[e.kai], date, start, end, seller: pick(SELLERS), crane: e.crane,
    responsible: e.ans, crew: crewFor(e.crew), goods: e.goods ?? randomGoods(type === 'levering' ? 'inn' : 'ut'),
    arrivedDelay: e.arrivedDelay ?? int(-15, 25), departed: true, completedAt: deliveredAt, source: 'app',
  });
  addQuayLog(callId, deliveredAt, e.by, e.r, e.cats, e.desc, e.note);
}

// ---- Eldre kaibøker, slik at hver båt får antall kaibøker og snitt som i designet.
const OLD_NOTES = ['Greit anløp.', 'Ryddig mannskap.', 'Alt gikk etter planen.', 'Litt venting på papirer.', null, null, null];
for (const b of BOATS) {
  if (!b.sub) continue;
  const mine = EXPLICIT.filter(e => e.boat === b.key);
  const n = b.logs - mine.length;
  if (n <= 0) continue;
  // Fordel resterende poengsum per dimensjon så snittet treffer designet.
  const dims = [0, 1, 2].map(d => {
    const target = Math.round(b.sub![d] * b.logs);
    const rest = target - mine.reduce((s, e) => s + e.r[d], 0);
    const base = Math.floor(rest / n);
    const vals = Array.from({ length: n }, (_, i) => base + (i < rest - base * n ? 1 : 0)).map(v => Math.min(5, Math.max(1, v)));
    return shuffle(vals);
  });
  const latest = Math.min(-62, ...mine.map(e => e.day)) - 3;
  const first = -Math.round((Date.parse(`${TODAY}T12:00:00Z`) - Date.parse('2025-01-08T12:00:00Z')) / 86400000);
  for (let i = 0; i < n; i++) {
    let day = Math.round(first + ((latest - first) * (i + 0.5)) / n) + int(-3, 3);
    let date = addDays(TODAY, day);
    while (weekday(date) > 4) { day -= 1; date = addDays(TODAY, day); }
    const r: [number, number, number] = [dims[0][i], dims[1][i], dims[2][i]];
    const cats: Category[] = [];
    if (r[0] <= 2) cats.push('forsinkelse');
    if (r[2] <= 2) cats.push('utstyr_kran');
    const desc = cats.map(c => (c === 'forsinkelse' ? 'Kom vesentlig senere enn ETA.' : 'Problemer med båtens kran under lossing.')).join(' ');
    const start = int(24, 56) * 15;
    const end = start + int(8, 14) * 15;
    const type = pick(['levering', 'henting'] as const);
    const people = shuffle([...CREW_KEYS]).slice(0, int(2, 4));
    const callId = id('pc');
    const delay = r[0] <= 2 ? int(60, 150) : r[0] === 3 ? int(25, 50) : int(-15, 20);
    const deliveredAt = at(date, Math.min(end + Math.max(0, delay) + int(10, 40), 23 * 60 + 30));
    addCall({
      id: callId, boat: b.key, type, quay: pick(QUAYS), date, start, end, seller: pick(SELLERS),
      responsible: people[0], crew: crewFor(people), goods: randomGoods(type === 'levering' ? 'inn' : 'ut'),
      arrivedDelay: delay, departed: true, completedAt: deliveredAt, source: 'app',
    });
    addQuayLog(callId, deliveredAt, people[0], r, cats, desc, pick(OLD_NOTES));
  }
}

// ---- Oppdiktet historikk til Rapporter (2025 + 2026 til og med i går), uten kaibok.
// [produkt, snitt tonn/uke 2025, sesongprofil, vekst 2026, andel inn, andel på pall]
const MODEL: [string, number, 'fisk' | 'veg' | 'flat', number, number, number][] = [
  ['Hav salt', 620, 'fisk', 1.1, 0.62, 0.3],
  ['Stein salt', 520, 'veg', 0.94, 0.55, 0],
  ['Blandet salt', 240, 'veg', 1.06, 0, 0],
  ['Fint Rafinert salt', 210, 'flat', 1.03, 0.25, 0.3],
  ['Sukker', 60, 'flat', 0.97, 0.6, 0],
  ['MG Kombi', 110, 'veg', 1.15, 0, 0],
  ['Marsel Hav salt', 180, 'fisk', 1.08, 0.55, 0],
  ['Sukker salt 1:2', 120, 'fisk', 1.12, 0, 1],
  ['Nitrite', 25, 'fisk', 1.0, 0.55, 1],
];
const gauss = (w: number, c: number, s: number) => Math.exp(-((w - c) ** 2) / (2 * s * s));
function season(kind: 'fisk' | 'veg' | 'flat', w: number) {
  if (kind === 'veg') return 0.3 + 1.5 * Math.pow((Math.cos((2 * Math.PI * (w - 1)) / 52) + 1) / 2, 1.6); // vegsalt: vinter
  if (kind === 'fisk') return 0.5 + 0.9 * gauss(w, 9, 5) + 0.85 * gauss(w, 43, 6); // skrei + sild/makrell
  return 0.95 + 0.1 * Math.sin(w / 4);
}

const TARGET_T = 290;
const current = isoWeek(TODAY);
for (const year of [2025, 2026]) {
  const weeks = isoWeeksInYear(year);
  for (let w = 1; w <= weeks; w++) {
    if (year === current.year && w > current.week) break;
    const monday = isoWeekMonday(year, w);
    const days = [0, 1, 2, 3, 4, 5].map(d => addDays(monday, d)).filter(d => d < TODAY);
    if (!days.length) continue;
    const partial = days.length / 6;

    for (const dir of ['inn', 'ut'] as const) {
      const lines: { sku: Sku; t: number }[] = [];
      for (const [name, base, kind, growth, shareIn, pall] of MODEL) {
        let t = base * season(kind, w) * (0.88 + 0.24 * rnd()) * partial;
        if (year === 2026) t *= growth * (0.92 + 0.16 * rnd());
        t *= dir === 'inn' ? shareIn : 1 - shareIn;
        if (t < 3) continue;
        const pallT = t * pall;
        if (t - pallT >= 3) lines.push({ sku: S(name, 'BB'), t: t - pallT });
        if (pallT >= 3) lines.push({ sku: S(name, 'pall', chance(0.6) ? 'europall' : 'srs'), t: pallT });
      }
      const total = lines.reduce((s, l) => s + l.t, 0);
      if (!total) continue;
      const n = Math.max(1, Math.round((total / TARGET_T) * (0.9 + 0.2 * rnd())));
      const calls: { goods: Goods[]; t: number }[] = Array.from({ length: n }, () => ({ goods: [], t: 0 }));
      for (const l of lines.sort((a, b) => b.t - a.t)) {
        const parts = Math.max(1, Math.ceil(l.t / (TARGET_T * 1.3)));
        for (let p = 0; p < parts; p++) {
          const t = l.t / parts;
          const qty = Math.round((t * 1000) / l.sku.kg);
          if (qty <= 0) continue;
          const c = calls.reduce((a, b) => (b.t < a.t ? b : a));
          c.goods.push({ sku: l.sku, qty, dir });
          c.t += t;
        }
      }
      for (const c of calls) {
        if (!c.goods.length) continue;
        const date = chance(0.06) && days.length === 6 ? days[5] : pick(days.slice(0, 5).length ? days.slice(0, 5) : days);
        const dur = Math.min(20, Math.max(6, Math.round(c.t / 90 * 4))) * 15; // ca. 90 t/time
        const start = int(20, 60) * 15;
        const end = Math.min(start + dur, 23 * 60 + 45);
        const late = chance(0.76) ? int(-25, 28) : int(35, 170);
        addCall({
          id: id('pc'), boat: pick(HISTORY_BOATS), type: dir === 'inn' ? 'levering' : 'henting', quay: pick(QUAYS), date,
          start, end, seller: pick(SELLERS), goods: c.goods, arrivedDelay: late, departed: true,
          completedAt: null, source: 'import',
        });
      }
    }
  }
}
// Importert historikk regnes som ferdig når båten har gått.
const importCompleted = 'UPDATE port_calls SET completed_at = departed_at WHERE source = \'import\';';

// ---- Dagens og kommende anløp (Anløp-tavla). a0 (Fjordvik) er allerede lagt inn som ferdig over.
type Planned = { orders?: Call['orders']; key: string; day: number; boat: string; type: 'levering' | 'henting'; kai: 'Kai 1' | 'Kai 2'; start: string; end: string; goods: Goods[]; crew: [CrewRole, string | null][]; ans?: string; seller: string; crane?: boolean; arrived?: number };
const T = 'truck', A = 'anhuker', K = 'kaikran';
const PLANNED: Planned[] = [
  { key: 'a1', day: 0, boat: 'havbris', type: 'henting', kai: 'Kai 2', start: '07:30', end: '11:00', seller: 'kari', ans: 'per', arrived: 4,
    orders: [{ customer: 'Hessa Seafood', goods: [0] }, { customer: 'Vartdal Fisk', goods: [1] }],
    goods: [{ sku: S('Hav salt', 'pall', 'europall'), qty: 120, dir: 'ut' }, { sku: S('Sukker salt 1:2', 'pall', 'srs'), qty: 60, dir: 'ut' }],
    crew: [[T, 'lars'], [T, 'per'], [A, 'stian'], [K, 'morten']] },
  { key: 'a2', day: 0, boat: 'kystlast', type: 'levering', kai: 'Kai 1', start: '09:15', end: '12:30', seller: 'henrik', crane: true,
    goods: [{ sku: S('Hav salt', 'BB'), qty: 300, dir: 'inn' }], crew: [[T, 'ola']] },
  { key: 'a3', day: 0, boat: 'polarstrand', type: 'henting', kai: 'Kai 1', start: '11:45', end: '14:30', seller: 'kari',
    orders: [{ customer: 'Fjordlaks', goods: [1] }, { customer: 'Brødrene Sperre', goods: [0] }],
    goods: [{ sku: S('Blandet salt', 'BB'), qty: 80, dir: 'ut' }, { sku: S('Fint Rafinert salt', 'pall', 'europall'), qty: 40, dir: 'ut' }],
    crew: [[T, 'per'], [T, null], [A, 'anders'], [A, null], [K, 'morten']] },
  { key: 'a4', day: 0, boat: 'senja', type: 'levering', kai: 'Kai 2', start: '15:45', end: '19:00', seller: 'henrik', ans: 'lars',
    orders: [{ customer: 'Nordic Salt Trading', goods: [0] }, { customer: 'Nordic Salt Trading', goods: [1] }],
    goods: [{ sku: S('Marsel Hav salt', 'BB'), qty: 200, dir: 'inn' }, { sku: S('Nitrite', 'pall', 'srs'), qty: 20, dir: 'inn' }],
    crew: [[T, 'lars'], [A, 'stian'], [K, 'morten']] },
  { key: 'a5', day: 1, boat: 'nordkyn', type: 'henting', kai: 'Kai 1', start: '06:00', end: '09:00', seller: 'kari',
    goods: [{ sku: S('MG Kombi', 'BB'), qty: 150, dir: 'ut' }], crew: [[T, null], [T, null], [A, null], [K, null]] },
  { key: 'a6', day: 2, boat: 'lyngoy', type: 'levering', kai: 'Kai 2', start: '08:00', end: '11:00', seller: 'henrik',
    goods: [{ sku: S('Fint Rafinert salt', 'BB'), qty: 250, dir: 'inn' }], crew: [[T, null], [A, null]] },
  { key: 'a7', day: 2, boat: 'havbris', type: 'henting', kai: 'Kai 1', start: '13:00', end: '16:00', seller: 'kari',
    goods: [{ sku: S('Blandet salt', 'BB'), qty: 90, dir: 'ut' }], crew: [[T, null], [T, null], [A, null], [K, null]] },
  { key: 'a8', day: 5, boat: 'senja', type: 'levering', kai: 'Kai 2', start: '07:00', end: '10:00', seller: 'henrik',
    goods: [{ sku: S('Sukker', 'BB'), qty: 60, dir: 'inn' }], crew: [[T, null], [A, null], [K, null]] },
];
const plannedIds: Record<string, string> = { a0: explicitCallIds.fjordvik };
const plannedOrders: Record<string, { soId: string; so: string }[]> = {};
for (const p of PLANNED) {
  const callId = `pc_${p.key}`;
  plannedIds[p.key] = callId;
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  plannedOrders[p.key] = addCall({
    id: callId, boat: p.boat, type: p.type, quay: QUAY[p.kai], date: addDays(TODAY, p.day), start: toMin(p.start), end: toMin(p.end),
    seller: p.seller, crane: p.crane, responsible: p.ans ?? null, crew: p.crew, goods: p.goods, orders: p.orders,
    arrivedDelay: p.arrived ?? null, departed: false, completedAt: null, source: 'app',
    // Tidene er sjelden kjent mer enn et døgn frem.
    untimed: p.day >= 2,
  }).orders;
}

// Eksempler i endringsloggen: båt byttet i siste liten, ny ETA og endret vare.
const logAt = (offset: number, hm: string) => at(addDays(TODAY, offset), Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)));
const call = (boat: string, offset: number, hm: string | null, quay: string) =>
  ({ boat, eta: hm ? logAt(offset, hm) : at(addDays(TODAY, offset), 0), time_known: !!hm, quay });
const DEMO_LOG: [string, number, string, string, string, unknown][] = [
  ['a2', -1, '16:40', 'henrik', 'boat_changed', { from: 'MS Nordkyn', to: 'MS Kystlast' }],
  ['a2', 0, '06:55', 'henrik', 'eta_changed', { from: { eta: logAt(0, '08:55'), etd: logAt(0, '12:10'), time_known: true }, to: { eta: logAt(0, '09:15'), etd: logAt(0, '12:30'), time_known: true } }],
  ['a1', -1, '14:02', 'kari', 'line_changed', { from: '100 pall Hav salt · 25 kg × 40 · Europall', to: '120 pall Hav salt · 25 kg × 40 · Europall' }],
  ['a5', -1, '10:15', 'kari', 'moved', { from: call('Lyngøy', 2, null, 'Ytre'), to: call('MS Nordkyn', 1, '06:00', 'Ytre') }],
];
for (const [key, offset, hm, by, kind, data] of DEMO_LOG) {
  add('order_log', { sales_order_id: plannedOrders[key][0].soId, port_call_id: plannedIds[key], user_id: U(by), kind, data: JSON.stringify(data), at: logAt(offset, hm) });
}
// SO-er som venter på båt: registrert i Dynamics, båten er ikke kjent ennå.
for (const [customer, offset, goods, seller] of [
  ['Sunnmøre Sild', 3, [{ sku: S('Hav salt', 'BB'), qty: 180, dir: 'ut' }], 'kari'],
  ['Kystfisk AS', 6, [{ sku: S('Blandet salt', 'BB'), qty: 60, dir: 'ut' }, { sku: S('Hav salt', 'pall', 'europall'), qty: 40, dir: 'ut' }], 'henrik'],
] as [string, number, Goods[], string][]) {
  addOrder({ customer, seller, date: addDays(TODAY, offset), goods, callId: null, source: 'app', createdAt: logAt(-1, '13:30'), by: seller });
}

// ---------------------------------------------------------------- chat og varsler

const SHORT = Object.fromEntries(USERS.map(u => [u.short, u.key]));
const mentionRe = new RegExp(`@(${USERS.map(u => u.short.replace('.', '\\.')).join('|')})`, 'g');
const CHAT: [string, string | null, string, string][] = [
  ['a0', 'jonas', '06:58', 'Fjordvik er losset og har gått. Kaibok levert.'],
  ['a0', null, '07:04', 'Kaibok levert av Per H. · ingen avvik · 4,0 av 5. Anløpet er satt til Ferdig.'],
  ['a1', 'jonas', '07:12', 'Alle 180 paller står klar i sone B på kai 2 – Hav salt på Europall, Sukker salt 1:2 på SRS-pall.'],
  ['a1', 'ola', '07:20', 'Kran sjekket og klar. Starter lasting når de har fortøyd.'],
  ['a1', 'kari', '07:41', '@Jonas B. kunden spør om vi rekker avgang 11:00 – ser det greit ut?'],
  ['a1', 'jonas', '07:44', 'Ja, god margin.'],
  ['a2', 'henrik', '07:58', 'Agenten melder ETA 09:15, ca. 20 min senere enn plan. @Jonas B. rekker dere å starte lossing før lunsj?'],
  ['a2', 'jonas', '08:04', 'Ja. @Ola N. tar trucken fra kai 2 når Havbris er lastet.'],
  ['a2', 'ola', '08:06', 'Ok. Obs: båtkrana hadde trøbbel sist – vi legger egne stropper klare.'],
  ['a3', 'mari', '07:40', '@Kari S. Polarstrand kolliderer med Kystlast på kai 1. Kan kunden flytte til 13:00?'],
  ['a3', 'kari', '07:52', 'Spør agenten nå. Svar innen 09:00.'],
  ['a4', 'henrik', '07:30', 'Tollpapirer for Nitrite-pallene er sendt agenten.'],
];
const BOAT_OF: Record<string, string> = { a0: 'Fjordvik', ...Object.fromEntries(PLANNED.map(p => [p.key, BOATS.find(b => b.key === p.boat)!.name])) };
for (const [key, author, time, body] of CHAT) {
  const msgId = id('m');
  const createdAt = at(TODAY, Number(time.slice(0, 2)) * 60 + Number(time.slice(3)));
  add('messages', { id: msgId, port_call_id: plannedIds[key], author_id: author ? U(author) : null, kind: author ? 'user' : 'system', body, created_at: createdAt });
  for (const m of new Set([...body.matchAll(mentionRe)].map(x => SHORT[x[1]]))) {
    add('message_mentions', { message_id: msgId, user_id: U(m) });
    const who = USERS.find(u => u.key === author)!;
    add('notifications', { id: id('n'), user_id: U(m), kind: 'mention', port_call_id: plannedIds[key], message_id: msgId, text: `${who.short} nevnte deg · ${BOAT_OF[key]}`, created_at: createdAt, read_at: null });
  }
}

// ---------------------------------------------------------------- biler, bulkbil og produksjon

// Kundebiler som henter pall/BB – forventet dag, ikke klokkeslett.
const TRUCKS: [number, string, string | null, string | null, [string, 'BB' | 'pall', 'europall' | 'srs' | null, number][], boolean][] = [
  [-1, 'Brødrene Sperre', 'Tide Transport', 'SU 41 220', [['Hav salt', 'pall', 'europall', 22]], false],
  [0, 'Nergård Sjømat', 'Bring Cargo', 'ZT 88 103', [['Hav salt', 'BB', null, 24]], true],
  [0, 'Ålesund Fiskeindustri', 'Eget kjøretøy', null, [['Fint Rafinert salt', 'pall', 'europall', 10], ['Nitrite', 'pall', 'srs', 4]], false],
  [0, 'Vartdal Fisk', 'Tide Transport', null, [['Stein salt', 'BB', null, 26]], false],
  [1, 'Fjordlaks', 'PostNord', 'EL 12 908', [['Sukker salt 1:2', 'pall', 'europall', 18]], false],
  [1, 'Myklebust Sjømat', null, null, [['Blandet salt', 'BB', null, 28]], false],
  [2, 'Hessa Seafood', 'Bring Cargo', null, [['Hav salt', 'pall', 'srs', 20], ['Hav salt', 'BB', null, 6]], false],
  [4, 'Nergård Sjømat', 'Bring Cargo', null, [['Hav salt', 'BB', null, 24]], false],
  [7, 'Brødrene Sperre', 'Tide Transport', null, [['Marsel Hav salt', 'BB', null, 26]], false],
];
for (const [offset, customer, carrier, reg, goods, picked] of TRUCKS) {
  const tid = id('to');
  const date = addDays(TODAY, offset);
  add('truck_orders', {
    id: tid, customer, carrier, reg_no: reg, reference: String(int(40100, 40999)), expected_date: date, notes: null, created_by: U('kari'),
    picked_up_at: picked ? at(TODAY, 8 * 60 + 40) : null, picked_up_by: picked ? U('ola') : null, cancelled_at: null,
    created_at: at(addDays(TODAY, Math.min(offset, 0) - 3), 10 * 60),
  });
  goods.forEach(([p, unit, pallet, qty], i) => add('truck_order_goods', { id: id('tg'), order_id: tid, sku_id: S(p, unit, pallet).id, quantity: qty, sort: i }));
}

// Bulkbil: én ferdig i dag, én som venter og én bestilling for i ettermiddag.
const BULK: [string, string | null, string, 'bestilt' | 'ferdig', number, [string, number, 'bil' | 'henger' | null, number][]][] = [
  ['Bil 1 · SU 20 110', 'Vartdal Fisk', 'per', 'ferdig', 6 * 60 + 30, [['blandet', 16, 'henger', 120], ['havsalt', 12, 'bil', 0]]],
  ['Bil 2 · SU 20 144', 'Fjordlaks', 'lars', 'bestilt', 9 * 60 + 15, [['veisalt', 18, 'henger', 90], ['steinsalt', 14, 'bil', 0]]],
  ['Bil 1 · SU 20 110', 'Hessa Seafood', 'per', 'bestilt', 9 * 60 + 40, [['havsalt', 28, null, 0]]],
];
for (const [truck, dest, driver, status, minute, steps] of BULK) {
  const bid = id('bo');
  const created = at(TODAY, minute);
  const done = status === 'ferdig';
  add('bulk_orders', {
    id: bid, truck, destination: dest, driver_id: U(driver), status, expected_at: null, notes: null, version: 1, created_at: created,
    started_at: done ? plusMin(created, 10) : null, finished_at: done ? plusMin(created, 40) : null,
  });
  steps.forEach(([q, t, target, pause], i) => add('bulk_order_steps', {
    id: id('bs'), order_id: bid, seq: i + 1, quality_id: q, tonnes: t, target, pause_after_sec: i === steps.length - 1 ? 0 : pause,
    started_at: done ? plusMin(created, 10 + i * 15) : null, finished_at: done ? plusMin(created, 20 + i * 15) : null,
  }));
}

// Produksjon: linje 1 pakker Hav salt, linje 2 Stein salt; neste ordre er et kvalitetsbytte.
const PROD: [string, string, number, 'ferdig' | 'pakker' | 'planlagt', number | null, number[]][] = [
  ['linje1', 'Hav salt', 40, 'ferdig', 6 * 60, []],
  ['linje1', 'Hav salt', 120, 'pakker', 10 * 60, [30, 20]],
  ['linje1', 'Blandet salt', 60, 'planlagt', null, []],
  ['linje2', 'Stein salt', 50, 'pakker', 11 * 60, [30]],
  ['linje2', 'Fint Rafinert salt', 30, 'planlagt', null, []],
  ['linje2', 'Stein salt', 40, 'planlagt', null, []],
];
PROD.forEach(([line, product, tonnes, status, start, fills], i) => {
  const pid = id('po');
  const started = start == null ? null : at(TODAY, start);
  add('production_orders', {
    id: pid, line_id: line, product_id: P(product), tonnes, status, sort: i + 1, notes: null, created_by: U('mari'),
    created_at: at(addDays(TODAY, -1), 14 * 60), started_at: started, finished_at: status === 'ferdig' && started ? plusMin(started, (tonnes / 10) * 60) : null,
  });
  fills.forEach((t, n) => add('silo_fills', {
    id: id('sf'), line_id: line, production_order_id: pid, product_id: P(product), tonnes: t, filled_by: U('jonas'), filled_at: plusMin(started!, n * 90 - 10),
  }));
});

// ---------------------------------------------------------------- skriv SQL

const CLEAR = [
  // Kvaliteter (bulk_qualities) og pakkelinjer (packing_lines) er faste rader fra migrasjonen og beholdes.
  'bulk_order_steps', 'bulk_orders', 'silo_fills', 'production_orders', 'truck_order_goods', 'truck_orders',
  'boat_photos', 'ais_area', 'audit_log', 'ais_track', 'ais_positions', 'quay_log_photos', 'quay_log_categories', 'quay_logs', 'notifications',
  'message_mentions', 'messages', 'crew_slots', 'order_log', 'port_call_orders', 'order_lines', 'sales_orders', 'port_calls', 'quays', 'skus', 'products', 'boats',
  'agents', 'settings', 'shifts', 'crew_skills', 'user_roles', 'users',
];
const lines: string[] = [
  `-- Generert av seed/generate.ts for ${TODAY}. Ikke rediger for hånd.`,
  '-- ADVARSEL: tømmer alle tabeller først.',
  ...CLEAR.map(t => `DELETE FROM ${t};`),
];
for (const table of order) {
  const rows = tables[table];
  const cols = Object.keys(rows[0]);
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    lines.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES\n${chunk.map(r => `  (${cols.map(c => sqlValue(r[c])).join(', ')})`).join(',\n')};`);
  }
}
lines.push(importCompleted);
// Snitt og siste kaibok per båt, regnet fra kaibøkene.
lines.push(`UPDATE boats SET
  rating_count = s.n, avg_punctuality = s.p, avg_cooperation = s.c, avg_equipment = s.e,
  avg_total = (s.p + s.c + s.e) / 3.0, last_log_at = s.last
FROM (
  SELECT pc.boat_id, count(*) AS n, avg(ql.r_punctuality) AS p, avg(ql.r_cooperation) AS c, avg(ql.r_equipment) AS e, max(ql.delivered_at) AS last
  FROM quay_logs ql JOIN port_calls pc ON pc.id = ql.port_call_id GROUP BY pc.boat_id
) AS s WHERE boats.id = s.boat_id;`);
process.stdout.write(lines.join('\n') + '\n');
