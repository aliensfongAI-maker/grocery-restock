-- Public state for 超市補貨 exclusions / holds / reclass.
-- Semantics match gas/Code.gs:
--   exclusions: one current row per type|name (exclude upserts, restore flips status)
--   holds: append held|unheld, latest at then id wins
--   overrides: append active|cleared, latest at then id wins

CREATE TABLE IF NOT EXISTS exclusions (
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('excluded', 'restored')),
  PRIMARY KEY (type, name)
);

CREATE INDEX IF NOT EXISTS exclusions_status ON exclusions (status);

CREATE TABLE IF NOT EXISTS holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('held', 'unheld'))
);

CREATE INDEX IF NOT EXISTS holds_lookup ON holds (type, name, at DESC, id DESC);

CREATE TABLE IF NOT EXISTS overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  old_type TEXT NOT NULL,
  name TEXT NOT NULL,
  new_type TEXT NOT NULL,
  new_subtype TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'cleared')),
  note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS overrides_lookup ON overrides (old_type, name, at DESC, id DESC);
