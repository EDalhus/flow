import { z } from 'zod';
import type { AskAction, AskTurn, BulkGroup, KaibokDraft, Lang } from '../../shared/api.ts';
import { addDays, osloToUtc, todayOslo } from '../../shared/time.ts';
import { fetchAllLatest, matchVessels } from '../ais/barentswatch.ts';
import { bulkReport } from '../db/bulk.ts';
import { loadOrders } from '../db/orders.ts';
import { ACTIONS, ACTION_KINDS, propose } from './actions.ts';
import { HELP_DRIVER, HELP_FLOW } from './help.ts';
import { loadSettings } from './settings.ts';

// «Spør Flow»: spørsmål med vanlige ord i søkefeltet besvares av Claude (Anthropic API).
// Modellen får ingen direkte tilgang til databasen, bare faste verktøy som leser (aldri endrer) data.
// Den velger verktøy og periode, Flow kjører spørringene, og modellen skriver svaret med tall og lenker.

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
const MAX_ROUNDS = 8;

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
  hjelp: tool({
    description: 'Brukerhåndboka for Flow: hvor ting gjøres og stegene (ny sjåfør, ny SO, kaibok, flytte anløp, roller …), med lenker til sidene. Bruk ved «hvordan …»-spørsmål.',
    input: z.object({}),
    schema: { type: 'object', properties: {} },
    run: async () => ({ handbok: HELP_FLOW }),
  }),
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
          id: r.id, bat: r.boat, link: `/baater?id=${r.boat_id}`, dato: r.service_date, eta: r.time_known ? r.eta : null, etd: r.time_known ? r.etd : null,
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
      return { periode: i, link: '/biler', ordrer: results.map(t => ({ id: t.id, kunde: t.customer, dag: t.expected_date, so: t.so_number, reg_nr: t.reg_no, transportor: t.carrier, varer: t.goods, tonn: r1(t.tonnes as number), hentet: !!t.picked_up_at })) };
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

// ---------------------------------------------------------------- oppslag og jobber

/** Id-er Claude trenger for å foreslå jobber: kaier, varer (SKU), bulkregister, pakkelinjer og folk. */
const LOOKUP = tool({
  description: 'Slå opp id-er før du foreslår en jobb: kaier (quay_id), varer (sku_id/product_id med enhet), bulk (bil/vehicle_id, kunde/customer_id, sjåfør/driver_id, kvalitet/quality_id), pakkelinjer (line_id) og folk (user_id).',
  input: z.object({ hva: z.array(z.enum(['kaier', 'varer', 'bulk', 'pakkelinjer', 'folk'])).min(1) }),
  schema: { type: 'object', required: ['hva'], properties: { hva: { type: 'array', items: { type: 'string', enum: ['kaier', 'varer', 'bulk', 'pakkelinjer', 'folk'] } } } },
  run: async (env, i) => {
    const db = env.DB;
    const out: Record<string, unknown> = {};
    if (i.hva.includes('kaier')) out.kaier = (await db.prepare('SELECT id, name, nickname, company FROM quays WHERE active = 1 ORDER BY sort').all()).results;
    if (i.hva.includes('varer')) out.varer = (await db.prepare(`SELECT s.id AS sku_id, p.id AS product_id, p.name AS produkt, s.unit AS enhet, s.pallet_type AS pall, s.bags_per_unit AS sekker, s.kg_per_unit AS kg_per_enhet
                                                              FROM skus s JOIN products p ON p.id = s.product_id WHERE s.active = 1 ORDER BY p.sort, s.sort`).all()).results;
    if (i.hva.includes('bulk')) {
      const [v, c, d, q] = await db.batch([
        db.prepare('SELECT v.id, v.reg_no, v.description, v.has_trailer, h.name AS transportfirma FROM vehicles v JOIN haulers h ON h.id = v.hauler_id WHERE v.active = 1'),
        db.prepare('SELECT id, name, requires_project FROM bulk_customers WHERE active = 1'),
        db.prepare('SELECT d.id, d.name, h.name AS transportfirma FROM drivers d JOIN haulers h ON h.id = d.hauler_id WHERE d.active = 1'),
        db.prepare('SELECT id, name FROM bulk_qualities WHERE active = 1'),
      ]);
      out.bulk = { biler: v.results, kunder: c.results, sjaforer: d.results, kvaliteter: q.results };
    }
    if (i.hva.includes('pakkelinjer')) out.pakkelinjer = (await db.prepare('SELECT id, name FROM packing_lines ORDER BY id').all()).results;
    if (i.hva.includes('folk')) out.folk = (await db.prepare(`SELECT u.id, u.name, u.short_name, group_concat(r.role) AS roller FROM users u LEFT JOIN user_roles r ON r.user_id = u.id
                                                              WHERE u.active = 1 GROUP BY u.id ORDER BY u.name`).all()).results;
    return out;
  },
});

const PROPOSE = {
  name: 'foresla_handling',
  description: `Foreslå en jobb i Flow som brukeren må bekrefte før den gjøres. Handlinger:
${ACTION_KINDS.map(k => `- ${k}: ${ACTIONS[k].description} Parametere: ${JSON.stringify((ACTIONS[k].schema as { properties: Record<string, unknown> }).properties)}`).join('\n')}
Flow sjekker forslaget; får du «feil», rett parameterne og prøv igjen. Ett kall per jobb (flere jobber = flere kall).`,
  input_schema: {
    type: 'object', required: ['handling', 'parametere', 'oppsummering'],
    properties: {
      handling: { type: 'string', enum: ACTION_KINDS },
      parametere: { type: 'object', description: 'Parametere for handlingen (se listen)' },
      oppsummering: { type: 'string', description: 'Kort, på brukerens språk: hva som gjøres, f.eks. «Flytt Coneste til Kai 2, i morgen 14:00–18:00»' },
      detaljer: { type: 'array', items: { type: 'string' }, description: '1–6 korte linjer med det viktigste (navn, ikke id-er)' },
    },
  },
};

function systemPrompt(lang: Lang, userName: string, roles: string[]) {
  const today = todayOslo();
  return `Du er «Spør Flow», assistenten i Flow – kai- og logistikksystemet til Flatholmen havn 81B i Ålesund (salt: havsalt, steinsalt, blandet salt, veisalt m.m., levert med båt, kundebil og bulkbil).
I dag er ${today} (Europe/Oslo, ${new Intl.DateTimeFormat('nb-NO', { weekday: 'long', timeZone: 'Europe/Oslo' }).format(new Date())}). Klokka er ${new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' }).format(new Date())}. Brukeren heter ${userName} (roller: ${roles.join(', ') || 'ingen'}).

Regler:
- Svar på ${LANG_NAME[lang]}, kort og konkret. Ikke gjenta spørsmålet.
- Format (markdown): Start med én setning som svarer direkte (konklusjonen, med det viktigste tallet). Deretter en punktliste («- ») med 2–5 punkter, hvert punkt kort og gjerne med en **fet etikett:** først. Ved rangering: nummerert liste («1. »). Avslutt eventuelt med én kort setning om forbehold. Ingen tabeller, ingen overskrifter med #, ingen lange avsnitt.
- Skriv navn på båter, kunder og produkter slik de står i dataene (f.eks. Polarstrand, ikke POLARSTRAND).
- Bruk bare tall fra verktøyene. Finn aldri på tall, båter, kunder eller datoer. Mangler data, si det.
- Når brukeren ikke sier periode: bruk siste 12 måneder for statistikk (${addDays(today, -365)} til ${today}), og si hvilken periode tallene gjelder.
- «Problemer» med en båt = avvik i kaibøkene og lave karakterer. «Populært produkt» = flest tonn solgt (retning ut).
- Lenk til det du nevner med markdown-lenker, og bare med stier som står i «link» i verktøyresultatene, f.eks. [Coneste](/baater?id=…). Lenk hvert navn bare første gang, og ikke legg lenker inne i **fet** tekst.
- Tall: bruk norsk/europeisk format med komma som desimaltegn når du svarer på norsk, og enheten (t, tonn, kn, nm).
- «Hvordan …»-spørsmål om Flow: bruk verktøyet hjelp og svar med korte, nummererte steg og en lenke til siden (stier fra håndboka er lov å lenke til). Bruk knappenavnene på brukerens språk hvis du kjenner dem, ellers de norske i «».

Jobber:
- Ber brukeren deg gjøre noe (flytte et anløp, lage SO, bestille bulk, markere hentet, skrive i chatten …), slå opp det du trenger (anlop, salgsordre, bilhentinger, oppslag) og kall foresla_handling. Du utfører aldri noe selv – brukeren får et kort med «Utfør» og bekrefter.
- Tider er Europe/Oslo; skriv ISO med tidssone (+01:00 vinter, +02:00 sommer). Flytter du et anløp i tid, behold varigheten (ETD − ETA) hvis ikke annet er sagt.
- Mangler noe vesentlig (hvilken båt, dag, mengde, kunde), spør kort i stedet for å gjette. Små ting (f.eks. kai når bare én passer) kan du velge og nevne.
- Etter forslaget: skriv én kort setning om hva kortet gjør (ikke gjenta alle detaljene).
- Du kan ikke slette data, endre tilganger eller registre for sjåfører; forklar da hvor i Flow det gjøres.`;
}

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };
type Msg = { role: 'user' | 'assistant'; content: unknown };
export interface AskResult { answer: string; tools: string[]; model: string; actions: AskAction[] }

/** Ett kall til Anthropic Messages API, med forståelige feil. */
async function callClaude(env: Env, body: Record<string, unknown>, fetcher: Fetcher): Promise<{ content: Block[]; stop_reason: string }> {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new AskError(503, 'Spør Flow er ikke satt opp (ANTHROPIC_API_KEY mangler).');
  const res = await fetcher(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('anthropic', res.status, text.slice(0, 500));
    if (res.status === 401 || res.status === 403) throw new AskError(502, 'Nøkkelen til Claude (ANTHROPIC_API_KEY) er ugyldig.');
    if (res.status === 429 || res.status === 529) throw new AskError(503, 'Claude er opptatt akkurat nå. Prøv igjen om litt.');
    throw new AskError(502, 'Fikk ikke svar fra Claude.');
  }
  return res.json();
}
const textOf = (content: Block[]) => content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n').trim();
const toolList = (names: string[], extra: Record<string, unknown>[] = []) => {
  const all: Record<string, unknown>[] = [
    ...names.map(name => { const t = (TOOLS as Record<string, Tool<z.ZodType>>)[name] ?? (name === 'oppslag' ? LOOKUP : null); return { name, description: t!.description, input_schema: t!.schema }; }),
    ...extra,
  ];
  all[all.length - 1] = { ...all[all.length - 1], cache_control: { type: 'ephemeral' } };
  return all;
};

/** Kjører en samtale med verktøy til Claude har et svar. `onTool` håndterer verktøy som ikke bare leser. */
async function converse(env: Env, opts: { system: string; messages: Msg[]; tools: Record<string, unknown>[]; maxTokens?: number },
  fetcher: Fetcher, onTool?: (name: string, input: unknown) => Promise<unknown | undefined>) {
  const model = env.AI_MODEL?.trim() || DEFAULT_MODEL;
  const messages = [...opts.messages];
  const used: string[] = [];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const data = await callClaude(env, { model, max_tokens: opts.maxTokens ?? 1500, system: opts.system, tools: opts.tools, messages }, fetcher);
    const calls = data.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    if (data.stop_reason !== 'tool_use' || !calls.length) return { answer: textOf(data.content), tools: used, model };
    messages.push({ role: 'assistant', content: data.content });
    const results = [];
    for (const c of calls) {
      used.push(c.name);
      const custom = onTool ? await onTool(c.name, c.input) : undefined;
      const out = custom !== undefined ? custom : c.name === 'oppslag' ? await runLookup(env, c.input) : await runTool(env, c.name, c.input);
      results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out) });
    }
    messages.push({ role: 'user', content: results });
  }
  throw new AskError(504, 'Spørsmålet ble for omfattende. Prøv å spørre mer avgrenset.');
}
async function runLookup(env: Env, input: unknown) {
  const p = LOOKUP.input.safeParse(input ?? {});
  return p.success ? LOOKUP.run(env, p.data) : { feil: 'Ugyldige parametere' };
}

/** «Spør Flow»: spørsmål og jobber, med tidligere turer i samme samtale. */
export async function ask(env: Env, question: string, lang: Lang, user: { id: string; name: string; roles: string[] }, history: AskTurn[] = [], fetcher: Fetcher = fetch): Promise<AskResult> {
  if (!env.ANTHROPIC_API_KEY?.trim()) throw new AskError(503, 'Spør Flow er ikke satt opp (ANTHROPIC_API_KEY mangler).');
  const actions: AskAction[] = [];
  const messages: Msg[] = [...history.slice(-8).map(t => ({ role: t.role, content: t.content })), { role: 'user', content: question }];
  const r = await converse(env, { system: systemPrompt(lang, user.name, user.roles), messages, tools: toolList([...Object.keys(TOOLS), 'oppslag'], [PROPOSE]) }, fetcher,
    async (name, input) => {
      if (name !== 'foresla_handling') return undefined;
      const p = await propose(env.DB, user.id, input);
      if (!p.ok) return { feil: p.feil };
      actions.push(p.action);
      return { ok: true, melding: 'Forslaget vises for brukeren med «Utfør». Ikke utført ennå.' };
    });
  return { ...r, answer: r.answer || (actions.length ? '' : 'Jeg fant ikke noe svar.'), actions };
}

// ---------------------------------------------------------------- morgenbrief

const BRIEF_FOCUS: Record<string, string> = {
  kaiarbeider: 'kaia: båtene som kommer og går i dag og i morgen (tid, kai, levering/henting, tonn), kollisjoner på kaia, båter med rødt/gult flagg, bilhentinger i dag',
  produksjon: 'produksjon og drift: anløp i dag (tonn ut/inn), bulkkøen og bulk i går, bilhentinger i dag, båter med rødt flagg',
  salg: 'salg: salgsordrer som venter på båt eller har ønsket dag snart, anløp i dag og i morgen, bilhentinger i dag, solgt siste 7 dager mot uka før',
  admin: 'hele driften: anløp i dag, bilhentinger, bulk, salgsordrer som venter på båt, og avvik siste uke',
};

/** Morgenbrief for en rollekombinasjon: kort, konkret og bare med tall fra verktøyene. */
export async function morningBrief(env: Env, roles: string[], lang: Lang, fetcher: Fetcher = fetch): Promise<string> {
  const focus = (roles.length ? roles : ['admin']).map(r => BRIEF_FOCUS[r]).filter(Boolean).join('; ');
  const today = todayOslo();
  const r = await converse(env, {
    system: `${systemPrompt(lang, 'teamet', roles)}

Nå skal du skrive dagens morgenbrief (ingen jobber, bare lese). Fokus for denne rollen: ${focus}.
Format: én åpningssetning med det viktigste i dag, så 3–6 punkter («- ») med **fet etikett:** først, og eventuelt én setning til slutt om noe som krever handling. Maks ca. 120 ord. Ikke hils.`,
    messages: [{ role: 'user', content: `Lag morgenbriefen for ${today}.` }],
    tools: toolList(Object.keys(TOOLS)),
    maxTokens: 900,
  }, fetcher);
  return r.answer;
}

// ---------------------------------------------------------------- kaibok med egne ord

const KAIBOK_TOOL = {
  name: 'fyll_kaibok',
  description: 'Fyll ut kaiboka fra det kaiarbeideren fortalte.',
  input_schema: {
    type: 'object', required: ['had_deviation', 'categories', 'r_punctuality', 'r_cooperation', 'r_equipment', 'description'],
    properties: {
      had_deviation: { type: 'boolean', description: 'Var det avvik (skade, utstyr, HMS, forsinkelse eller annet)?' },
      categories: { type: 'array', items: { type: 'string', enum: ['skade_gods', 'utstyr_kran', 'mannskap_hms', 'forsinkelse', 'annet'] }, description: 'Bare når had_deviation er true' },
      r_punctuality: { type: 'integer', minimum: 1, maximum: 5, description: '1 = svært dårlig, 3 = ok, 5 = svært bra. Ikke nevnt = 4 (bra) hvis det ikke var forsinkelse' },
      r_cooperation: { type: 'integer', minimum: 1, maximum: 5 },
      r_equipment: { type: 'integer', minimum: 1, maximum: 5 },
      description: { type: ['string', 'null'], description: 'Ryddig, saklig beskrivelse av avviket (hva, hvor mye, konsekvens), på samme språk som kaiarbeideren skrev. null uten avvik' },
      boat_note: { type: ['string', 'null'], description: 'Ting som er nyttig neste gang båten kommer (utstyr, kontakt, rutiner), ellers null' },
    },
  },
};

export async function kaibokDraft(env: Env, call: { boat: string; type: string; eta: string }, text: string, fetcher: Fetcher = fetch): Promise<KaibokDraft> {
  const model = env.AI_MODEL?.trim() || DEFAULT_MODEL;
  const data = await callClaude(env, {
    model, max_tokens: 800,
    system: 'Du fyller ut kaibøker i Flow (Flatholmen havn) ut fra det kaiarbeideren forteller med egne ord, ofte diktert. Ikke legg til noe som ikke er sagt. Karakterer: 1 svært dårlig, 2 dårlig, 3 ok, 4 bra, 5 svært bra.',
    tools: [KAIBOK_TOOL], tool_choice: { type: 'tool', name: 'fyll_kaibok' },
    messages: [{ role: 'user', content: `Anløp: ${call.boat} (${call.type}, ETA ${call.eta}).\nKaiarbeideren sier:\n${text}` }],
  }, fetcher);
  const use = data.content.find((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
  const p = z.object({
    had_deviation: z.boolean(), categories: z.array(z.enum(['skade_gods', 'utstyr_kran', 'mannskap_hms', 'forsinkelse', 'annet'])).default([]),
    r_punctuality: z.number().int().min(1).max(5), r_cooperation: z.number().int().min(1).max(5), r_equipment: z.number().int().min(1).max(5),
    description: z.string().max(2000).nullable().default(null), boat_note: z.string().max(2000).nullable().default(null),
  }).safeParse(use?.input);
  if (!p.success) throw new AskError(502, 'Claude klarte ikke å fylle ut kaiboka. Prøv å beskrive litt mer.');
  return { ...p.data, categories: p.data.had_deviation ? p.data.categories : [] };
}

// ---------------------------------------------------------------- oversettelse

export const TRANSLATE_MODEL = 'claude-haiku-5-5';

/** Oversetter tekster til `lang`. Tekster som allerede er på målspråket gir text = null. */
export async function translateTexts(env: Env, texts: string[], lang: Lang, fetcher: Fetcher = fetch): Promise<{ text: string | null; source_lang: string | null }[]> {
  const model = env.AI_TRANSLATE_MODEL?.trim() || TRANSLATE_MODEL;
  const data = await callClaude(env, {
    model, max_tokens: 4000,
    system: `Du oversetter korte fritekster fra en havn (chatmeldinger, avvik, merknader) til ${LANG_NAME[lang]}. Behold navn på båter, personer, firma, SO-numre, reg.nr. og tall uendret, og behold tonen (kort og muntlig er greit). Er teksten allerede på ${LANG_NAME[lang]} (eller bare navn/tall), sett same = true.`,
    tools: [{
      name: 'oversettelser', description: 'Oversettelsene, i samme rekkefølge som tekstene.',
      input_schema: { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { type: 'object', required: ['i', 'source_lang', 'same'], properties: {
        i: { type: 'integer' }, source_lang: { type: 'string', description: 'ISO 639-1, f.eks. nb, lt, en' }, same: { type: 'boolean' }, text: { type: 'string' },
      } } } } },
    }],
    tool_choice: { type: 'tool', name: 'oversettelser' },
    messages: [{ role: 'user', content: JSON.stringify(texts.map((t, i) => ({ i, text: t }))) }],
  }, fetcher);
  const use = data.content.find((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
  const items = (use?.input as { items?: { i: number; source_lang?: string; same?: boolean; text?: string }[] })?.items ?? [];
  return texts.map((_, i) => {
    const it = items.find(x => x.i === i);
    return { text: it && !it.same && it.text ? it.text : null, source_lang: it?.source_lang?.slice(0, 5) ?? null };
  });
}

// ---------------------------------------------------------------- før båten kommer

/** Kort, praktisk sammendrag av båten før anløpet (historikk, avvik, kontakt, ting å passe på). */
export async function boatBrief(env: Env, boatName: string, lang: Lang, fetcher: Fetcher = fetch): Promise<string> {
  const today = todayOslo();
  const r = await converse(env, {
    system: `${systemPrompt(lang, 'kaia', [])}

Lag et kort «Før båten kommer»-sammendrag for kaia om båten ${boatName}. Bruk bat_info (profil, agent, kontakt, siste anløp) og bat_kvalitet for siste 12 måneder (${addDays(today, -365)} til ${today}); se bare på denne båten.
Format: én setning med det viktigste (f.eks. «3 avvik siste år, kranproblemer to ganger»), så 1–4 korte punkter med det kaia bør gjøre eller passe på (kontakt/telefon, utstyr, punktlighet, notater fra tidligere kaibøker). Har båten ingen kaibøker eller avvik, si det kort i én setning. Maks 70 ord. Ingen lenker.`,
    messages: [{ role: 'user', content: `Før båten kommer: ${boatName}` }],
    tools: toolList(['bat_info', 'bat_kvalitet']),
    maxTokens: 500,
  }, fetcher);
  return r.answer;
}

// ---------------------------------------------------------------- rapport med forklaringer

/** Rapport for en periode med sammenligning mot perioden før, og forklaringer på endringene. */
export async function periodReport(env: Env, from: string, to: string, lang: Lang, fetcher: Fetcher = fetch): Promise<string> {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(days - 1));
  const r = await converse(env, {
    system: `${systemPrompt(lang, 'ledelsen', ['admin'])}

Nå skal du skrive en rapport for perioden ${from} til ${to}, sammenlignet med perioden før (${prevFrom} til ${prevTo}). Hent tall med verktøyene for begge periodene: salg (per produkt og per kunde, retning ut, og retning inn), bat_kvalitet, bulk (per kvalitet og per kunde), anlop og bilhentinger.
Format (markdown, her er overskrifter lov):
- Én innledende setning med hovedbildet (tonn ut og endring i prosent).
- ### Hovedtall – punkter: tonn ut og inn, antall anløp, bilhentinger, bulk (veid tonn), hver med endring mot perioden før.
- ### Produkter – de største produktene med tonn og andel, og hva som har økt eller falt mest.
- ### Kunder – de 5 største kundene, og nye eller borte kunder hvis det er tydelig.
- ### Båter og kvalitet – avvik og kategorier, punktlighet, båter med flest avvik.
- ### Bulk – kort.
- ### Hva har endret seg – 2–4 punkter som forklarer de viktigste endringene ut fra tallene (ikke gjett årsaker utenfor dataene; skriv «ser ut til» når det er tolkning).
Maks ca. 400 ord. Ingen lenker.`,
    messages: [{ role: 'user', content: `Lag rapporten for ${from} til ${to}.` }],
    tools: toolList(['salg', 'bat_kvalitet', 'bulk', 'anlop', 'bilhentinger']),
    maxTokens: 2500,
  }, fetcher);
  return r.answer;
}

// ---------------------------------------------------------------- hjelp for sjåfører

export async function driverHelp(env: Env, question: string, lang: Lang, history: AskTurn[] = [], fetcher: Fetcher = fetch): Promise<string> {
  const model = env.AI_MODEL?.trim() || DEFAULT_MODEL;
  const data = await callClaude(env, {
    model, max_tokens: 600,
    system: `Du hjelper sjåfører som henter bulksalt hos Flatholmen havn med sjåførvisningen i Flow. Svar på ${LANG_NAME[lang]}, kort og med nummererte steg når det passer. Bruk bare håndboka under; vet du ikke, si at de skal ringe kontoret. Ingen lenker.
${HELP_DRIVER}`,
    messages: [...history.slice(-6).map(t => ({ role: t.role, content: t.content })), { role: 'user', content: question }],
  }, fetcher);
  return textOf(data.content) || 'Ring kontoret, så hjelper de deg.';
}

export class AskError extends Error {
  constructor(public status: 502 | 503 | 504, message: string) { super(message); }
}
