-- Kaier hos nabobedrifter: company er NULL for egne kaier, ellers bedriftsnavn.
-- Navn er unikt per bedrift (Kai 1 hos oss og Kai 1 hos nabo er OK).

CREATE TABLE quays_new (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  company TEXT,
  sort    INTEGER NOT NULL DEFAULT 0,
  lat     REAL,
  lon     REAL,
  active  INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

INSERT INTO quays_new (id, name, company, sort, lat, lon, active)
SELECT id, name, NULL, sort, lat, lon, active FROM quays;

DROP TABLE quays;
ALTER TABLE quays_new RENAME TO quays;

CREATE UNIQUE INDEX quays_name_company ON quays (name, ifnull(company, ''));
