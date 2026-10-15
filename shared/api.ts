// Responstyper fra API-et. Brukes av frontend.
import type { Collision, Suggestion } from './domain/collisions.ts';
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

export interface PortCallView {
  id: string;
  type: CallType;
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
  kind: 'mention' | 'assigned' | 'collision' | 'quay_log';
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
  reference: string | null;
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
  truck: string;
  destination: string | null;
  driver: UserRef | null;
  status: 'bestilt' | 'lastes' | 'ferdig' | 'avlyst';
  expected_at: string | null;
  notes: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  total_tonnes: number;
  steps: {
    id: string; seq: number; quality_id: string; quality_name: string; color: string; tonnes: number;
    target: 'bil' | 'henger' | null; pause_after_sec: number; started_at: string | null; finished_at: string | null;
  }[];
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

export interface SearchResult {
  q: string;
  boats: { id: string; name: string; mmsi: string | null; flag: Flag }[];
  calls: { id: string; boat_name: string; service_date: string; eta: string; time_known: boolean; type: CallType; status: CallStatus }[];
  trucks: { id: string; customer: string; expected_date: string; reg_no: string | null; picked_up: boolean }[];
  bulk: { id: string; truck: string; destination: string | null; status: string }[];
  users: { id: string; name: string; title: string | null; phone: string | null }[];
  vessels: ExternalVessel[];
  /** Hvorfor AIS-søket ikke ga svar (ikke satt opp, feil fra BarentsWatch), ellers null. */
  ais_error: string | null;
}
