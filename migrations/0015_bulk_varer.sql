-- Løst bulksalt levert/hentet med båt: ny enhet «bulk» (tonn) ved siden av BB og pall.
-- CHECK på enheten kan ikke endres, så varetabellen bygges om. Tabellene som peker på varene (varelinjer på
-- ordre og varer på bilhentinger) bygges om sammen med den, så ingen rader blir stående uten vare underveis:
-- nye tabeller fylles først, de gamle slettes barn-før-forelder, og de nye får de gamle navnene.
PRAGMA defer_foreign_keys = on;

DROP VIEW port_call_goods;

CREATE TABLE skus_new (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id),
  unit          TEXT NOT NULL CHECK (unit IN ('BB', 'pall', 'bulk')),  -- bulk: antall = tonn
  bags_per_unit INTEGER,                    -- 40 / 42 for pall
  bag_kg        REAL,                       -- 25 for pall
  pallet_type   TEXT CHECK (pallet_type IN ('europall', 'srs')),
  kg_per_unit   REAL NOT NULL CHECK (kg_per_unit > 0),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort          INTEGER NOT NULL DEFAULT 0,
  CHECK ((unit = 'pall') = (pallet_type IS NOT NULL)),
  CHECK (unit <> 'pall' OR (bags_per_unit IS NOT NULL AND bag_kg IS NOT NULL))
);
INSERT INTO skus_new (id, product_id, unit, bags_per_unit, bag_kg, pallet_type, kg_per_unit, active, sort)
  SELECT id, product_id, unit, bags_per_unit, bag_kg, pallet_type, kg_per_unit, active, sort FROM skus;

CREATE TABLE order_lines_new (
  id             TEXT PRIMARY KEY,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  port_call_id   TEXT REFERENCES port_calls(id) ON DELETE SET NULL,
  sku_id         TEXT NOT NULL REFERENCES skus_new(id),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  direction      TEXT NOT NULL CHECK (direction IN ('inn', 'ut')),
  sort           INTEGER NOT NULL DEFAULT 0
);
INSERT INTO order_lines_new SELECT id, sales_order_id, port_call_id, sku_id, quantity, direction, sort FROM order_lines;

CREATE TABLE truck_order_goods_new (
  id       TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES truck_orders(id) ON DELETE CASCADE,
  sku_id   TEXT NOT NULL REFERENCES skus_new(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  sort     INTEGER NOT NULL DEFAULT 0
);
INSERT INTO truck_order_goods_new SELECT id, order_id, sku_id, quantity, sort FROM truck_order_goods;

DROP TABLE truck_order_goods;
DROP TABLE order_lines;
DROP TABLE skus;

ALTER TABLE skus_new RENAME TO skus;
ALTER TABLE order_lines_new RENAME TO order_lines;
ALTER TABLE truck_order_goods_new RENAME TO truck_order_goods;

CREATE UNIQUE INDEX skus_unique ON skus (product_id, unit, coalesce(pallet_type, ''));
CREATE INDEX order_lines_order ON order_lines (sales_order_id);
CREATE INDEX order_lines_call ON order_lines (port_call_id);
CREATE INDEX truck_order_goods_order ON truck_order_goods (order_id);

CREATE VIEW port_call_goods AS
  SELECT id, port_call_id, sku_id, quantity, direction, sort, sales_order_id FROM order_lines WHERE port_call_id IS NOT NULL;

-- Vei salt som produkt (når det finnes varer fra før), og bulk for Hav salt, Stein salt og Vei salt.
INSERT INTO products (id, name, sort)
  SELECT 'p_veisalt', 'Vei salt', coalesce(max(sort), 0) + 1 FROM products
  WHERE EXISTS (SELECT 1 FROM products) AND NOT EXISTS (SELECT 1 FROM products WHERE name = 'Vei salt');
INSERT INTO skus (id, product_id, unit, kg_per_unit, sort)
  SELECT 's_bulk_' || p.id, p.id, 'bulk', 1000, 100 + p.sort FROM products p
  WHERE p.name IN ('Hav salt', 'Stein salt', 'Vei salt') AND NOT EXISTS (SELECT 1 FROM skus s WHERE s.product_id = p.id AND s.unit = 'bulk');
