export const CREW_ROLES = ['truck', 'anhuker', 'kaikran'] as const;
export type CrewRole = (typeof CREW_ROLES)[number];
export type Capacity = Record<CrewRole, number>;

export const CREW_ROLE_LABEL: Record<CrewRole, string> = { truck: 'Trucksjåfør', anhuker: 'Anhuker', kaikran: 'Kaikran' };
export const CREW_ROLE_PLURAL: Record<CrewRole, string> = { truck: 'trucksjåfører', anhuker: 'anhukere', kaikran: 'kaikraner' };

export const USER_ROLES = ['salg', 'produksjon', 'kaiarbeider', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const FLAGS = ['green', 'yellow', 'red', 'none'] as const;
export type Flag = (typeof FLAGS)[number];
export const FLAG_LABEL: Record<Flag, string> = { green: 'Grønt', yellow: 'Gult varsel', red: 'Rødt flagg', none: 'Ingen historikk' };

export const CATEGORIES = ['skade_gods', 'utstyr_kran', 'mannskap_hms', 'forsinkelse', 'annet'] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  skade_gods: 'Skade på gods',
  utstyr_kran: 'Utstyr / kran',
  mannskap_hms: 'Mannskap / HMS',
  forsinkelse: 'Forsinkelse',
  annet: 'Annet',
};

export type CallType = 'levering' | 'henting';
export type Direction = 'inn' | 'ut';
export type CallStatus = 'planlagt' | 'paa_vei' | 'ved_kai' | 'kaibok_mangler' | 'ferdig' | 'avlyst';
export const STATUS_LABEL: Record<CallStatus, string> = {
  planlagt: 'Planlagt',
  paa_vei: 'På vei',
  ved_kai: 'Ved kai',
  kaibok_mangler: 'Kaibok mangler',
  ferdig: 'Ferdig',
  avlyst: 'Avlyst',
};

export interface FlagRules {
  red_avg_below: number;
  red_categories: Category[];
  red_lookback: number;
  yellow_avg_below: number;
  yellow_dimension_below: number;
}

export interface Settings {
  capacity: Capacity;
  geofence: { lat: number; lon: number; radius_m: number; label: string };
  flag_rules: FlagRules;
  postpone_buffer_minutes: number;
  punctuality_window_minutes: number;
  quay_log_missing_after_minutes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  capacity: { truck: 4, anhuker: 3, kaikran: 1 },
  geofence: { lat: 62.47918, lon: 6.19292, radius_m: 300, label: 'Flatholmen havn 81B' },
  flag_rules: { red_avg_below: 2.5, red_categories: ['skade_gods', 'mannskap_hms'], red_lookback: 2, yellow_avg_below: 3.5, yellow_dimension_below: 3.0 },
  postpone_buffer_minutes: 15,
  punctuality_window_minutes: 30,
  quay_log_missing_after_minutes: 60,
};
