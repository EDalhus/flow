-- Salgsordre (SO) er sannheten for hva som skal over kaia. Anløpet er båten som kommer:
-- én båt, én kai, én ETA. Et anløp kan ha mange SO-er, og en SO kan (sjelden) deles på flere
-- anløp – derfor ligger anløpet på hver ordrelinje. SO-nummeret kommer fra Dynamics 365.
PRAGMA defer_foreign_keys = on;

CREATE TABLE sales_orders (
  id            TEXT PRIMARY KEY,
  so_number     TEXT NOT NULL UNIQUE CHECK (length(so_number) = 7 AND so_number GLOB '20[0-9][0-9][0-9][0-9][0-9]'),
  customer      TEXT NOT NULL,
  seller_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  wanted_date   TEXT,                       -- ønsket dag fra ordren
  notes         TEXT,
  cancelled_at  TEXT,
  cancel_reason TEXT,
  source        TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'import')),
  version       INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX sales_orders_customer ON sales_orders (customer);

-- Varelinjer på ordren. port_call_id = anløpet linjen skal med (NULL = venter på båt).
CREATE TABLE order_lines (
  id             TEXT PRIMARY KEY,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  port_call_id   TEXT REFERENCES port_calls(id) ON DELETE SET NULL,
  sku_id         TEXT NOT NULL REFERENCES skus(id),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  direction      TEXT NOT NULL CHECK (direction IN ('inn', 'ut')),
  sort           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX order_lines_order ON order_lines (sales_order_id);
CREATE INDEX order_lines_call ON order_lines (port_call_id);

-- Hvilke SO-er et anløp har, og i hvilken rekkefølge de lastes/losses.
CREATE TABLE port_call_orders (
  port_call_id   TEXT NOT NULL REFERENCES port_calls(id) ON DELETE CASCADE,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  load_seq       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (port_call_id, sales_order_id)
);
CREATE INDEX port_call_orders_order ON port_call_orders (sales_order_id);

-- Endringslogg per SO: hvem, når og hva (fra–til). Endringer på anløpet (båt, ETA, kai)
-- skrives inn hos hver SO som ligger på anløpet, med port_call_id satt.
CREATE TABLE order_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sales_order_id TEXT REFERENCES sales_orders(id) ON DELETE CASCADE,
  port_call_id   TEXT REFERENCES port_calls(id) ON DELETE SET NULL,
  user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL,
  data           TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
  at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX order_log_order ON order_log (sales_order_id, at);
CREATE INDEX order_log_call ON order_log (port_call_id, at);

-- Eksisterende anløp (eksempeldata): én SO per anløp med varene, og et tilfeldig SO-nummer 20XXXXX.
-- Tallet er en permutasjon av rowid, så det blir aldri likt to ganger.
INSERT INTO sales_orders (id, so_number, customer, seller_id, wanted_date, source, created_by, created_at, updated_at)
SELECT 'so_' || pc.id,
       '20' || printf('%05d', (pc.rowid * 7919 + 4243) % 100000),
       CASE pc.rowid % 8
         WHEN 0 THEN 'Hessa Seafood' WHEN 1 THEN 'Vartdal Fisk' WHEN 2 THEN 'Fjordlaks' WHEN 3 THEN 'Ålesund Fiskemottak'
         WHEN 4 THEN 'Brødrene Sperre' WHEN 5 THEN 'Nordic Salt Trading' WHEN 6 THEN 'Sunnmøre Sild' ELSE 'Kystfisk AS' END,
       pc.seller_id, pc.service_date, pc.source, pc.created_by, pc.created_at, pc.updated_at
FROM port_calls pc
WHERE EXISTS (SELECT 1 FROM port_call_goods g WHERE g.port_call_id = pc.id);

INSERT INTO order_lines (id, sales_order_id, port_call_id, sku_id, quantity, direction, sort)
SELECT g.id, 'so_' || g.port_call_id, g.port_call_id, g.sku_id, g.quantity, g.direction, g.sort FROM port_call_goods g;

INSERT INTO port_call_orders (port_call_id, sales_order_id, load_seq)
SELECT DISTINCT g.port_call_id, 'so_' || g.port_call_id, 1 FROM port_call_goods g;

INSERT INTO order_log (sales_order_id, port_call_id, user_id, kind, data, at)
SELECT so.id, substr(so.id, 4), so.created_by, 'created', json_object('so_number', so.so_number), so.created_at
FROM sales_orders so WHERE so.source = 'app';

-- Varene bor nå på ordrelinjene. Rapporter og annet som leser port_call_goods ser linjene som ligger på et anløp.
DROP TABLE port_call_goods;
CREATE VIEW port_call_goods AS
  SELECT id, port_call_id, sku_id, quantity, direction, sort, sales_order_id FROM order_lines WHERE port_call_id IS NOT NULL;

-- Varsel til selgeren når noen andre endrer båt, ETA eller kai på ordren: ny type «order».
CREATE TABLE notifications_new (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('mention', 'assigned', 'collision', 'quay_log', 'order')),
  port_call_id TEXT REFERENCES port_calls(id) ON DELETE CASCADE,
  message_id   TEXT REFERENCES messages(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  read_at      TEXT
);
INSERT INTO notifications_new SELECT id, user_id, kind, port_call_id, message_id, text, created_at, read_at FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX notifications_user ON notifications (user_id, read_at, created_at);
