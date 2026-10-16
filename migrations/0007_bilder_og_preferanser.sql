-- Hver brukers egne valg (f.eks. periode på kaiplanen), som JSON.
ALTER TABLE users ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}';

-- Bilder av båten i båtregisteret: rampe, sideport, heis, lasterom osv., så alle vet hva de kommer til.
CREATE TABLE boat_photos (
  id           TEXT PRIMARY KEY,
  boat_id      TEXT NOT NULL REFERENCES boats(id) ON DELETE CASCADE,
  r2_key       TEXT NOT NULL,
  thumb_key    TEXT,
  content_type TEXT NOT NULL,
  width        INTEGER,
  height       INTEGER,
  bytes        INTEGER,
  category     TEXT NOT NULL DEFAULT 'annet' CHECK (category IN ('rampe', 'sideport', 'heis', 'lasterom', 'dekk', 'kran', 'annet')),
  caption      TEXT,
  uploaded_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX boat_photos_boat ON boat_photos (boat_id, created_at);
