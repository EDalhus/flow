-- Innkjøpsordre (PO) ved leveringer: ordren kan være SO (salg, 20 + fem siffer) eller PO (innkjøp, f.eks. PO-000123).
-- CHECK-en på nummeret kan ikke endres i SQLite, så tabellen bygges om. Tabellene som peker hit (varelinjer,
-- båt-koblinger og logg) har ON DELETE CASCADE, og DROP TABLE ville slettet radene deres. Derfor bygges de om
-- sammen: nye tabeller fylles først, de gamle slettes barn-før-forelder, og de nye får de gamle navnene.
-- Eksisterende ordre der alle varer går inn (levering) blir PO, med samme nummer.
PRAGMA defer_foreign_keys = on;

DROP VIEW port_call_goods;

CREATE TABLE sales_orders_new (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'SO' CHECK (kind IN ('SO', 'PO')),
  so_number     TEXT NOT NULL UNIQUE CHECK (
                  (kind = 'SO' AND length(so_number) = 7 AND so_number GLOB '20[0-9][0-9][0-9][0-9][0-9]')
               OR (kind = 'PO' AND length(so_number) BETWEEN 2 AND 20 AND so_number NOT GLOB '*[^A-Z0-9-]*')),
  customer      TEXT NOT NULL,                -- kunde (SO) eller leverandør (PO)
  seller_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  wanted_date   TEXT,
  notes         TEXT,
  cancelled_at  TEXT,
  cancel_reason TEXT,
  source        TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'import')),
  version       INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO sales_orders_new (id, kind, so_number, customer, seller_id, wanted_date, notes, cancelled_at, cancel_reason, source, version, created_by, created_at, updated_at)
  SELECT so.id,
         CASE WHEN EXISTS (SELECT 1 FROM order_lines l WHERE l.sales_order_id = so.id)
               AND NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.sales_order_id = so.id AND l.direction <> 'inn') THEN 'PO' ELSE 'SO' END,
         so.so_number, so.customer, so.seller_id, so.wanted_date, so.notes, so.cancelled_at, so.cancel_reason, so.source, so.version, so.created_by, so.created_at, so.updated_at
  FROM sales_orders so;

CREATE TABLE order_lines_new (
  id             TEXT PRIMARY KEY,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders_new(id) ON DELETE CASCADE,
  port_call_id   TEXT REFERENCES port_calls(id) ON DELETE SET NULL,
  sku_id         TEXT NOT NULL REFERENCES skus(id),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  direction      TEXT NOT NULL CHECK (direction IN ('inn', 'ut')),
  sort           INTEGER NOT NULL DEFAULT 0
);
INSERT INTO order_lines_new SELECT id, sales_order_id, port_call_id, sku_id, quantity, direction, sort FROM order_lines;

CREATE TABLE port_call_orders_new (
  port_call_id   TEXT NOT NULL REFERENCES port_calls(id) ON DELETE CASCADE,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders_new(id) ON DELETE CASCADE,
  load_seq       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (port_call_id, sales_order_id)
);
INSERT INTO port_call_orders_new SELECT port_call_id, sales_order_id, load_seq FROM port_call_orders;

CREATE TABLE order_log_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sales_order_id TEXT REFERENCES sales_orders_new(id) ON DELETE CASCADE,
  port_call_id   TEXT REFERENCES port_calls(id) ON DELETE SET NULL,
  user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL,
  data           TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
  at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO order_log_new SELECT id, sales_order_id, port_call_id, user_id, kind, data, at FROM order_log;

-- Barna først (de peker nå på sales_orders_new), så den gamle ordretabellen; ingen rader kaskaderes bort.
DROP TABLE order_log;
DROP TABLE port_call_orders;
DROP TABLE order_lines;
DROP TABLE sales_orders;

ALTER TABLE sales_orders_new RENAME TO sales_orders;
ALTER TABLE order_lines_new RENAME TO order_lines;
ALTER TABLE port_call_orders_new RENAME TO port_call_orders;
ALTER TABLE order_log_new RENAME TO order_log;

CREATE INDEX sales_orders_customer ON sales_orders (customer);
CREATE INDEX order_lines_order ON order_lines (sales_order_id);
CREATE INDEX order_lines_call ON order_lines (port_call_id);
CREATE INDEX port_call_orders_order ON port_call_orders (sales_order_id);
CREATE INDEX order_log_order ON order_log (sales_order_id, at);
CREATE INDEX order_log_call ON order_log (port_call_id, at);

CREATE VIEW port_call_goods AS
  SELECT id, port_call_id, sku_id, quantity, direction, sort, sales_order_id FROM order_lines WHERE port_call_id IS NOT NULL;
