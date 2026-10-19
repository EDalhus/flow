-- Claude i Flow: jobber Claude foreslår og brukeren bekrefter, morgenbrief per rolle og dag,
-- og oversettelser av fritekst (lagres én gang per tekst og språk).

CREATE TABLE ai_actions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  summary    TEXT NOT NULL,
  details    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(details)),
  method     TEXT NOT NULL CHECK (method IN ('POST', 'PATCH')),
  path       TEXT NOT NULL,
  body       TEXT NOT NULL CHECK (json_valid(body)),
  status     TEXT NOT NULL DEFAULT 'foreslatt' CHECK (status IN ('foreslatt', 'utfort', 'avbrutt', 'feilet')),
  result     TEXT,
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  done_at    TEXT
);
CREATE INDEX ai_actions_user ON ai_actions (user_id, created_at);

-- Morgenbrief: én per dag og rollekombinasjon (f.eks. «kaiarbeider,produksjon»).
CREATE TABLE ai_briefs (
  day        TEXT NOT NULL,
  roles      TEXT NOT NULL,
  lang       TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (day, roles, lang)
) WITHOUT ROWID;
-- Hvem som har sett (eller lukket) dagens brief.
CREATE TABLE ai_brief_views (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
) WITHOUT ROWID;

-- Oversatt fritekst. hash = SHA-256 av originalteksten. text NULL = allerede på målspråket.
CREATE TABLE translations (
  hash        TEXT NOT NULL,
  lang        TEXT NOT NULL,
  source_lang TEXT,
  text        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (hash, lang)
) WITHOUT ROWID;
