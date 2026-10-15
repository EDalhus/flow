-- Tre nye moduler (MVP): Biler, Bulkbil og Produksjon.
-- Verdier som siloenes nivå er beregnet foreløpig; tabellene er laget slik at målinger fra
-- sensorer og styring av lasteutstyr kan kobles på senere uten å endre datamodellen.

-- ---------------------------------------------------------------- Biler
-- Kundebiler som henter pall/BB. Forventet dag, ikke klokkeslett (for usikkert).

CREATE TABLE truck_orders (
  id            TEXT PRIMARY KEY,
  customer      TEXT NOT NULL,
  carrier       TEXT,                         -- transportør
  reg_no        TEXT,                         -- registreringsnummer, hvis kjent
  reference     TEXT,                         -- ordrenummer e.l.
  expected_date TEXT NOT NULL,                -- lokal dato i Oslo
  notes         TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  picked_up_at  TEXT,
  picked_up_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX truck_orders_date ON truck_orders (expected_date);

CREATE TABLE truck_order_goods (
  id       TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES truck_orders(id) ON DELETE CASCADE,
  sku_id   TEXT NOT NULL REFERENCES skus(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  sort     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX truck_order_goods_order ON truck_order_goods (order_id);

-- ---------------------------------------------------------------- Bulkbil
-- Egne lastebiler som henter salt i bulk. Sjåføren bestiller i steg (f.eks. henger + bil),
-- med valgfri pause mellom stegene for å posisjonere seg under neste trakt.

CREATE TABLE bulk_qualities (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  color  TEXT NOT NULL,                       -- farge i visningene
  sort   INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
INSERT INTO bulk_qualities (id, name, color, sort) VALUES
  ('havsalt',   'Havsalt',      '#80EFDE', 1),
  ('steinsalt', 'Steinsalt',    '#B1C2B7', 2),
  ('blandet',   'Blandet salt', '#F7B955', 3),
  ('veisalt',   'Veisalt',      '#9DB8FF', 4);

CREATE TABLE bulk_orders (
  id          TEXT PRIMARY KEY,
  truck       TEXT NOT NULL,                  -- bil/reg.nr, f.eks. «Bil 2 · SU 12345»
  destination TEXT,                           -- kunde/fiskebruk
  driver_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'bestilt' CHECK (status IN ('bestilt', 'lastes', 'ferdig', 'avlyst')),
  expected_at TEXT,                           -- når bilen er ved anlegget (valgfritt)
  notes       TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at  TEXT,
  finished_at TEXT
);
CREATE INDEX bulk_orders_created ON bulk_orders (created_at);

CREATE TABLE bulk_order_steps (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES bulk_orders(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  quality_id      TEXT NOT NULL REFERENCES bulk_qualities(id),
  tonnes          REAL NOT NULL CHECK (tonnes > 0 AND tonnes <= 60),
  target          TEXT CHECK (target IN ('bil', 'henger')),
  pause_after_sec INTEGER NOT NULL DEFAULT 0 CHECK (pause_after_sec BETWEEN 0 AND 1800),
  started_at      TEXT,                       -- kan ligge frem i tid: slutten av pausen før steget
  finished_at     TEXT,
  UNIQUE (order_id, seq)
);

-- ---------------------------------------------------------------- Produksjon
-- Pakkelinjer med silo som buffer. Nivået beregnes fra påfylling og pakkehastighet (MVP).

CREATE TABLE packing_lines (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  silo_capacity_t REAL NOT NULL DEFAULT 30 CHECK (silo_capacity_t > 0),
  rate_tph        REAL NOT NULL DEFAULT 10 CHECK (rate_tph > 0),   -- pakket tonn per time
  sort            INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
INSERT INTO packing_lines (id, name, silo_capacity_t, rate_tph, sort) VALUES
  ('linje1', 'Pakkelinje 1', 30, 10, 1),
  ('linje2', 'Pakkelinje 2', 30, 10, 2);

CREATE TABLE production_orders (
  id           TEXT PRIMARY KEY,
  line_id      TEXT NOT NULL REFERENCES packing_lines(id),
  product_id   TEXT NOT NULL REFERENCES products(id),
  tonnes       REAL NOT NULL CHECK (tonnes > 0),
  status       TEXT NOT NULL DEFAULT 'planlagt' CHECK (status IN ('planlagt', 'pakker', 'ferdig', 'avlyst')),
  sort         INTEGER NOT NULL DEFAULT 0,    -- rekkefølge i køen per linje
  notes        TEXT,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at   TEXT,
  finished_at  TEXT
);
CREATE INDEX production_orders_line ON production_orders (line_id, status, sort);

CREATE TABLE silo_fills (
  id                  TEXT PRIMARY KEY,
  line_id             TEXT NOT NULL REFERENCES packing_lines(id),
  production_order_id TEXT REFERENCES production_orders(id) ON DELETE SET NULL,
  product_id          TEXT REFERENCES products(id),
  tonnes              REAL NOT NULL CHECK (tonnes > 0 AND tonnes <= 60),
  filled_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
  filled_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX silo_fills_line ON silo_fills (line_id, filled_at);
