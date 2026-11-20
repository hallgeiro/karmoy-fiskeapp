-- Ferskvann i Karmøy kommune.
-- Kjør lokalt:  npm run db:setup
-- Kjør i sky:   npm run db:setup:remote
CREATE TABLE IF NOT EXISTS fiskevann (
	id               INTEGER PRIMARY KEY,
	navn             TEXT    NOT NULL,
	omrade           TEXT    NOT NULL CHECK (omrade IN ('Vest-Karmøy', 'Øst-Karmøy', 'Avaldsnes', 'Fastlandet/Fosen')),
	lat              REAL    NOT NULL CHECK (lat BETWEEN -90 AND 90),
	lng              REAL    NOT NULL CHECK (lng BETWEEN -180 AND 180),
	arter            TEXT,                -- kommaseparert, f.eks. 'ørret, røye'
	fiskekort_info   TEXT,
	parkering_info   TEXT,
	forbud_vasspest  INTEGER NOT NULL DEFAULT 0 CHECK (forbud_vasspest IN (0, 1)),
	beskrivelse      TEXT,
	-- 1 når arter, fiskekort, parkering og forbud er sjekket mot en pålitelig kilde
	data_verifisert  INTEGER NOT NULL DEFAULT 0 CHECK (data_verifisert IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_fiskevann_omrade ON fiskevann (omrade);
