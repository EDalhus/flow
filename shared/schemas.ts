import { z } from 'zod';
import { CATEGORIES, CREW_ROLES, FLAGS, USER_ROLES } from './domain/types.ts';

// Felles validering for API og skjemaer i frontend.

const id = z.string().trim().min(1).max(64);
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullable().optional().transform(v => (v ? v : null));
const dateTime = z.iso.datetime({ offset: true }).transform(v => new Date(v).toISOString());
const date = z.iso.date();

export const crewRole = z.enum(CREW_ROLES);
export const category = z.enum(CATEGORIES);
export const flag = z.enum(FLAGS);

// ---------------------------------------------------------------- anløp


export const crewSlot = z.object({
  crew_role: crewRole,
  user_id: id.nullable().optional().transform(v => v ?? null),
});

const portCallFields = {
  boat_id: id,
  type: z.enum(['levering', 'henting']),
  quay_id: id,
  eta: dateTime,
  etd: dateTime,
  /** false = klokkeslett ikke kjent ennå; eta/etd brukes da bare for datoen. */
  time_known: z.boolean().optional(),
  seller_id: id.nullable().optional(),
  boat_crane: z.boolean().optional(),
  notes: optionalText(2000),
  crew: z.array(crewSlot).max(20),
  responsible_user_id: id.nullable().optional(),
};

const etdAfterEta = (d: { eta?: string; etd?: string }) => !d.eta || !d.etd || Date.parse(d.etd) > Date.parse(d.eta);
const etdMessage = { message: 'ETD må være etter ETA.', path: ['etd'] };

/** Nytt anløp. `orders`: SO-er som skal med (linjene som venter på båt flyttes hit). */
export const portCallCreate = z
  .object({ ...portCallFields, crew: portCallFields.crew.default([]), orders: z.array(id).max(50).default([]) })
  .refine(etdAfterEta, etdMessage);
export type PortCallCreate = z.infer<typeof portCallCreate>;
/** Det klienten sender (før standardverdier og transformasjoner). */
export type PortCallCreateInput = z.input<typeof portCallCreate>;

// Mannskap og ansvarlig endres via crewPut (egne tilgangsregler).
const { crew: _crew, responsible_user_id: _responsible, ...patchFields } = portCallFields;

export const portCallPatch = z
  .object({ ...patchFields, version: z.int().min(1) })
  .partial()
  .required({ version: true })
  .refine(etdAfterEta, etdMessage);
export type PortCallPatch = z.infer<typeof portCallPatch>;
export type PortCallPatchInput = z.input<typeof portCallPatch>;

export const crewPut = z.object({
  version: z.int().min(1),
  slots: z.array(crewSlot).max(20),
  responsible_user_id: id.nullable().optional(),
});
export type CrewPut = z.infer<typeof crewPut>;

// ---------------------------------------------------------------- salgsordre (SO fra Dynamics 365)

/** SO-nummer: 20 og fem siffer, f.eks. 2043644. */
export const soNumber = z.string().trim().regex(/^20\d{5}$/, 'SO-nummeret må være 20 og fem siffer, f.eks. 2043644.');

export const orderLine = z.object({
  /** Eksisterende linje (ved endring). */
  id: id.optional(),
  sku_id: id,
  quantity: z.int().min(1).max(100_000),
  direction: z.enum(['inn', 'ut']),
});
export type OrderLineInput = z.infer<typeof orderLine>;

/** Nytt anløp laget fra en SO (båt, kai og tid). */
export const newCall = z
  .object({
    boat_id: id, quay_id: id, eta: dateTime, etd: dateTime, time_known: z.boolean().optional(), boat_crane: z.boolean().optional(),
    crew: z.array(crewSlot).max(20).default([]),
  })
  .refine(etdAfterEta, etdMessage);
export type NewCall = z.infer<typeof newCall>;

/** Hvor SO-en (eller linjene) skal: ingen båt ennå, et eksisterende anløp, eller et nytt anløp. */
export const placement = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('call'), port_call_id: id }),
  z.object({ kind: z.literal('new'), call: newCall }),
]);
export type Placement = z.infer<typeof placement>;

export const orderCreate = z.object({
  so_number: soNumber,
  customer: text(200).min(1, 'Skriv inn kunde.'),
  seller_id: id.nullable().optional(),
  wanted_date: date.nullable().optional(),
  notes: optionalText(2000),
  lines: z.array(orderLine).min(1, 'Legg til minst én vare.').max(30),
  placement: placement.default({ kind: 'none' }),
});
export type OrderCreateInput = z.input<typeof orderCreate>;

export const orderPatch = z.object({
  version: z.int().min(1),
  customer: text(200).min(1, 'Skriv inn kunde.').optional(),
  seller_id: id.nullable().optional(),
  wanted_date: date.nullable().optional(),
  notes: optionalText(2000),
  lines: z.array(orderLine).min(1, 'Legg til minst én vare.').max(30).optional(),
});
export type OrderPatchInput = z.input<typeof orderPatch>;

/**
 * Flytt SO-en til et anløp (eller ta den av båten). Uten `lines` flyttes alle linjene som ikke er levert.
 * Med `lines` flyttes bare de linjene og antallene – en linje deles hvis antallet er mindre enn hele linjen.
 */
export const orderAssign = z.object({
  version: z.int().min(1),
  placement,
  lines: z.array(z.object({ line_id: id, quantity: z.int().min(1).max(100_000) })).min(1).max(30).optional(),
});
export type OrderAssignInput = z.input<typeof orderAssign>;

export const orderCancel = z.object({ version: z.int().min(1), reason: text(500).min(3, 'Skriv en kort begrunnelse.') });

/** Lasterekkefølge på et anløp: SO-ene i den rekkefølgen de skal lastes eller losses. */
export const loadOrderPut = z.object({ order_ids: z.array(id).min(1).max(50) });

export const portCallCancel = z.object({ reason: text(500).min(3, 'Skriv en kort begrunnelse.') });

export const rangeQuery = z
  .object({ from: date, to: date })
  .refine(r => r.to >= r.from, { message: '"to" må være samme dag eller etter "from".', path: ['to'] })
  .refine(r => (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 <= 92, { message: 'Maks 92 dager per spørring.', path: ['to'] });

// ---------------------------------------------------------------- chat

export const messageCreate = z.object({ body: text(4000).min(1, 'Meldingen er tom.') });
export const notificationsRead = z.object({ ids: z.array(id).max(200).optional(), all: z.boolean().optional() });

// ---------------------------------------------------------------- kaibok

const rating = z.int().min(1).max(5);

export const quayLogCreate = z
  .object({
    had_deviation: z.boolean(),
    categories: z.array(category).max(CATEGORIES.length).default([]),
    description: text(4000).default(''),
    ratings: z.object({ punctuality: rating, cooperation: rating, equipment: rating }),
    boat_note: optionalText(1000),
    photo_ids: z.array(id).max(20).default([]),
  })
  .superRefine((d, ctx) => {
    if (d.had_deviation && !d.categories.length && !d.description) {
      ctx.addIssue({ code: 'custom', message: 'Velg minst én kategori eller skriv en beskrivelse av avviket.', path: ['description'] });
    }
    if (!d.had_deviation && d.categories.length) {
      ctx.addIssue({ code: 'custom', message: 'Kategorier kan bare settes når det er avvik.', path: ['categories'] });
    }
  });
export type QuayLogCreate = z.infer<typeof quayLogCreate>;
export type QuayLogCreateInput = z.input<typeof quayLogCreate>;

export const quayLogQuery = z.object({
  days: z.coerce.number().int().min(1).max(730).default(60),
  filter: z.enum(['alle', 'avvik', 'ok']).default('alle'),
  q: text(100).optional(),
});

// ---------------------------------------------------------------- båter

const phone = text(40).regex(/^[+\d][\d\s-]*$/, 'Ugyldig telefonnummer.');

export const boatCreate = z.object({
  name: text(100).min(1),
  imo: z.string().trim().regex(/^\d{7}$/, 'IMO er 7 siffer.').nullable().optional(),
  mmsi: z.string().trim().regex(/^\d{9}$/, 'MMSI er 9 siffer.').nullable().optional(),
  callsign: optionalText(20),
  agent_id: id.nullable().optional(),
  ship_contact: optionalText(100),
  ship_phone: phone.nullable().optional(),
  note: optionalText(2000),
});
export const boatPatch = boatCreate.partial();

export const flagOverride = z.object({ flag, reason: text(500).min(3, 'Skriv en begrunnelse for overstyringen.') });

export const agentCreate = z.object({ name: text(100).min(1), phone: phone.nullable().optional() });

export const quayCreate = z.object({
  /** Formelt navn, f.eks. «Kai 1». */
  name: text(80).min(1),
  /** Kallenavn som vises i UI. Tom = bruk name. */
  nickname: optionalText(80),
  /** Tom/null = egen kai; ellers nabobedrift vi samarbeider med. */
  company: optionalText(100),
  sort: z.int().min(0).max(10_000).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
});
export const quayPatch = quayCreate.partial().extend({ active: z.boolean().optional() });

// ---------------------------------------------------------------- folk

export const userCreate = z.object({
  email: z.email().transform(v => v.toLowerCase()),
  name: text(100).min(1),
  short_name: text(40).min(2),
  initials: text(4).min(1),
  title: optionalText(60),
  phone: phone.nullable().optional(),
  roles: z.array(z.enum(USER_ROLES)).min(1).max(USER_ROLES.length),
  skills: z.array(crewRole).max(CREW_ROLES.length).default([]),
});
export const userPatch = userCreate.partial().extend({ active: z.boolean().optional() });

export const shiftsPut = z.object({
  entries: z.array(z.object({ user_id: id, crew_role: crewRole })).max(100),
});

// ---------------------------------------------------------------- rapporter

export const reportQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  product_id: id.optional(),
  direction: z.enum(['begge', 'inn', 'ut']).default('begge'),
});

export const settingsPut = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------- biler (pall/BB hentes av kundebiler)

export const truckOrderCreate = z.object({
  customer: text(120).min(1, 'Skriv inn kunde.'),
  carrier: optionalText(120),
  reg_no: optionalText(16),
  reference: optionalText(60),
  expected_date: date,
  notes: optionalText(1000),
  goods: z.array(z.object({ sku_id: id, quantity: z.int().min(1).max(100_000) })).min(1, 'Legg til minst én vare.').max(20),
});
export const truckOrderPatch = truckOrderCreate.partial();
export type TruckOrderCreateInput = z.input<typeof truckOrderCreate>;

// ---------------------------------------------------------------- bulkbil (egne biler, salt i bulk)

export const bulkStep = z.object({
  quality_id: id,
  tonnes: z.number().gt(0, 'Tonn må være over 0.').max(60),
  target: z.enum(['bil', 'henger']).nullable().optional().transform(v => v ?? null),
  pause_after_sec: z.int().min(0).max(1800).default(0),
});
export const bulkOrderCreate = z.object({
  truck: text(60).min(1, 'Skriv inn bil.'),
  destination: optionalText(120),
  expected_at: dateTime.nullable().optional(),
  notes: optionalText(500),
  steps: z.array(bulkStep).min(1, 'Legg til minst ett steg.').max(4),
});
export type BulkOrderCreateInput = z.input<typeof bulkOrderCreate>;

// ---------------------------------------------------------------- produksjon (pakkelinjer og siloer)

export const productionOrderCreate = z.object({
  line_id: id,
  product_id: id,
  tonnes: z.number().gt(0).max(2000),
  notes: optionalText(500),
});
export const siloFill = z.object({ line_id: id, tonnes: z.number().gt(0).max(60) });
export const packingLinePatch = z.object({
  rate_tph: z.number().gt(0).max(200).optional(),
  silo_capacity_t: z.number().gt(0).max(500).optional(),
});

export const prefsPut = z.object({
  timeline_days: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14)]).optional(),
  theme: z.enum(['mork', 'lys', 'system']).optional(),
  lang: z.enum(['nb', 'en', 'lt', 'da', 'sv', 'is']).optional(),
});

export const BOAT_PHOTO_CATEGORIES = ['rampe', 'sideport', 'heis', 'lasterom', 'dekk', 'kran', 'annet'] as const;
