-- Fangstdagbok
CREATE TABLE IF NOT EXISTS catches (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	spot_id TEXT NOT NULL,
	species TEXT NOT NULL,
	weight_kg REAL,
	length_cm REAL,
	caught_at TEXT NOT NULL,
	note TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_catches_spot ON catches (spot_id, caught_at DESC);
CREATE INDEX IF NOT EXISTS idx_catches_caught_at ON catches (caught_at DESC);
