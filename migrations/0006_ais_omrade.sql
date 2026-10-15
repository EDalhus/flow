-- Alle fartøy i området rundt kaia (fra BarentsWatch), med spor de siste minuttene.
-- Én rad som skrives på nytt hvert minutt av AIS-synken, så kartet kan vise trafikken som Kystverket gjør.
CREATE TABLE ais_area (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
