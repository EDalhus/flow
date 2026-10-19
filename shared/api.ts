// Responstyper fra API-et. Brukes av frontend.
import type { Collision, Suggestion } from './domain/collisions.ts';
import type { SearchScope } from './domain/search.ts';
import type { CallStatus, CallType, Category, CrewRole, Direction, Flag, UserRole } from './domain/types.ts';

export interface UserRef {
  id: string;
  name: string;
  short_name: string;
  initials: string;
}

export interface Me extends UserRef {
  email: string;
  roles: UserRole[];
  /** Appen kjører uten Cloudflare Access; brukeren velges i appen. */
  open: boolean;
  prefs: UserPrefs;
  /** Claude er satt opp (ANTHROPIC_API_KEY): «Spør Flow», jobber, morgenbrief, kaibok med egne ord og oversettelse. */
  ai: boolean;
}

/** Valg hver bruker gjør selv. */
export interface UserPrefs {
  /** Periode på kaiplanen i kartet: 1, 3, 7 eller 14 dager. Standard 7. */
  timeline_days?: 1 | 3 | 7 | 14;
  /** Fargetema. Standard mørkt. «system» følger innstillingen på maskinen. */
  theme?: Theme;
  /** Språk i menyer, faner og kart (demo). Standard norsk. */
  lang?: Lang;
}

export type Theme = 'mork' | 'lys' | 'system';
export type Lang = 'nb' | 'en' | 'lt' | 'da' | 'sv' | 'is';

export type BoatPhotoCategory = 'rampe' | 'sideport' | 'heis' | 'lasterom' | 'dekk' | 'kran' | 'annet';

export interface BoatPhoto {
  id: string;
  url: string;
  thumb_url: string | null;
  category: BoatPhotoCategory;
  caption: string | null;
  width: number | null;
  height: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface UserView extends UserRef {
  email: string;
  title: string | null;
  phone: string | null;
  active: boolean;
  roles: UserRole[];
  skills: CrewRole[];
}

export interface GoodsView {
  id: string;
  sku_id: string;
  product_id: string;
  product_name: string;
  unit: 'BB' | 'pall';
  pallet_type: 'europall' | 'srs' | null;
  bags_per_unit: number | null;
  quantity: number;
  direction: Direction;
  tonnes: number;
  /** "120 pall Hav salt · 25 kg × 40 · Europall" */
  label: string;
  /** Salgsordren linjen hører til. */
  sales_order_id: string;
}

export interface CrewSlotView {
  id: string;
  crew_role: CrewRole;
  user: UserRef | null;
}

export type SuggestionView = Suggestion & { text: string };

export type CollisionView = Collision & {
  text: string;
  with: { id: string; boat_name: string }[];
  suggestions: SuggestionView[];
};

export interface BoatSummary {
  id: string;
  name: string;
  flag: Flag;
  flag_reason: string | null;
  flag_overridden: boolean;
  avg_total: number | null;
  rating_count: number;
}

/** Kai – company er null for egne, ellers nabobedrift. nickname er det som vises i UI. */
export interface Quay {
  id: string;
  name: string;
  nickname: string | null;
  company: string | null;
  sort: number;
  lat: number | null;
  lon: number | null;
  active: boolean;
}

/** Kai på anløp/kaibok. */
export type QuayRef = { id: string; name: string; nickname: string | null; company: string | null };

/** En SO på et anløp, i lasterekkefølge. */
export interface CallOrder {
  id: string;
  so_number: string;
  customer: string;
  /** 1 = lastes/losses først. */
  load_seq: number;
  tonnes: number;
  /** Linjene i denne SO-en som skal med dette anløpet. */
  goods: GoodsView[];
  /** SO-en har også linjer på andre anløp (delt levering) eller som venter på båt. */
  split: boolean;
}

export interface PortCallView {
  id: string;
  /** Utledet av varene: «begge» når anløpet både leverer og henter. */
  type: CallType | 'begge';
  eta: string;
  etd: string;
  service_date: string;
  /** false = bare dagen er kjent; eta/etd er da 00:00–23:59. */
  time_known: boolean;
  boat_crane: boolean;
  notes: string | null;
  version: number;
  boat: BoatSummary;
  quay: QuayRef;
  seller: (UserRef & { phone: string | null }) | null;
  responsible: UserRef | null;
  /** true når anløpet har én rolle, og ansvarlig derfor er satt automatisk. */
  responsible_auto: boolean;
  goods: GoodsView[];
  /** Salgsordrene på anløpet, i lasterekkefølge. */
  orders: CallOrder[];
  tonnes_in: number;
  tonnes_out: number;
  crew: CrewSlotView[];
  status: CallStatus;
  status_basis: 'kaibok' | 'ais' | 'tid' | 'plan';
  arrived_at: string | null;
  departed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  has_quay_log: boolean;
  message_count: number;
  collisions: CollisionView[];
}

// ---------------------------------------------------------------- salgsordre

export type OrderStatus = 'venter' | 'planlagt' | 'delvis' | 'ferdig' | 'kansellert';

/** Kort beskrivelse av et anløp, slik det vises på en SO og i loggen. */
export interface CallRef {
  id: string;
  boat_id: string;
  boat_name: string;
  quay: QuayRef;
  eta: string;
  etd: string;
  time_known: boolean;
  service_date: string;
  status: CallStatus;
  load_seq: number;
}

export interface OrderLine extends GoodsView {
  /** Anløpet linjen skal med, eller null (venter på båt). */
  port_call_id: string | null;
}

export interface OrderView {
  id: string;
  so_number: string;
  customer: string;
  seller: UserRef | null;
  wanted_date: string | null;
  notes: string | null;
  status: OrderStatus;
  version: number;
  lines: OrderLine[];
  tonnes: number;
  /** Anløpene SO-en ligger på (vanligvis ett). */
  calls: CallRef[];
  cancelled_at: string | null;
  created_at: string;
}

/** Beskrivelse av et anløp i loggen, lagret slik det var da endringen skjedde. */
export interface LogCall { boat: string; eta: string; time_known: boolean; quay: string }

export type OrderLogKind =
  | 'created' | 'line_added' | 'line_removed' | 'line_changed' | 'customer' | 'seller' | 'wanted_date' | 'notes'
  | 'assigned' | 'moved' | 'unassigned' | 'boat_changed' | 'eta_changed' | 'quay_changed' | 'load_order'
  | 'cancelled' | 'completed';

export interface OrderLogEntry {
  id: number;
  at: string;
  user: UserRef | null;
  kind: OrderLogKind;
  /** Fra–til og annet, avhengig av kind. Tekstene settes sammen i nettleseren, på brukerens språk. */
  data: Record<string, unknown>;
  port_call_id: string | null;
  sales_order_id: string | null;
  so_number: string | null;
}

export interface OrderDetail extends OrderView {
  log: OrderLogEntry[];
}

export interface MessageView {
  id: string;
  port_call_id: string;
  kind: 'user' | 'system';
  author: UserRef | null;
  body: string;
  mentions: string[];
  created_at: string;
}

export interface NotificationView {
  id: string;
  kind: 'mention' | 'assigned' | 'collision' | 'quay_log' | 'order';
  text: string;
  port_call_id: string | null;
  message_id: string | null;
  created_at: string;
  read_at: string | null;
}

export interface QuayLogView {
  id: string;
  port_call_id: string;
  boat: { id: string; name: string };
  quay: QuayRef;
  service_date: string;
  type: CallType;
  eta: string;
  etd: string;
  responsible: UserRef | null;
  crew: UserRef[];
  had_deviation: boolean;
  categories: Category[];
  description: string | null;
  ratings: { punctuality: number; cooperation: number; equipment: number };
  avg: number;
  boat_note: string | null;
  photos: { id: string; url: string; thumb_url: string | null }[];
  delivered_by: UserRef | null;
  delivered_at: string;
}

export interface BoatView extends BoatSummary {
  imo: string | null;
  mmsi: string | null;
  callsign: string | null;
  note: string | null;
  agent: { id: string; name: string; phone: string | null } | null;
  ship_contact: string | null;
  ship_phone: string | null;
  avg_punctuality: number | null;
  avg_cooperation: number | null;
  avg_equipment: number | null;
  last_log_at: string | null;
  flag_auto: Flag;
  flag_auto_reason: string | null;
  flag_override: Flag | null;
  flag_override_reason: string | null;
  flag_override_by: UserRef | null;
  flag_override_at: string | null;
  next_call: { id: string; eta: string; etd: string; time_known: boolean; quay_name: string; status: CallStatus } | null;
}

export interface BoatDetail extends BoatView {
  recent_logs: QuayLogView[];
  photos: BoatPhoto[];
}

export interface WeeklyReport {
  year: number;
  prev_year: number;
  last_actual_week: number;
  weeks_in_year: number;
  trend: { tonnes: number; calls: number };
  weeks: {
    week: number;
    kind: 'faktisk' | 'prognose';
    tonnes_prev: number;
    calls_prev: number;
    tonnes: number | null;
    calls: number | null;
    forecast_tonnes: number | null;
    forecast_calls: number | null;
  }[];
  totals: {
    ytd_tonnes: number;
    ytd_tonnes_prev: number;
    ytd_calls: number;
    ytd_calls_prev: number;
    forecast_tonnes: number;
    forecast_tonnes_prev: number;
    forecast_calls: number;
  };
  outlook: {
    next4_tonnes: number;
    next4_tonnes_prev: number;
    busiest_week: number | null;
    busiest_calls: number;
    busiest_tonnes: number;
    busiest_calls_prev: number;
    busiest_tonnes_prev: number;
  };
}

export interface ProductReportRow {
  product_id: string;
  name: string;
  packaging: string;
  ytd_tonnes: number;
  ytd_tonnes_prev: number;
  forecast_tonnes: number;
  forecast_tonnes_prev: number;
  /** Uke 1–N: fjoråret, og i år (faktisk + prognose). */
  series_prev: number[];
  series: number[];
}

export interface ProductReport {
  year: number;
  last_actual_week: number;
  rows: ProductReportRow[];
}

export interface QualityReport {
  punctuality: { year: number; week: number; calls: number; on_time: number; share: number | null }[];
  deviations: { total_logs: number; with_deviation: number; categories: { category: Category; count: number }[] };
  boat_ratings: { id: string; name: string; avg_total: number; rating_count: number }[];
}

export interface AisVessel {
  mmsi: string;
  boat_id: string;
  name: string;
  flag: Flag;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  ais_ts: string;
  fetched_at: string;
  in_geofence: boolean;
  /** [lon, lat] siste 12 minutter. */
  track: [number, number][];
}

export interface AisView {
  status: { checked_at: string; ok: boolean; configured: boolean; message: string | null; boats: number; positions: number } | null;
  vessels: AisVessel[];
  /** Alle fartøy i området rundt kaia, også de som ikke er i båtregisteret. */
  area: AreaVessel[];
}

/** Fartøy i trafikkbildet rundt kaia (BarentsWatch, modelType Full). */
export interface AreaVessel {
  mmsi: string;
  name: string | null;
  callsign: string | null;
  imo: string | null;
  /** AIS skipstype (0–99). */
  ship_type: number | null;
  length: number | null;
  width: number | null;
  draught: number | null;
  destination: string | null;
  country: string | null;
  lat: number;
  lon: number;
  /** Knop. */
  sog: number | null;
  cog: number | null;
  heading: number | null;
  nav_status: number | null;
  /** Tidspunkt for siste AIS-melding. */
  ts: string;
  /** [lon, lat, unix-sekunder] de siste minuttene. */
  trail: [number, number, number][];
}

/** Fartøy langs hele kysten innenfor et kartutsnitt (uten spor). */
export interface AisCoast {
  vessels: AreaVessel[];
  error: string | null;
}

/** Spor siste 24 timer for ett fartøy. */
export interface AisTrack {
  mmsi: string;
  /** [lon, lat] eldste først. */
  points: [number, number][];
  error: string | null;
}

export interface PhotoUpload {
  id: string;
  url: string;
  thumb_url: string | null;
}

// ---------------------------------------------------------------- biler, bulk, produksjon

export interface TruckOrderView {
  id: string;
  customer: string;
  carrier: string | null;
  reg_no: string | null;
  /** SO-nummer fra Dynamics 365. */
  so_number: string;
  expected_date: string;
  notes: string | null;
  goods: { id: string; sku_id: string; product_name: string; unit: 'BB' | 'pall'; quantity: number; tonnes: number; label: string }[];
  tonnes: number;
  picked_up_at: string | null;
  picked_up_by: UserRef | null;
  cancelled_at: string | null;
  created_at: string;
}

export interface BulkQuality { id: string; name: string; color: string }

export interface BulkOrderView {
  id: string;
  /** Reg.nr. (og beskrivelse) på bilen. */
  truck: string;
  /** Kundens navn (eldre bestillinger: fritekst). */
  destination: string | null;
  /** Brukeren som bestilte på kontoret (eldre bestillinger). */
  driver: UserRef | null;
  status: 'bestilt' | 'lastes' | 'ferdig' | 'avlyst';
  expected_at: string | null;
  notes: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  total_tonnes: number;
  /** Sum veid tonn (når stegene er veid). */
  weighed_tonnes: number | null;
  driver_profile: { id: string; name: string; phone: string } | null;
  vehicle: { id: string; reg_no: string; description: string | null } | null;
  hauler: { id: string; name: string; own: boolean } | null;
  customer: { id: string; name: string } | null;
  project_no: string | null;
  so_number: string | null;
  /** Nødstopp trykket (og ikke fortsatt). */
  stopped_at: string | null;
  /** Følgeseddel nr. (når lastingen er ferdig). */
  delivery_no: number | null;
  has_pdf: boolean;
  booked_by: 'sjafor' | 'kontor';
  steps: {
    id: string; seq: number; quality_id: string; quality_name: string; color: string; tonnes: number;
    target: 'bil' | 'henger' | null; started_at: string | null; finished_at: string | null; weighed_tonnes: number | null;
  }[];
}

export interface Hauler { id: string; name: string; own: boolean; phone: string | null; active: boolean }
export interface BulkCustomer { id: string; name: string; requires_project: boolean; email: string | null; notes: string | null; active: boolean }
export interface DriverProfile {
  id: string; name: string; phone: string; hauler: { id: string; name: string; own: boolean }; lang: string; active: boolean;
  has_pin: boolean; last_login_at: string | null;
}
export interface Vehicle { id: string; reg_no: string; hauler_id: string; description: string | null; has_trailer: boolean; active: boolean }
export interface BulkRegistry { haulers: Hauler[]; customers: BulkCustomer[]; drivers: DriverProfile[]; vehicles: Vehicle[] }

export interface BulkLogEntry { id: number; at: string; kind: string; data: Record<string, unknown>; by: string | null }

/** Én veiing (ett ferdig steg). */
export interface BulkWeighing {
  step_id: string; order_id: string; at: string; delivery_no: number | null; quality_name: string; color: string; target: 'bil' | 'henger' | null;
  ordered: number; weighed: number | null; vehicle: string; driver: string | null; hauler: string | null; customer: string | null;
  project_no: string | null; so_number: string | null;
}

export type BulkGroup = 'kvalitet' | 'kunde' | 'bil' | 'sjafor' | 'transportor' | 'prosjekt' | 'dag';
export interface BulkReportRow { key: string; label: string; loads: number; ordered: number; weighed: number; minutes_avg: number | null }
export interface BulkReport { from: string; to: string; group: BulkGroup; rows: BulkReportRow[]; total: Omit<BulkReportRow, 'key' | 'label'> }

/** Sjåførvisningen: sjåføren, bilene til transportfirmaet, kunder, kvaliteter og sjåførens bestillinger. */
export interface DriverMe {
  driver: { id: string; name: string; phone: string; lang: string; hauler: { id: string; name: string } };
  vehicles: Vehicle[];
  customers: { id: string; name: string; requires_project: boolean }[];
  qualities: BulkQuality[];
  orders: BulkOrderView[];
  /** Hjelp med Claude er tilgjengelig. */
  ai: boolean;
}

export interface ProductionOrderView {
  id: string;
  line_id: string;
  product_id: string;
  product_name: string;
  tonnes: number;
  status: 'planlagt' | 'pakker' | 'ferdig' | 'avlyst';
  sort: number;
  notes: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface PackingLineView {
  id: string;
  name: string;
  silo_capacity_t: number;
  rate_tph: number;
  active_order: ProductionOrderView | null;
  queue: ProductionOrderView[];
  done_today: ProductionOrderView[];
  filled_for_order: number;
  last_fill: { tonnes: number; filled_at: string; by: string | null } | null;
}

// ---------------------------------------------------------------- globalt søk

/** Fartøy fra AIS (Kystverket via BarentsWatch), også båter som ikke er i båtregisteret. */
export interface ExternalVessel {
  mmsi: string;
  name: string | null;
  callsign: string | null;
  imo: string | null;
  ship_type: string | null;
  length: number | null;
  width: number | null;
  draught: number | null;
  destination: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  sog: number | null;
  seen_at: string | null;
  /** Båten finnes allerede i båtregisteret. */
  boat_id: string | null;
}

export interface SearchBulk {
  id: string; truck: string; destination: string | null; status: string; delivery_no: number | null; project_no: string | null; at: string;
}

/** En jobb Claude foreslår i Flow; brukeren bekrefter før den gjøres. */
export interface AskAction {
  id: number; kind: string; summary: string; details: string[];
  status: 'foreslatt' | 'utfort' | 'avbrutt' | 'feilet'; link: string | null; error: string | null;
}
/** Tidligere spørsmål og svar i samme samtale (for oppfølgingsspørsmål). */
export interface AskTurn { role: 'user' | 'assistant'; content: string }
/** Svar fra «Spør Flow». */
export interface AskAnswer { question: string; answer: string; tools: string[]; actions: AskAction[] }
/** Morgenbrief: første gang man åpner Flow hver dag. */
export interface MorningBrief { day: string; text: string }
/** Kaibok skrevet med egne ord, tolket av Claude (brukeren godkjenner). */
export interface KaibokDraft {
  had_deviation: boolean; categories: string[]; r_punctuality: number; r_cooperation: number; r_equipment: number;
  description: string | null; boat_note: string | null;
}
/** Rapport med forklaringer fra Claude for en periode. */
export interface AiReport { from: string; to: string; text: string; created_at: string }
/** Oversatt fritekst: null = allerede på leserens språk (eller kunne ikke oversettes). */
export interface Translation { text: string | null; source_lang: string | null }

export interface SearchResult {
  q: string;
  boats: { id: string; name: string; mmsi: string | null; flag: Flag }[];
  calls: { id: string; boat_name: string; service_date: string; eta: string; time_known: boolean; type: CallType | 'begge'; status: CallStatus }[];
  orders: { id: string; so_number: string; customer: string; status: OrderStatus; boat_name: string | null; service_date: string | null }[];
  trucks: { id: string; so_number: string; customer: string; expected_date: string; reg_no: string | null; picked_up: boolean }[];
  bulk: SearchBulk[];
  users: { id: string; name: string; title: string | null; phone: string | null }[];
  vessels: ExternalVessel[];
  /** Prefiks som avgrenser søket («båt:», «so:», «bil:», «sjåfør:», «kunde:», «kai:», «person:»). */
  scope: SearchScope | null;
  /** Dato eller periode i søket («i morgen», «fredag», «uke 43»): det som skjer da. */
  agenda: { from: string; to: string; calls: SearchResult['calls']; trucks: SearchResult['trucks']; bulk: SearchBulk[] } | null;
  /** Biler (reg.nr.) fra bulkregisteret, med lastinger i dag og totalt. */
  vehicles: { id: string; reg_no: string; description: string | null; hauler: string; today: number; total: number; last_at: string | null }[];
  /** Prosjektnumre på bulkleveranser. */
  projects: { project_no: string; customer: string | null; loads: number; tonnes: number }[];
  drivers: { id: string; name: string; phone: string; hauler: string }[];
  agents: { id: string; name: string; phone: string | null }[];
  /** Hvorfor AIS-søket ikke ga svar (ikke satt opp, feil fra BarentsWatch), ellers null. */
  ais_error: string | null;
}
