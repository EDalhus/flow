-- Biler henter også på salgsordre fra Dynamics 365: ordrenummeret blir SO-nummeret (20 + fem siffer).
-- Eksempeldata uten gyldig SO-nummer får et tilfeldig 20XXXXX (permutasjon av rowid, aldri likt to ganger).
UPDATE truck_orders SET reference = '20' || printf('%05d', (rowid * 7919 + 777) % 100000)
WHERE reference IS NULL OR NOT (length(reference) = 7 AND reference GLOB '20[0-9][0-9][0-9][0-9][0-9]');
ALTER TABLE truck_orders RENAME COLUMN reference TO so_number;
CREATE UNIQUE INDEX truck_orders_so ON truck_orders (so_number);
