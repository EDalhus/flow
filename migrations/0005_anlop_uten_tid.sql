-- Klokkeslett for anløp er valgfritt: tidene er sjelden kjent før ca. en time før båten
-- kommer. Uten tid lagres anløpet som hele dagen (00:00–23:59) med time_known = 0, og det
-- holdes utenfor kollisjonssjekken og tidsbasert status til tiden settes.
ALTER TABLE port_calls ADD COLUMN time_known INTEGER NOT NULL DEFAULT 1 CHECK (time_known IN (0, 1));
