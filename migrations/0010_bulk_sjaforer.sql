-- Bulkutlevering: registre for transportfirma, sjåfører, biler og kunder, egen innlogging for
-- sjåfører (telefon + PIN), veid tonn per steg, nødstopp, endringslogg og følgeseddel (PDF).

-- Transportfirma: oss selv eller firmaet som eier bilen.
CREATE TABLE haulers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  own        INTEGER NOT NULL DEFAULT 0 CHECK (own IN (0, 1)),
  phone      TEXT,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO haulers (id, name, own) VALUES ('h_egne', 'Egne biler', 1);

-- Kunder som får saltet. Noen krever prosjektnummer på hver utlevering.
CREATE TABLE bulk_customers (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  requires_project INTEGER NOT NULL DEFAULT 0 CHECK (requires_project IN (0, 1)),
  email            TEXT,                      -- følgeseddel sendes hit
  notes            TEXT,
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Sjåfører (egne og eksterne). Logger inn i sjåførvisningen med telefon + PIN; har ikke tilgang til resten av Flow.
CREATE TABLE drivers (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL UNIQUE,         -- bare sifre, med landkode (4740010203)
  hauler_id     TEXT NOT NULL REFERENCES haulers(id),
  pin_hash      TEXT,
  pin_salt      TEXT,
  lang          TEXT NOT NULL DEFAULT 'nb',
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  last_login_at TEXT,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Biler (reg.nr.), knyttet til transportfirma. Sjåføren velger hvilken han kjører i dag.
CREATE TABLE vehicles (
  id          TEXT PRIMARY KEY,
  reg_no      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  hauler_id   TEXT NOT NULL REFERENCES haulers(id),
  description TEXT,                           -- «Bil 2», «Scania med henger»
  has_trailer INTEGER NOT NULL DEFAULT 1 CHECK (has_trailer IN (0, 1)),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Innlogging i sjåførvisningen: token (lagres som hash) som utløper.
CREATE TABLE driver_sessions (
  token_hash TEXT PRIMARY KEY,
  driver_id  TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);

ALTER TABLE bulk_orders ADD COLUMN driver_profile_id TEXT REFERENCES drivers(id) ON DELETE SET NULL;
ALTER TABLE bulk_orders ADD COLUMN vehicle_id TEXT REFERENCES vehicles(id) ON DELETE SET NULL;
ALTER TABLE bulk_orders ADD COLUMN customer_id TEXT REFERENCES bulk_customers(id) ON DELETE SET NULL;
ALTER TABLE bulk_orders ADD COLUMN project_no TEXT;
ALTER TABLE bulk_orders ADD COLUMN so_number TEXT;
-- Nødstopp: lastingen stoppes til sjåføren fortsetter eller kontoret avslutter.
ALTER TABLE bulk_orders ADD COLUMN stopped_at TEXT;
-- Følgeseddel: løpenummer og PDF i R2 (laget når lastingen er ferdig).
ALTER TABLE bulk_orders ADD COLUMN delivery_no INTEGER;
ALTER TABLE bulk_orders ADD COLUMN pdf_key TEXT;
ALTER TABLE bulk_orders ADD COLUMN booked_by TEXT;  -- 'sjafor' eller bruker-id på kontoret
CREATE UNIQUE INDEX bulk_orders_delivery_no ON bulk_orders (delivery_no) WHERE delivery_no IS NOT NULL;
CREATE INDEX bulk_orders_finished ON bulk_orders (finished_at);

-- Veid tonn per steg (bil/henger). Tastes inn av sjåføren nå; kommer fra vekta via API senere.
ALTER TABLE bulk_order_steps ADD COLUMN weighed_tonnes REAL;
ALTER TABLE bulk_order_steps ADD COLUMN weighed_source TEXT;  -- 'sjafor' | 'vekt' | 'kontor'

-- Endringslogg for bulkbestillinger: hvem (sjåfør eller bruker), når og hva.
CREATE TABLE bulk_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id  TEXT NOT NULL REFERENCES bulk_orders(id) ON DELETE CASCADE,
  user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL,
  kind      TEXT NOT NULL,
  data      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
  at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX bulk_log_order ON bulk_log (order_id, at);
