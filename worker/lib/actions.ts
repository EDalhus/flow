import { z } from 'zod';
import type { AskAction } from '../../shared/api.ts';
import {
  boatCreate, bulkOrderCreate, messageCreate, quayLogCreate, orderAssign, orderCancel, orderCreate, portCallCancel, portCallPatch, productionOrderCreate, truckOrderCreate,
} from '../../shared/schemas.ts';
import { nowIso } from './http.ts';

// Jobber Claude kan gjøre i Flow. Claude utfører aldri noe selv: den foreslår en handling, Flow sjekker den
// mot de samme reglene som skjemaene, og brukeren bekrefter. Da kjøres den vanlige API-ruten som brukeren
// (samme tilgang, validering og logg som om brukeren gjorde det selv).

const id = z.string().trim().min(1).max(64);
const dt = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'Tid som ISO 8601, f.eks. 2026-10-20T14:00:00+02:00');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

interface Built { method: 'POST' | 'PATCH'; path: string; body: unknown }
interface ActionDef<S extends z.ZodType> {
  description: string;
  input: S;
  schema: Record<string, unknown>;
  build: (db: D1Database, i: z.infer<S>) => Promise<Built>;
}
const action = <S extends z.ZodType>(a: ActionDef<S>) => a;

/** Sjekker kroppen mot skjemaet ruten bruker, så feil fanges før brukeren får se forslaget. */
function check<S extends z.ZodType>(schema: S, body: unknown): unknown {
  const r = schema.safeParse(body);
  if (!r.success) throw new Error(r.error.issues.map(x => `${x.path.join('.') || 'verdi'}: ${x.message}`).join('; '));
  return body;
}
async function callVersion(db: D1Database, callId: string) {
  const r = await db.prepare('SELECT version FROM port_calls WHERE id = ? AND cancelled_at IS NULL').bind(callId).first<{ version: number }>();
  if (!r) throw new Error(`Fant ikke (aktivt) anløp ${callId}. Slå opp id med verktøyet anlop.`);
  return r.version;
}
async function orderBySo(db: D1Database, so: string) {
  const r = await db.prepare('SELECT id, version FROM sales_orders WHERE so_number = ? AND cancelled_at IS NULL').bind(so.trim()).first<{ id: string; version: number }>();
  if (!r) throw new Error(`Fant ikke (aktiv) salgsordre ${so}.`);
  return r;
}
const str = (p: Record<string, unknown>) => ({ type: 'object', properties: p });

export const ACTIONS = {
  flytt_anlop: action({
    description: 'Endre et anløp: kai, ETA/ETD (flytte i tid), om tiden er kjent, merknad. Bruk port_call_id fra verktøyet anlop og quay_id fra oppslag.',
    input: z.object({ port_call_id: id, quay_id: id.optional(), eta: dt.optional(), etd: dt.optional(), time_known: z.boolean().optional(), notes: z.string().max(2000).optional() }),
    schema: { ...str({ port_call_id: { type: 'string' }, quay_id: { type: 'string' }, eta: { type: 'string', description: 'ISO med tidssone' }, etd: { type: 'string' }, time_known: { type: 'boolean' }, notes: { type: 'string' } }), required: ['port_call_id'] },
    build: async (db, i) => {
      const { port_call_id, ...rest } = i;
      const body = { ...rest, version: await callVersion(db, port_call_id) };
      return { method: 'PATCH', path: `/port-calls/${port_call_id}`, body: check(portCallPatch, body) };
    },
  }),
  avlys_anlop: action({
    description: 'Avlys et anløp med begrunnelse.',
    input: z.object({ port_call_id: id, grunn: z.string().min(3).max(500) }),
    schema: { ...str({ port_call_id: { type: 'string' }, grunn: { type: 'string' } }), required: ['port_call_id', 'grunn'] },
    build: async (db, i) => {
      await callVersion(db, i.port_call_id);
      return { method: 'POST', path: `/port-calls/${i.port_call_id}/cancel`, body: check(portCallCancel, { reason: i.grunn }) };
    },
  }),
  ny_salgsordre: action({
    description: 'Ny salgsordre (SO fra Dynamics 365, format 20xxxxx) med varer. Valgfritt: legg den rett på et eksisterende anløp (port_call_id). Varer: sku_id fra oppslag, antall enheter (BB eller pall), retning ut (salg) eller inn.',
    input: z.object({
      so_number: z.string(), customer: z.string().min(1), wanted_date: day.optional(), notes: z.string().max(2000).optional(), port_call_id: id.optional(),
      lines: z.array(z.object({ sku_id: id, quantity: z.number().int().min(1), direction: z.enum(['ut', 'inn']).default('ut') })).min(1).max(30),
    }),
    schema: {
      ...str({
        so_number: { type: 'string' }, customer: { type: 'string' }, wanted_date: { type: 'string', description: 'YYYY-MM-DD' }, notes: { type: 'string' }, port_call_id: { type: 'string' },
        lines: { type: 'array', items: { type: 'object', properties: { sku_id: { type: 'string' }, quantity: { type: 'integer' }, direction: { type: 'string', enum: ['ut', 'inn'] } }, required: ['sku_id', 'quantity'] } },
      }), required: ['so_number', 'customer', 'lines'],
    },
    build: async (db, i) => {
      if (i.port_call_id) await callVersion(db, i.port_call_id);
      const body = {
        so_number: i.so_number.trim(), customer: i.customer, wanted_date: i.wanted_date ?? null, notes: i.notes ?? null, lines: i.lines,
        placement: i.port_call_id ? { kind: 'call', port_call_id: i.port_call_id } : { kind: 'none' },
      };
      return { method: 'POST', path: '/orders', body: check(orderCreate, body) };
    },
  }),
  legg_so_pa_anlop: action({
    description: 'Legg en eksisterende salgsordre (alle varene) på et anløp.',
    input: z.object({ so_number: z.string(), port_call_id: id }),
    schema: { ...str({ so_number: { type: 'string' }, port_call_id: { type: 'string' } }), required: ['so_number', 'port_call_id'] },
    build: async (db, i) => {
      const o = await orderBySo(db, i.so_number);
      await callVersion(db, i.port_call_id);
      const body = { version: o.version, placement: { kind: 'call', port_call_id: i.port_call_id } };
      return { method: 'POST', path: `/orders/${o.id}/assign`, body: check(orderAssign, body) };
    },
  }),
  avlys_salgsordre: action({
    description: 'Kanseller en salgsordre med begrunnelse.',
    input: z.object({ so_number: z.string(), grunn: z.string().min(3).max(500) }),
    schema: { ...str({ so_number: { type: 'string' }, grunn: { type: 'string' } }), required: ['so_number', 'grunn'] },
    build: async (db, i) => {
      const o = await orderBySo(db, i.so_number);
      return { method: 'POST', path: `/orders/${o.id}/cancel`, body: check(orderCancel, { version: o.version, reason: i.grunn }) };
    },
  }),
  ny_bilhenting: action({
    description: 'Ny bilhenting (kundebil som henter pall/BB) på en forventet dag, med SO-nummer og varer (sku_id fra oppslag).',
    input: z.object({
      customer: z.string().min(1), so_number: z.string(), expected_date: day, reg_no: z.string().max(16).optional(), carrier: z.string().max(120).optional(), notes: z.string().max(1000).optional(),
      goods: z.array(z.object({ sku_id: id, quantity: z.number().int().min(1) })).min(1).max(20),
    }),
    schema: {
      ...str({
        customer: { type: 'string' }, so_number: { type: 'string' }, expected_date: { type: 'string', description: 'YYYY-MM-DD' }, reg_no: { type: 'string' }, carrier: { type: 'string' }, notes: { type: 'string' },
        goods: { type: 'array', items: { type: 'object', properties: { sku_id: { type: 'string' }, quantity: { type: 'integer' } }, required: ['sku_id', 'quantity'] } },
      }), required: ['customer', 'so_number', 'expected_date', 'goods'],
    },
    build: async (_db, i) => ({ method: 'POST', path: '/trucks', body: check(truckOrderCreate, { ...i, reg_no: i.reg_no ?? null, carrier: i.carrier ?? null, notes: i.notes ?? null }) }),
  }),
  marker_hentet: action({
    description: 'Marker en bilhenting som hentet (id fra verktøyet bilhentinger).',
    input: z.object({ truck_order_id: id }),
    schema: { ...str({ truck_order_id: { type: 'string' } }), required: ['truck_order_id'] },
    build: async (db, i) => {
      const t = await db.prepare('SELECT id FROM truck_orders WHERE id = ? AND cancelled_at IS NULL AND picked_up_at IS NULL').bind(i.truck_order_id).first();
      if (!t) throw new Error('Fant ikke en åpen bilhenting med denne id-en.');
      return { method: 'POST', path: `/trucks/${i.truck_order_id}/pickup`, body: {} };
    },
  }),
  ny_bulkbestilling: action({
    description: 'Bestill bulksalt på bil for en sjåfør: bil (vehicle_id), kunde (customer_id), ev. sjåfør (driver_id), prosjektnummer når kunden krever det, SO, ca. tid, og 1–2 steg (bil og ev. henger) med kvalitet og tonn. Id-er fra oppslag.',
    input: z.object({
      vehicle_id: id, customer_id: id, driver_id: id.optional(), project_no: z.string().max(40).optional(), so_number: z.string().optional(), expected_at: dt.optional(), notes: z.string().max(500).optional(),
      steps: z.array(z.object({ quality_id: id, tonnes: z.number().gt(0).max(60), target: z.enum(['bil', 'henger']) })).min(1).max(2),
    }),
    schema: {
      ...str({
        vehicle_id: { type: 'string' }, customer_id: { type: 'string' }, driver_id: { type: 'string' }, project_no: { type: 'string' }, so_number: { type: 'string' },
        expected_at: { type: 'string', description: 'ISO med tidssone, utelates for «nå»' }, notes: { type: 'string' },
        steps: { type: 'array', items: { type: 'object', properties: { quality_id: { type: 'string' }, tonnes: { type: 'number' }, target: { type: 'string', enum: ['bil', 'henger'] } }, required: ['quality_id', 'tonnes', 'target'] } },
      }), required: ['vehicle_id', 'customer_id', 'steps'],
    },
    build: async (_db, i) => {
      const body = { ...i, driver_id: i.driver_id ?? null, project_no: i.project_no ?? null, so_number: i.so_number ?? null, expected_at: i.expected_at ?? null, notes: i.notes ?? null };
      return { method: 'POST', path: '/bulk/orders', body: check(bulkOrderCreate, body) };
    },
  }),
  ny_bat: action({
    description: 'Legg til en båt i båtregisteret (navn, ev. MMSI 9 siffer, IMO 7 siffer, kallesignal).',
    input: z.object({ name: z.string().min(1), mmsi: z.string().optional(), imo: z.string().optional(), callsign: z.string().optional() }),
    schema: { ...str({ name: { type: 'string' }, mmsi: { type: 'string' }, imo: { type: 'string' }, callsign: { type: 'string' } }), required: ['name'] },
    build: async (_db, i) => ({
      method: 'POST', path: '/boats', body: check(boatCreate, { name: i.name, mmsi: i.mmsi ?? null, imo: i.imo ?? null, callsign: i.callsign ?? null }),
    }),
  }),
  send_melding: action({
    description: 'Skriv en melding i chatten på et anløp (port_call_id). @Navn varsler personen.',
    input: z.object({ port_call_id: id, tekst: z.string().min(1).max(4000) }),
    schema: { ...str({ port_call_id: { type: 'string' }, tekst: { type: 'string' } }), required: ['port_call_id', 'tekst'] },
    build: async (db, i) => {
      await callVersion(db, i.port_call_id);
      return { method: 'POST', path: `/port-calls/${i.port_call_id}/messages`, body: check(messageCreate, { body: i.tekst }) };
    },
  }),
  lever_kaibok: action({
    description: 'Ferdigstill et anløp og lever kaiboka (etter at du har intervjuet brukeren). Avvik ja/nei, kategorier (skade_gods, utstyr_kran, mannskap_hms, forsinkelse, annet), en utfyllende rapport som beskrivelse, karakterer 1–5 og ev. notat til båtprofilen. Bilder som allerede er lastet opp på anløpet tas med.',
    input: z.object({
      port_call_id: id, had_deviation: z.boolean(), categories: z.array(z.enum(['skade_gods', 'utstyr_kran', 'mannskap_hms', 'forsinkelse', 'annet'])).default([]),
      description: z.string().max(4000).default(''), r_punctuality: z.number().int().min(1).max(5), r_cooperation: z.number().int().min(1).max(5),
      r_equipment: z.number().int().min(1).max(5), boat_note: z.string().max(1000).optional(),
    }),
    schema: {
      ...str({
        port_call_id: { type: 'string' }, had_deviation: { type: 'boolean' },
        categories: { type: 'array', items: { type: 'string', enum: ['skade_gods', 'utstyr_kran', 'mannskap_hms', 'forsinkelse', 'annet'] } },
        description: { type: 'string', description: 'Rapporten (se reglene for kaibok i systemteksten)' },
        r_punctuality: { type: 'integer' }, r_cooperation: { type: 'integer' }, r_equipment: { type: 'integer' }, boat_note: { type: 'string' },
      }), required: ['port_call_id', 'had_deviation', 'r_punctuality', 'r_cooperation', 'r_equipment'],
    },
    build: async (db, i) => {
      const c = await db.prepare(`SELECT cancelled_at, completed_at, source FROM port_calls WHERE id = ?`).bind(i.port_call_id)
        .first<{ cancelled_at: string | null; completed_at: string | null; source: string }>();
      if (!c || c.source !== 'app') throw new Error('Fant ikke anløpet.');
      if (c.cancelled_at) throw new Error('Anløpet er avlyst.');
      if (c.completed_at) throw new Error('Kaibok er allerede levert for dette anløpet.');
      const photos = await db.prepare('SELECT id FROM quay_log_photos WHERE port_call_id = ? AND quay_log_id IS NULL').bind(i.port_call_id).all<{ id: string }>();
      const body = {
        had_deviation: i.had_deviation, categories: i.had_deviation ? i.categories : [], description: i.had_deviation ? i.description : '',
        ratings: { punctuality: i.r_punctuality, cooperation: i.r_cooperation, equipment: i.r_equipment },
        boat_note: i.boat_note?.trim() || (!i.had_deviation && i.description.trim() ? i.description.trim().slice(0, 1000) : null),
        photo_ids: i.had_deviation ? photos.results.map(p => p.id) : [],
      };
      return { method: 'POST', path: `/port-calls/${i.port_call_id}/quay-log`, body: check(quayLogCreate, body) };
    },
  }),
  ny_produksjonsordre: action({
    description: 'Ny produksjonsordre på en pakkelinje (line_id og product_id fra oppslag) med tonn.',
    input: z.object({ line_id: id, product_id: id, tonnes: z.number().gt(0).max(2000), notes: z.string().max(500).optional() }),
    schema: { ...str({ line_id: { type: 'string' }, product_id: { type: 'string' }, tonnes: { type: 'number' }, notes: { type: 'string' } }), required: ['line_id', 'product_id', 'tonnes'] },
    build: async (_db, i) => ({ method: 'POST', path: '/production/orders', body: check(productionOrderCreate, { ...i, notes: i.notes ?? null }) }),
  }),
};
export type ActionKind = keyof typeof ACTIONS;
export const ACTION_KINDS = Object.keys(ACTIONS) as ActionKind[];

/** Hvor lenge et forslag kan bekreftes. */
export const ACTION_TTL_MIN = 30;

/** Lagrer et forslag (etter at det er sjekket). Feil returneres til Claude, som kan rette og prøve igjen. */
export async function propose(db: D1Database, userId: string, input: unknown): Promise<{ ok: true; action: AskAction } | { ok: false; feil: string }> {
  const p = z.object({ handling: z.enum(ACTION_KINDS as [ActionKind, ...ActionKind[]]), parametere: z.record(z.string(), z.unknown()).default({}), oppsummering: z.string().min(3).max(200), detaljer: z.array(z.string().max(200)).max(12).default([]) })
    .safeParse(input);
  if (!p.success) return { ok: false, feil: p.error.issues.map(x => `${x.path.join('.')}: ${x.message}`).join('; ') };
  const def = ACTIONS[p.data.handling] as ActionDef<z.ZodType>;
  const params = def.input.safeParse(p.data.parametere);
  if (!params.success) return { ok: false, feil: params.error.issues.map(x => `${x.path.join('.')}: ${x.message}`).join('; ') };
  let built: Built;
  try { built = await def.build(db, params.data); } catch (e) { return { ok: false, feil: e instanceof Error ? e.message : 'Ugyldig handling' }; }
  const row = await db.prepare(`INSERT INTO ai_actions (user_id, kind, summary, details, method, path, body) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, created_at`)
    .bind(userId, p.data.handling, p.data.oppsummering, JSON.stringify(p.data.detaljer), built.method, built.path, JSON.stringify(built.body)).first<{ id: number; created_at: string }>();
  return { ok: true, action: { id: row!.id, kind: p.data.handling, summary: p.data.oppsummering, details: p.data.detaljer, status: 'foreslatt', link: null, error: null } };
}

export function linkFor(kind: string, result: Record<string, unknown>, path: string, body: unknown): string | null {
  // Lenken bygges fra stien, kroppen og svaret fra ruten.
  const callId = /\/port-calls\/([^/]+)/.exec(path)?.[1];
  if (kind === 'flytt_anlop' && callId) return `/?id=${callId}`;
  if (kind === 'send_melding' && callId) return `/?id=${callId}&tab=chat`;
  if (kind === 'lever_kaibok') return '/kaibok';
  const so = (body as { so_number?: string })?.so_number;
  if (kind === 'ny_salgsordre' && so) return `/anlop?so=${so}`;
  if (kind === 'ny_bat') return result.id ? `/baater?id=${result.id}` : '/baater';
  return { avlys_anlop: '/anlop', legg_so_pa_anlop: '/anlop?vis=ordre', avlys_salgsordre: '/anlop?vis=ordre', ny_bilhenting: '/biler', marker_hentet: '/biler', ny_bulkbestilling: '/bulk', ny_produksjonsordre: '/produksjon' }[kind] ?? null;
}

export const expired = (createdAt: string) => Date.parse(createdAt) < Date.parse(nowIso()) - ACTION_TTL_MIN * 60_000;
