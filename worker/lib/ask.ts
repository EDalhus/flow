import { z } from 'zod';
import type { BulkGroup, Lang } from '../../shared/api.ts';
import { addDays, osloToUtc, todayOslo } from '../../shared/time.ts';
import { fetchAllLatest, matchVessels } from '../ais/barentswatch.ts';
import { bulkReport } from '../db/bulk.ts';
import { loadOrders } from '../db/orders.ts';
import { loadSettings } from './settings.ts';

// «Spør Flow»: spørsmål med vanlige ord i søkefeltet besvares av Claude (Anthropic API).
// Modellen får ingen direkte tilgang til databasen, bare faste verktøy som leser (aldri endrer) data.
// Den velger verktøy og periode, Flow kjører spørringene, og modellen skriver svaret med tall og lenker.

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
const MAX_ROUNDS = 6;

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const LANG_NAME: Record<Lang, string> = { nb: 'norsk bokmål', en: 'English', lt: 'lietuvių (Lithuanian)', da: 'dansk', sv: 'svenska', is: 'íslenska' };

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const period = { from: date, to: date };

/** Maks tre år per spørring, og til-dato etter fra-dato. */
function checkPeriod(p: { from: string; to: string }) {
  if (p.to < p.from) throw new Error('to må være etter from');
  if (Date.parse(p.to) - Date.parse(p.from) > 3 * 366 * 86_400_000) throw new Error('perioden kan være maks tre år');
}

const r1 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10);
const r2 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);
const cut = (s: string | null, n = 160) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

/** Avstand i nautiske mil mellom to punkter. */
function nm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(h));
}

interface Tool<S extends z.ZodType> {
  description: string;
  input: S;
  /** JSON Schema til modellen (skrevet for hånd, kort og tydelig). */
  schema: Record<string, unknown>;
  run: (env: Env, input: z.infer<S>) => Promise<unknown>;
}
const tool = <S extends z.ZodType>(t: Tool<S>) => t;
const dateProp = (d: string) => ({ type: 'string', description: `${d} (YYYY-MM-DD)` });
const periodProps = { from: dateProp('Fra og med dato'), to: dateProp('Til og med dato') };

export const TOOLS = {
  bat_kvalitet: tool({
    description: 'Kvalitet per båt fra kaibøkene i en periode: antall anløp, kaibøker, avvik, avvik per kategori (skade_gods, utstyr_kran, mannskap_hms, forsinkelse, annet), snittkarakterer 1–5 (punktlighet, samarbeid, utstyr), flagg og eksempler på avviksbeskrivelser. Sortert med flest avvik først. Bruk til «hvilken båt har vi oftest problemer med», «beste båt», «punktlighet».',
    input: z.object({ ...period, limit: z.number().int().min(1).max(30).default(10) }),
    schema: { type: 'object', properties: { ...periodProps, limit: { type: 'integer', description: 'Antall båter (standard 10)' } }, required: ['from', 'to'] },
    run: async (env, i) => {
      checkPeriod(i);
      const db = env.DB;
      const { results } = await db.prepare(`
        SELECT b.id, b.name, coalesce(b.flag_override, b.flag_auto) AS flag, coalesce(b.flag_override_reason, b.flag_auto_reason) AS flag_reason,
               count(DISTINCT pc.id) AS calls, count(ql.id) AS quay_logs, coalesce(sum(ql.had_deviation), 0) AS deviations,
               avg(ql.r_punctuality) AS punctuality, avg(ql.r_cooperation) AS cooperation, avg(ql.r_equipment) AS equipment
        FROM boats b JOIN port_calls pc ON pc.boat_id = b.id AND pc.cancelled_at IS NULL AND pc.service_date BETWEEN ? AND ?
        LEFT JOIN quay_logs ql ON ql.port_call_id = pc.id
        GROUP BY b.id
        ORDER BY deviations DESC, (coalesce(avg(ql.r_punctuality), 5) + coalesce(avg(ql.r_cooperation), 5) + coalesce(avg(ql.r_equipment), 5)) ASC, calls DESC
        LIMIT ?`).bind(i.from, i.to, i.limit).all<Record<string, number | string | null>>();
      const ids = results.map(r => r.id as string);
      const [cats, notes] = ids.length ? await db.batch([
        db.prepare(`SELECT pc.boat_id, qc.category, count(*) AS n FROM quay_log_categories qc JOIN quay_logs ql ON ql.id = qc.quay_log_id
                    JOIN port_calls pc ON pc.id = ql.port_call_id
                    WHERE pc.boat_id IN (SELECT value FROM json_each(?)) AND pc.service_date BETWEEN ? AND ? GROUP BY 1, 2`).bind(JSON.stringify(ids), i.from, i.to),
        db.prepare(`SELECT pc.boat_id, pc.service_date, ql.description FROM quay_logs ql JOIN port_calls pc ON pc.id = ql.port_call_id
                    WHERE ql.had_deviation = 1 AND ql.description IS NOT NULL AND pc.boat_id IN (SELECT value FROM json_each(?)) AND pc.service_date BETWEEN ? AND ?
                    ORDER BY pc.service_date DESC`).bind(JSON.stringify(ids), i.from, i.to),
      ]) : [{ results: [] }, { results: [] }];
      return {
        periode: i, merknad: 'Importert historikk har ikke kaibok; bare anløp registrert i Flow har avvik og karakterer.',
        bater: results.map(r => ({
          navn: r.name, link: `/baater?id=${r.id}`, flagg: r.flag, flagg_grunn: r.flag_reason, anlop: r.calls, kaiboker: r.quay_logs, avvik: r.deviations,
          avvik_per_kategori: Object.fromEntries((cats.results as { boat_id: string; category: string; n: number }[]).filter(c => c.boat_id === r.id).map(c => [c.category, c.n])),
          snitt: { punktlighet: r2(r.punctuality as number | null), samarbeid: r2(r.cooperation as number | null), utstyr: r2(r.equipment as number | null) },
          eksempler: (notes.results as { boat_id: string; service_date: string; description: string }[]).filter(n => n.boat_id === r.id).slice(0, 3)
            .map(n => `${n.service_date}: ${cut(n.description)}`),
        })),
      };
    },
  }),

  salg: tool({
    description: 'Solgt/levert mengde (tonn og antall enheter BB/pall) i en periode, gruppert per produkt, kunde, båt eller måned. Kanal «bat» = ferdige anløp (salgsordre), «bil» = hentede bilordrer. Retning «ut» = salg/utlevert, «inn» = mottatt. Bruk til «mest populære produkt», «største kunder», «hvor mye solgte vi».',
    input: z.object({ ...period, group_by: z.enum(['produkt', 'kunde', 'bat', 'maned']).default('produkt'), retning: z.enum(['ut', 'inn', 'alle']).default('ut'), kanal: z.enum(['bat', 'bil', 'alle']).default('alle') }),
    schema: {
      type: 'object', required: ['from', 'to'],
      properties: {
        ...periodProps, group_by: { type: 'string', enum: ['produkt', 'kunde', 'bat', 'maned'] },
        retning: { type: 'string', enum: ['ut', 'inn', 'alle'], description: 'Standard ut (salg)' }, kanal: { type: 'string', enum: ['bat', 'bil', 'alle'], description: 'Standard alle' },
      },
    },
    run: async (env, i) => {
      checkPeriod(i);
      const db = env.DB;
      const key = { produkt: 'p.name', kunde: "coalesce(so.customer, 'Ukjent kunde')", bat: 'b.name', maned: 'substr(pc.service_date, 1, 7)' }[i.group_by];
      const truckKey = { produkt: 'p.name', kunde: 't.customer', bat: "'Bilhenting'", maned: 'substr(t.expected_date, 1, 7)' }[i.group_by];
      const rows: { label: string; tonnes: number; units: number; orders: number }[] = [];
      if (i.kanal !== 'bil') {
        const { results } = await db.prepare(`
          SELECT ${key} AS label, sum(g.quantity * s.kg_per_unit) / 1000.0 AS tonnes, sum(g.quantity) AS units, count(DISTINCT pc.id) AS orders
          FROM port_call_goods g JOIN port_calls pc ON pc.id = g.port_call_id JOIN skus s ON s.id = g.sku_id JOIN products p ON p.id = s.product_id
          JOIN boats b ON b.id = pc.boat_id LEFT JOIN sales_orders so ON so.id = g.sales_order_id
          WHERE pc.completed_at IS NOT NULL AND pc.cancelled_at IS NULL AND pc.service_date BETWEEN ? AND ? ${i.retning === 'alle' ? '' : 'AND g.direction = ?'}
          GROUP BY 1`).bind(...[i.from, i.to, ...(i.retning === 'alle' ? [] : [i.retning])]).all<typeof rows[number]>();
        rows.push(...results);
      }
      if (i.kanal !== 'bat' && i.retning !== 'inn') {
        const { results } = await db.prepare(`
          SELECT ${truckKey} AS label, sum(tg.quantity * s.kg_per_unit) / 1000.0 AS tonnes, sum(tg.quantity) AS units, count(DISTINCT t.id) AS orders
          FROM truck_order_goods tg JOIN truck_orders t ON t.id = tg.order_id JOIN skus s ON s.id = tg.sku_id JOIN products p ON p.id = s.product_id
          WHERE t.picked_up_at IS NOT NULL AND t.cancelled_at IS NULL AND t.expected_date BETWEEN ? AND ? GROUP BY 1`).bind(i.from, i.to).all<typeof rows[number]>();
        rows.push(...results);
      }
      const merged = new Map<string, { label: string; tonnes: number; units: number; orders: number }>();
      for (const r of rows) {
        const m = merged.get(r.label) ?? { label: r.label, tonnes: 0, units: 0, orders: 0 };
        m.tonnes += r.tonnes; m.units += r.units; m.orders += r.orders;
        merged.set(r.label, m);
      }
      const list = [...merged.values()].sort((a, b) => (i.group_by === 'maned' ? a.label.localeCompare(b.label) : b.tonnes - a.tonnes));
      const total = list.reduce((t, r) => t + r.tonnes, 0);
      return {
        periode: i, gruppert_per: i.group_by, retning: i.retning, kanal: i.kanal, sum_tonn: r1(total),
        rader: list.slice(0, 40).map(r => ({ [i.group_by]: r.label, tonn: r1(r.tonnes), enheter: r.units, anlop_eller_ordrer: r.orders, andel_prosent: total ? r1((r.tonnes / total) * 100) : 0 })),
        merknad: 'Bulksalt til bil (Bulkbil) er ikke med her; bruk verktøyet bulk.',
      };
    },
  }),

  bulk: tool({
    description: 'Bulksalt lastet på bil (sjåførene laster selv) i en periode: lastinger, bestilt og veid tonn og snitt lastetid, gruppert per kvalitet (havsalt, steinsalt, blandet, veisalt), kunde, bil, sjåfør, transportør, prosjekt eller dag.',
    input: z.object({ ...period, group: z.enum(['kvalitet', 'kunde', 'bil', 'sjafor', 'transportor', 'prosjekt', 'dag']).default('kvalitet') }),
    schema: { type: 'object', required: ['from', 'to'], properties: { ...periodProps, group: { type: 'string', enum: ['kvalitet', 'kunde', 'bil', 'sjafor', 'transportor', 'prosjekt', 'dag'] } } },
    run: async (env, i) => {
      checkPeriod(i);
      const r = await bulkReport(env.DB, i.from, i.to, i.group as BulkGroup);
      return { periode: i, link: '/bulk?vis=rapport', sum: r.total, rader: r.rows.slice(0, 40).map(x => ({ [i.group]: x.label, lastinger: x.loads, bestilt_tonn: x.ordered, veid_tonn: x.weighed, snitt_lastetid_min: x.minutes_avg })) };
    },
  }),

  anlop: tool({
    description: 'Anløp (båter til kaia) i en periode, eventuelt for én båt: dato, ETA/ETD, levering/henting, kai, status, SO-numre og tonn. Maks 60 rader. Bruk til «når kommer X», «hvor mange anløp», «neste båt», «hvem ligger ved kai».',
    input: z.object({ ...period, bat: z.string().max(60).optional() }),
    schema: { type: 'object', required: ['from', 'to'], properties: { ...periodProps, bat: { type: 'string', description: 'Del av båtnavnet (valgfritt)' } } },
    run: async (env, i) => {
      checkPeriod(i);
      const like = i.bat ? `%${i.bat.replace(/[%_]/g, '')}%` : '%';
      const { results } = await env.DB.prepare(`
        SELECT pc.id, b.id AS boat_id, b.name AS boat, pc.service_date, pc.eta, pc.etd, pc.time_known, pc.type, q.name AS quay, pc.arrived_at, pc.departed_at,
               pc.completed_at, pc.cancelled_at,
               (SELECT group_concat(so.so_number, ', ') FROM port_call_orders pco JOIN sales_orders so ON so.id = pco.sales_order_id WHERE pco.port_call_id = pc.id) AS so,
               (SELECT sum(g.quantity * s.kg_per_unit) / 1000.0 FROM port_call_goods g JOIN skus s ON s.id = g.sku_id WHERE g.port_call_id = pc.id) AS tonnes
        FROM port_calls pc JOIN boats b ON b.id = pc.boat_id JOIN quays q ON q.id = pc.quay_id
        WHERE pc.service_date BETWEEN ? AND ? AND b.name LIKE ?
        ORDER BY pc.eta LIMIT 61`).bind(i.from, i.to, like).all<Record<string, string | number | null>>();
      const status = (r: Record<string, unknown>) => (r.cancelled_at ? 'kansellert' : r.completed_at ? 'ferdig' : r.departed_at ? 'gått fra kai' : r.arrived_at ? 'ved kai' : 'planlagt');
      return {
        periode: i, flere_enn_60: results.length > 60,
        anlop: results.slice(0, 60).map(r => ({
          bat: r.boat, link: `/baater?id=${r.boat_id}`, dato: r.service_date, eta: r.time_known ? r.eta : null, etd: r.time_known ? r.etd : null,
          type: r.type, kai: r.quay, status: status(r), so: r.so, tonn: r1(r.tonnes as number | null),
        })),
      };
    },
  }),

  status_na: tool({
    description: 'Status akkurat nå: båter i geofencen ved kaia (AIS), de neste anløpene, dagens bilhentinger og bulkkøen. Bruk til «hvem ligger ved kai», «hva skjer i dag», «neste båt».',
    input: z.object({}),
    schema: { type: 'object', properties: {} },
    run: async env => {
      const db = env.DB;
      const today = todayOslo();
      const now = new Date().toISOString();
      const [atQuay, next, trucks, bulk] = await db.batch([
        db.prepare(`SELECT b.id, b.name, a.sog, a.ais_ts FROM ais_positions a JOIN boats b ON b.id = a.boat_id WHERE a.in_geofence = 1`),
        db.prepare(`SELECT b.id, b.name, pc.eta, pc.type, q.name AS quay, pc.arrived_at FROM port_calls pc JOIN boats b ON b.id = pc.boat_id JOIN quays q ON q.id = pc.quay_id
                    WHERE pc.cancelled_at IS NULL AND pc.completed_at IS NULL AND pc.departed_at IS NULL AND pc.etd >= ? ORDER BY pc.eta LIMIT 6`).bind(now),
        db.prepare(`SELECT customer, reg_no, so_number, picked_up_at IS NOT NULL AS picked FROM truck_orders WHERE cancelled_at IS NULL AND expected_date = ?`).bind(today),
        db.prepare(`SELECT o.status, count(*) AS n, sum((SELECT sum(tonnes) FROM bulk_order_steps s WHERE s.order_id = o.id)) AS tonnes FROM bulk_orders o
                    WHERE o.status IN ('bestilt', 'lastes') OR o.finished_at >= ? GROUP BY o.status`).bind(osloToUtc(today, 0)),
      ]);
      return {
        na: now, i_dag: today,
        ved_kaia_ais: (atQuay.results as { id: string; name: string; sog: number | null; ais_ts: string }[]).map(b => ({ bat: b.name, link: `/baater?id=${b.id}`, fart_knop: b.sog, sist_sett: b.ais_ts })),
        neste_anlop: (next.results as Record<string, string>[]).map(c => ({ bat: c.name, link: `/baater?id=${c.id}`, eta: c.eta, type: c.type, kai: c.quay, ankommet: c.arrived_at })),
        bilhentinger_i_dag: { link: '/biler', ordrer: trucks.results },
        bulk_i_dag: { link: '/bulk', per_status: bulk.results },
      };
    },
  }),

  bat_info: tool({
    description: 'Alt om én båt: profil (agent, kontakt, telefon), flagg, snittkarakterer, siste og neste anløp, og posisjon fra AIS med avstand til kaia. Finner også båter som ikke er i båtregisteret via AIS. Bruk til «hvor er X», «hvem er agent for X», «når var X her sist».',
    input: z.object({ navn: z.string().min(2).max(60) }),
    schema: { type: 'object', required: ['navn'], properties: { navn: { type: 'string', description: 'Båtnavn, MMSI eller IMO' } } },
    run: async (env, i) => {
      const db = env.DB;
      const like = `%${i.navn.replace(/^(ms|mv|m\/s)\s+/i, '').replace(/[%_]/g, '')}%`;
      const boat = await db.prepare(`
        SELECT b.*, a.name AS agent_name, a.phone AS agent_phone, p.lat, p.lon, p.sog, p.cog, p.ais_ts, p.in_geofence
        FROM boats b LEFT JOIN agents a ON a.id = b.agent_id LEFT JOIN ais_positions p ON p.boat_id = b.id
        WHERE b.name LIKE ?1 OR b.mmsi = ?2 OR b.imo = ?2 ORDER BY b.active DESC, length(b.name) LIMIT 1`).bind(like, i.navn.trim()).first<Record<string, string | number | null>>();
      const { geofence } = await loadSettings(db);
      const pos = (lat: number | null, lon: number | null, extra: Record<string, unknown>) =>
        lat == null || lon == null ? null : { lat: Math.round(lat * 10000) / 10000, lon: Math.round(lon * 10000) / 10000, avstand_til_kaia_nm: r1(nm({ lat, lon }, geofence)), ...extra };
      if (!boat) {
        if (!env.BW_CLIENT_ID || !env.BW_CLIENT_SECRET) return { funnet: false, merknad: 'Ikke i båtregisteret, og AIS-søk er ikke satt opp.' };
        const v = matchVessels(await fetchAllLatest({ clientId: env.BW_CLIENT_ID, clientSecret: env.BW_CLIENT_SECRET }), i.navn, 3);
        return {
          funnet: v.length > 0, i_batregisteret: false,
          ais: v.map(x => ({ navn: x.name, mmsi: x.mmsi, type: x.shipType, destinasjon: x.destination, fart_knop: x.speedOverGround,
            posisjon: pos(x.latitude ?? null, x.longitude ?? null, { sist_sett: x.msgtime }),
            link: x.latitude != null ? `/?lat=${x.latitude}&lon=${x.longitude}&mmsi=${x.mmsi}&name=${encodeURIComponent(x.name ?? '')}` : null })),
        };
      }
      const today = todayOslo();
      const [last, next] = await db.batch([
        db.prepare(`SELECT service_date, type, completed_at IS NOT NULL AS done FROM port_calls WHERE boat_id = ? AND cancelled_at IS NULL AND service_date <= ? ORDER BY eta DESC LIMIT 5`).bind(boat.id, today),
        db.prepare(`SELECT service_date, eta, type FROM port_calls WHERE boat_id = ? AND cancelled_at IS NULL AND completed_at IS NULL AND service_date >= ? ORDER BY eta LIMIT 3`).bind(boat.id, today),
      ]);
      return {
        funnet: true, i_batregisteret: true, navn: boat.name, link: `/baater?id=${boat.id}`, mmsi: boat.mmsi, imo: boat.imo, kallesignal: boat.callsign,
        agent: boat.agent_name ? { navn: boat.agent_name, telefon: boat.agent_phone } : null, kontakt_om_bord: boat.ship_contact, telefon_om_bord: boat.ship_phone,
        merknad: boat.note, flagg: boat.flag_override ?? boat.flag_auto, flagg_grunn: boat.flag_override_reason ?? boat.flag_auto_reason,
        kaiboker: boat.rating_count, snitt: { punktlighet: r2(boat.avg_punctuality as number), samarbeid: r2(boat.avg_cooperation as number), utstyr: r2(boat.avg_equipment as number) },
        siste_anlop: last.results, neste_anlop: next.results,
        posisjon: pos(boat.lat as number | null, boat.lon as number | null, { fart_knop: boat.sog, kurs: boat.cog, sist_sett: boat.ais_ts, i_geofencen_ved_kaia: !!boat.in_geofence }),
      };
    },
  }),

  salgsordre: tool({
    description: 'Salgsordrer (SO fra Dynamics 365): søk på SO-nummer eller kunde, eller alle med ønsket dag i en periode. Viser varer, tonn, status og båt. Maks 20.',
    input: z.object({ so_nummer: z.string().max(7).optional(), kunde: z.string().max(60).optional(), from: date.optional(), to: date.optional() }),
    schema: { type: 'object', properties: { so_nummer: { type: 'string' }, kunde: { type: 'string', description: 'Del av kundenavnet' }, from: dateProp('Ønsket dag fra'), to: dateProp('Ønsket dag til') } },
    run: async (env, i) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (i.so_nummer) { where.push('so_number LIKE ?'); params.push(`%${i.so_nummer.replace(/\D/g, '')}%`); }
      if (i.kunde) { where.push('customer LIKE ?'); params.push(`%${i.kunde.replace(/[%_]/g, '')}%`); }
      if (i.from) { where.push('wanted_date >= ?'); params.push(i.from); }
      if (i.to) { where.push('wanted_date <= ?'); params.push(i.to); }
      const { results } = await env.DB.prepare(`SELECT id FROM sales_orders WHERE source = 'app' ${where.length ? `AND ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 20`)
        .bind(...params).all<{ id: string }>();
      const orders = await loadOrders(env.DB, { ids: results.map(r => r.id) });
      return {
        ordrer: orders.map(o => ({
          so: o.so_number, link: `/anlop?so=${o.so_number}`, kunde: o.customer, status: o.status, onsket_dag: o.wanted_date, tonn: r1(o.tonnes), kansellert: !!o.cancelled_at,
          bat: o.calls.map(c => `${c.boat_name} ${c.service_date}`).join(', ') || null,
          varer: o.lines.map(l => `${l.quantity} ${l.unit} ${l.product_name}`),
        })),
      };
    },
  }),

  bilhentinger: tool({
    description: 'Bilhentinger (kundebiler som henter pall/BB) i en periode, eventuelt for én kunde: forventet dag, SO, reg.nr., transportør, varer og om de er hentet. Maks 60.',
    input: z.object({ ...period, kunde: z.string().max(60).optional() }),
    schema: { type: 'object', required: ['from', 'to'], properties: { ...periodProps, kunde: { type: 'string' } } },
    run: async (env, i) => {
      checkPeriod(i);
      const db = env.DB;
      const like = i.kunde ? `%${i.kunde.replace(/[%_]/g, '')}%` : '%';
      const { results } = await db.prepare(`
        SELECT t.id, t.customer, t.carrier, t.reg_no, t.so_number, t.expected_date, t.picked_up_at,
               (SELECT group_concat(g.quantity || ' ' || s.unit || ' ' || p.name, ', ') FROM truck_order_goods g JOIN skus s ON s.id = g.sku_id JOIN products p ON p.id = s.product_id WHERE g.order_id = t.id) AS goods,
               (SELECT sum(g.quantity * s.kg_per_unit) / 1000.0 FROM truck_order_goods g JOIN skus s ON s.id = g.sku_id WHERE g.order_id = t.id) AS tonnes
        FROM truck_orders t WHERE t.cancelled_at IS NULL AND t.expected_date BETWEEN ? AND ? AND t.customer LIKE ? ORDER BY t.expected_date LIMIT 60`)
        .bind(i.from, i.to, like).all<Record<string, string | number | null>>();
      return { periode: i, link: '/biler', ordrer: results.map(t => ({ kunde: t.customer, dag: t.expected_date, so: t.so_number, reg_nr: t.reg_no, transportor: t.carrier, varer: t.goods, tonn: r1(t.tonnes as number), hentet: !!t.picked_up_at })) };
    },
  }),
};
export type ToolName = keyof typeof TOOLS;

export async function runTool(env: Env, name: string, input: unknown): Promise<unknown> {
  const t = TOOLS[name as ToolName] as Tool<z.ZodType> | undefined;
  if (!t) return { feil: `Ukjent verktøy ${name}` };
  const parsed = t.input.safeParse(input ?? {});
  if (!parsed.success) return { feil: 'Ugyldige parametere', detaljer: parsed.error.issues.map(x => `${x.path.join('.')}: ${x.message}`) };
  try {
    return await t.run(env, parsed.data);
  } catch (e) {
    return { feil: e instanceof Error ? e.message : 'Verktøyet feilet' };
  }
}

function systemPrompt(lang: Lang, userName: string) {
  const today = todayOslo();
  return `Du er «Spør Flow», assistenten i Flow – kai- og logistikksystemet til Flatholmen havn 81B i Ålesund (salt: havsalt, steinsalt, blandet salt, veisalt m.m., levert med båt, kundebil og bulkbil).
I dag er ${today} (Europe/Oslo). Brukeren heter ${userName}.

Regler:
- Svar på ${LANG_NAME[lang]}, kort og konkret. Ikke gjenta spørsmålet.
- Format (markdown): Start med én setning som svarer direkte (konklusjonen, med det viktigste tallet). Deretter en punktliste («- ») med 2–5 punkter, hvert punkt kort og gjerne med en **fet etikett:** først. Ved rangering: nummerert liste («1. »). Avslutt eventuelt med én kort setning om forbehold. Ingen tabeller, ingen overskrifter med #, ingen lange avsnitt.
- Skriv navn på båter, kunder og produkter slik de står i dataene (f.eks. Polarstrand, ikke POLARSTRAND).
- Bruk bare tall fra verktøyene. Finn aldri på tall, båter, kunder eller datoer. Mangler data, si det.
- Når brukeren ikke sier periode: bruk siste 12 måneder for statistikk (${addDays(today, -365)} til ${today}), og si hvilken periode tallene gjelder.
- «Problemer» med en båt = avvik i kaibøkene og lave karakterer. «Populært produkt» = flest tonn solgt (retning ut).
- Lenk til det du nevner med markdown-lenker, og bare med stier som står i «link» i verktøyresultatene, f.eks. [Coneste](/baater?id=…). Lenk hvert navn bare første gang, og ikke legg lenker inne i **fet** tekst.
- Tall: bruk norsk/europeisk format med komma som desimaltegn når du svarer på norsk, og enheten (t, tonn, kn, nm).
- Du kan bare lese. Ber brukeren om å endre noe, forklar kort hvor i Flow det gjøres.`;
}

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };
export interface AskResult { answer: string; tools: string[]; model: string }

/** Spør Claude, med verktøyene over, til modellen har et svar (maks seks runder). */
export async function ask(env: Env, question: string, lang: Lang, userName: string, fetcher: Fetcher = fetch): Promise<AskResult> {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new AskError(503, 'Spør Flow er ikke satt opp (ANTHROPIC_API_KEY mangler).');
  const model = env.AI_MODEL?.trim() || DEFAULT_MODEL;
  const names = Object.keys(TOOLS) as ToolName[];
  const tools = names.map((name, i) => ({
    name, description: TOOLS[name].description, input_schema: TOOLS[name].schema,
    ...(i === names.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
  }));
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [{ role: 'user', content: question }];
  const used: string[] = [];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetcher(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1200, system: systemPrompt(lang, userName), tools, messages }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('anthropic', res.status, text.slice(0, 500));
      if (res.status === 401 || res.status === 403) throw new AskError(502, 'Nøkkelen til Claude (ANTHROPIC_API_KEY) er ugyldig.');
      if (res.status === 429 || res.status === 529) throw new AskError(503, 'Claude er opptatt akkurat nå. Prøv igjen om litt.');
      throw new AskError(502, 'Fikk ikke svar fra Claude.');
    }
    const data = await res.json() as { content: Block[]; stop_reason: string };
    const calls = data.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    if (data.stop_reason !== 'tool_use' || !calls.length) {
      const answer = data.content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n').trim();
      return { answer: answer || 'Jeg fant ikke noe svar.', tools: used, model };
    }
    messages.push({ role: 'assistant', content: data.content });
    const results = await Promise.all(calls.map(async c => {
      used.push(c.name);
      return { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(await runTool(env, c.name, c.input)) };
    }));
    messages.push({ role: 'user', content: results });
  }
  throw new AskError(504, 'Spørsmålet ble for omfattende. Prøv å spørre mer avgrenset.');
}

export class AskError extends Error {
  constructor(public status: 502 | 503 | 504, message: string) { super(message); }
}
