-- Claude: sammendrag av båten før den kommer, månedsrapporter og hjelp i sjåførvisningen.

-- «Før båten kommer»: lages på nytt når grunnlaget (kaibøker, flagg, merknad) endres, eller etter en uke.
CREATE TABLE ai_boat_briefs (
  boat_id    TEXT NOT NULL REFERENCES boats(id) ON DELETE CASCADE,
  lang       TEXT NOT NULL,
  basis      TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (boat_id, lang)
) WITHOUT ROWID;

-- Rapport med forklaringer for en periode (lagres; «Lag på nytt» erstatter).
CREATE TABLE ai_reports (
  period_from TEXT NOT NULL,
  period_to   TEXT NOT NULL,
  lang        TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (period_from, period_to, lang)
) WITHOUT ROWID;

-- Spørsmål fra sjåfører (hjelp i sjåførvisningen) logges sammen med de andre.
ALTER TABLE ai_questions ADD COLUMN driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL;
