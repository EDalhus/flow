-- «Spør Flow»: spørsmål til Claude fra søkefeltet logges (hvem, spørsmål, svar, verktøy, tid og feil).
CREATE TABLE ai_questions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  question   TEXT NOT NULL,
  answer     TEXT,
  tools      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tools)),
  model      TEXT,
  ms         INTEGER,
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ai_questions_user ON ai_questions (user_id, created_at);
