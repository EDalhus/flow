import { exports } from 'cloudflare:workers';

// Liten, fast testverden. Testene bruker datoer i 2030 (og 2029 for rapporter),
// og hver test sin egen dag, så de ikke kolliderer med hverandre.

export async function loadFixtures(db: D1Database) {
  const users: [string, string, string, string[], string[]][] = [
    ['jonas', 'Jonas Berg', 'Jonas B.', ['produksjon', 'kaiarbeider'], ['truck', 'anhuker']],
    ['ola', 'Ola Nygård', 'Ola N.', ['kaiarbeider'], ['truck']],
    ['per', 'Per Hansen', 'Per H.', ['kaiarbeider'], ['truck']],
    ['stian', 'Stian Myklebust', 'Stian M.', ['kaiarbeider'], ['anhuker']],
    ['morten', 'Morten Rønneberg', 'Morten R.', ['kaiarbeider'], ['kaikran']],
    ['kari', 'Kari Sæther', 'Kari S.', ['salg'], []],
    ['admin', 'Ada Admin', 'Ada A.', ['admin'], []],
  ];
  await db.batch([
    ...users.flatMap(([k, name, short, roles, skills]) => [
      db.prepare('INSERT OR IGNORE INTO users (id, email, name, short_name, initials) VALUES (?, ?, ?, ?, ?)')
        .bind(`u_${k}`, `${k}@flow.example`, name, short, short.replace(/[^A-ZÆØÅ]/g, '')),
      ...roles.map(r => db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)').bind(`u_${k}`, r)),
      ...skills.map(s => db.prepare('INSERT OR IGNORE INTO crew_skills (user_id, crew_role) VALUES (?, ?)').bind(`u_${k}`, s)),
    ]),
    db.prepare(`INSERT OR IGNORE INTO quays (id, name, company, sort) VALUES ('q_kai1', 'Kai 1', NULL, 1), ('q_kai2', 'Kai 2', NULL, 2)`),
    db.prepare(`INSERT OR IGNORE INTO boats (id, name) VALUES ('b_a', 'Alfa'), ('b_b', 'Bravo'), ('b_c', 'Charlie'), ('b_d', 'Delta')`),
    db.prepare(`INSERT OR IGNORE INTO products (id, name, sort) VALUES ('p_hav', 'Hav salt', 1), ('p_stein', 'Stein salt', 2)`),
    db.prepare(`INSERT OR IGNORE INTO skus (id, product_id, unit, bags_per_unit, bag_kg, pallet_type, kg_per_unit) VALUES
      ('s_hav_bb', 'p_hav', 'BB', NULL, NULL, NULL, 1000),
      ('s_hav_eur', 'p_hav', 'pall', 40, 25, 'europall', 1000),
      ('s_stein_bb', 'p_stein', 'BB', NULL, NULL, NULL, 1000),
      ('s_hav_bulk', 'p_hav', 'bulk', NULL, NULL, NULL, 1000)`),
  ]);
}

export type ApiResult<T = any> = { status: number; json: T };

/** Kall API-et som en gitt testbruker (nøkkel fra fixtures, eller full e-post). */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; as?: string } = {}): Promise<ApiResult<T>> {
  const as = opts.as ?? 'jonas';
  const res = await exports.default.fetch(
    new Request(`http://flow.test/api${path}`, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', 'X-Dev-User': as.includes('@') ? as : `${as}@flow.example` },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
  );
  return { status: res.status, json: (await res.json()) as T };
}

/** ISO-tid for lokal klokke en gitt dato (vintertid, UTC+1, i mars 2030). */
export const at = (date: string, hm: string) => new Date(`${date}T${hm}:00+01:00`).toISOString();

export function call(date: string, from: string, to: string, extra: Record<string, unknown> = {}) {
  return {
    boat_id: 'b_a', type: 'levering', quay_id: 'q_kai1', eta: at(date, from), etd: at(date, to), crew: [], ...extra,
  };
}

let so = 0;
/** Unikt SO-nummer for testene: 20 + fem siffer. */
export const soNumber = () => `20${String(10000 + (so++ * 37) % 90000).padStart(5, '0')}`;

/** Setter inn varer direkte i databasen (én SO per anløp), for tester som lager anløp med SQL. */
export function goodsSql(db: D1Database, rows: [id: string, callId: string, sku: string, qty: number, dir: 'inn' | 'ut'][]) {
  const calls = [...new Set(rows.map(r => r[1]))];
  return [
    ...calls.map(c => db.prepare(`INSERT INTO sales_orders (id, so_number, customer, source) VALUES (?, ?, 'Testkunde', 'import')`).bind(`so_${c}`, soNumber())),
    ...rows.map(([id, c, sku, qty, dir]) => db.prepare(`INSERT INTO order_lines (id, sales_order_id, port_call_id, sku_id, quantity, direction) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, `so_${c}`, c, sku, qty, dir)),
    ...calls.map(c => db.prepare(`INSERT INTO port_call_orders (port_call_id, sales_order_id) VALUES (?, ?)`).bind(c, `so_${c}`)),
  ];
}
