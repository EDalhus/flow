-- Flow: første skjema.
-- Tider lagres som ISO-8601 UTC ('2026-10-14T07:30:00.000Z').
-- service_date er lokal dato i Europe/Oslo ('2026-10-14') og brukes til dag- og vaktgruppering.
-- Status på anløp lagres IKKE; den utledes fra AIS-tider og kaibok (se shared/domain/status.ts).

-- ---------------------------------------------------------------- Folk og tilgang

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL,
  short_name  TEXT NOT NULL,                -- "Ola N." – brukes i lister og @-tagging
  initials    TEXT NOT NULL,
  title       TEXT,                         -- "Formann kai", "Planlegger" …
  phone       TEXT,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    TEXT NOT NULL CHECK (role IN ('salg', 'produksjon', 'kaiarbeider', 'admin')),
  PRIMARY KEY (user_id, role)
) WITHOUT ROWID;

-- Hvilke mannskapsroller en person kan fylle.
CREATE TABLE crew_skills (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  crew_role TEXT NOT NULL CHECK (crew_role IN ('truck', 'anhuker', 'kaikran')),
  PRIMARY KEY (user_id, crew_role)
) WITHOUT ROWID;

-- Vakt per dag. Kapasitet = antall på vakt per rolle; uten rader brukes settings.capacity.
CREATE TABLE shifts (
  service_date TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  crew_role    TEXT NOT NULL CHECK (crew_role IN ('truck', 'anhuker', 'kaikran')),
  PRIMARY KEY (service_date, user_id, crew_role)
) WITHOUT ROWID;

-- Nøkkel/verdi (JSON) for kapasitet, geofence, flaggterskler o.l.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value))
) WITHOUT ROWID;

-- ---------------------------------------------------------------- Båter

CREATE TABLE agents (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT
);

CREATE TABLE boats (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  imo          TEXT UNIQUE,
  mmsi         TEXT UNIQUE,
  callsign     TEXT,
  agent_id     TEXT REFERENCES agents(id) ON DELETE SET NULL,
  ship_contact TEXT,                        -- "Skipper", "Bro"
  ship_phone   TEXT,
  note         TEXT,                        -- merknad på båtprofilen

  -- Flagg: automatisk fra kaibøkene, kan overstyres med begrunnelse.
  flag_auto            TEXT NOT NULL DEFAULT 'none' CHECK (flag_auto IN ('green', 'yellow', 'red', 'none')),
  flag_auto_reason     TEXT,
  flag_override        TEXT CHECK (flag_override IN ('green', 'yellow', 'red', 'none')),
  flag_override_reason TEXT,
  flag_override_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  flag_override_at     TEXT,

  -- Snitt fra kaibøkene, oppdateres når en kaibok leveres.
  rating_count     INTEGER NOT NULL DEFAULT 0,
  avg_punctuality  REAL,
  avg_cooperation  REAL,
  avg_equipment    REAL,
  avg_total        REAL,
  last_log_at      TEXT,

  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (flag_override IS NULL OR length(trim(flag_override_reason)) > 0)
);

-- ---------------------------------------------------------------- Produkter

-- Produktfamilie; rapportene grupperer på denne.
CREATE TABLE products (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

-- Konkret vare slik den bestilles: BB, eller pall med pakning og palletype.
CREATE TABLE skus (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id),
  unit          TEXT NOT NULL CHECK (unit IN ('BB', 'pall')),
  bags_per_unit INTEGER,                    -- 40 / 42 for pall
  bag_kg        REAL,                       -- 25 for pall
  pallet_type   TEXT CHECK (pallet_type IN ('europall', 'srs')),
  kg_per_unit   REAL NOT NULL CHECK (kg_per_unit > 0),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort          INTEGER NOT NULL DEFAULT 0,
  CHECK ((unit = 'BB') = (pallet_type IS NULL)),
  CHECK (unit = 'BB' OR (bags_per_unit IS NOT NULL AND bag_kg IS NOT NULL))
);
CREATE UNIQUE INDEX skus_unique ON skus (product_id, unit, coalesce(pallet_type, ''));

-- ---------------------------------------------------------------- Anløp

CREATE TABLE quays (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  sort   INTEGER NOT NULL DEFAULT 0,
  lat    REAL,
  lon    REAL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE port_calls (
  id                  TEXT PRIMARY KEY,
  boat_id             TEXT NOT NULL REFERENCES boats(id),
  type                TEXT NOT NULL CHECK (type IN ('levering', 'henting')),
  quay_id             TEXT NOT NULL REFERENCES quays(id),
  eta                 TEXT NOT NULL,
  etd                 TEXT NOT NULL,
  service_date        TEXT NOT NULL,
  seller_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  boat_crane          INTEGER NOT NULL DEFAULT 0 CHECK (boat_crane IN (0, 1)),
  responsible_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes               TEXT,

  arrived_at   TEXT,                        -- inn i geofencen (AIS)
  departed_at  TEXT,                        -- ut av geofencen (AIS)
  completed_at TEXT,                        -- kaibok levert (eller importert historikk)
  cancelled_at TEXT,
  cancel_reason TEXT,

  -- 'import' = historikk uten kaibok (rapporter), 'app' = opprettet i Flow.
  source  TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'import')),
  version INTEGER NOT NULL DEFAULT 1,       -- optimistisk låsing ved samtidige endringer
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (etd > eta)
);
CREATE INDEX port_calls_date ON port_calls (service_date);
CREATE INDEX port_calls_quay_eta ON port_calls (quay_id, eta);
CREATE INDEX port_calls_boat_eta ON port_calls (boat_id, eta);

CREATE TABLE port_call_goods (
  id           TEXT PRIMARY KEY,
  port_call_id TEXT NOT NULL REFERENCES port_calls(id) ON DELETE CASCADE,
  sku_id       TEXT NOT NULL REFERENCES skus(id),
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  direction    TEXT NOT NULL CHECK (direction IN ('inn', 'ut')),
  sort         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX port_call_goods_call ON port_call_goods (port_call_id);

-- Ansvarlig ligger på port_calls.responsible_user_id (ikke flagg per slot), så det
-- aldri kan være to ansvarlige. API-et setter den automatisk når det bare er én slot.
CREATE TABLE crew_slots (
  id           TEXT PRIMARY KEY,
  port_call_id TEXT NOT NULL REFERENCES port_calls(id) ON DELETE CASCADE,
  crew_role    TEXT NOT NULL CHECK (crew_role IN ('truck', 'anhuker', 'kaikran')),
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  sort         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX crew_slots_call ON crew_slots (port_call_id);
CREATE INDEX crew_slots_user ON crew_slots (user_id);

-- ---------------------------------------------------------------- Chat og varsler

CREATE TABLE messages (
  id           TEXT PRIMARY KEY,
  port_call_id TEXT NOT NULL REFERENCES port_calls(id) ON DELETE CASCADE,
  author_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL DEFAULT 'user' CHECK (kind IN ('user', 'system')),
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX messages_call ON messages (port_call_id, created_at);

CREATE TABLE message_mentions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
) WITHOUT ROWID;

CREATE TABLE notifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('mention', 'assigned', 'collision', 'quay_log')),
  port_call_id TEXT REFERENCES port_calls(id) ON DELETE CASCADE,
  message_id   TEXT REFERENCES messages(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  read_at      TEXT
);
CREATE INDEX notifications_user ON notifications (user_id, read_at, created_at);

-- ---------------------------------------------------------------- Kaibok

CREATE TABLE quay_logs (
  id             TEXT PRIMARY KEY,
  port_call_id   TEXT NOT NULL UNIQUE REFERENCES port_calls(id) ON DELETE CASCADE,
  had_deviation  INTEGER NOT NULL CHECK (had_deviation IN (0, 1)),
  description    TEXT,
  r_punctuality  INTEGER NOT NULL CHECK (r_punctuality BETWEEN 1 AND 5),
  r_cooperation  INTEGER NOT NULL CHECK (r_cooperation BETWEEN 1 AND 5),
  r_equipment    INTEGER NOT NULL CHECK (r_equipment BETWEEN 1 AND 5),
  boat_note      TEXT,
  delivered_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  delivered_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX quay_logs_delivered ON quay_logs (delivered_at);

CREATE TABLE quay_log_categories (
  quay_log_id TEXT NOT NULL REFERENCES quay_logs(id) ON DELETE CASCADE,
  category    TEXT NOT NULL CHECK (category IN ('skade_gods', 'utstyr_kran', 'mannskap_hms', 'forsinkelse', 'annet')),
  PRIMARY KEY (quay_log_id, category)
) WITHOUT ROWID;

-- Bilder lastes opp før kaiboka lagres (quay_log_id er NULL til da).
CREATE TABLE quay_log_photos (
  id           TEXT PRIMARY KEY,
  port_call_id TEXT NOT NULL REFERENCES port_calls(id) ON DELETE CASCADE,
  quay_log_id  TEXT REFERENCES quay_logs(id) ON DELETE CASCADE,
  r2_key       TEXT NOT NULL UNIQUE,
  thumb_key    TEXT,
  content_type TEXT NOT NULL,
  width        INTEGER,
  height       INTEGER,
  bytes        INTEGER,
  uploaded_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX quay_log_photos_call ON quay_log_photos (port_call_id);

-- ---------------------------------------------------------------- AIS (fylles senere)

CREATE TABLE ais_positions (
  mmsi        TEXT PRIMARY KEY,
  boat_id     TEXT REFERENCES boats(id) ON DELETE CASCADE,
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  sog         REAL,
  cog         REAL,
  heading     REAL,
  nav_status  INTEGER,
  ais_ts      TEXT NOT NULL,
  fetched_at  TEXT NOT NULL,
  in_geofence INTEGER NOT NULL DEFAULT 0 CHECK (in_geofence IN (0, 1))
);

CREATE TABLE ais_track (
  mmsi TEXT NOT NULL,
  ts   TEXT NOT NULL,
  lat  REAL NOT NULL,
  lon  REAL NOT NULL,
  sog  REAL,
  PRIMARY KEY (mmsi, ts)
) WITHOUT ROWID;

-- ---------------------------------------------------------------- Revisjon

CREATE TABLE audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  entity    TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action    TEXT NOT NULL,
  diff      TEXT CHECK (diff IS NULL OR json_valid(diff)),
  at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX audit_log_entity ON audit_log (entity, entity_id);
