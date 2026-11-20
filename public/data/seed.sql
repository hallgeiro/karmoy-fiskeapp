-- versjon: 1cdbf557
-- GENERERT av scripts/hent-vann.mjs – ikke rediger for hånd.
-- Endre konfigurasjonen i skriptet og kjør `npm run vann:hent` på nytt.
--
-- Ferskvann i Karmøy kommune (1149) fra OpenStreetMap, data per 2026-11-20.
-- Kartdata © OpenStreetMap-bidragsytere, ODbL 1.0.
-- 0 vann: 0 fiskekort, 0 forbud (vasspest), 0 forbud (drikkevann), 0 ukjent grunneier.
DROP TABLE IF EXISTS ferskvann;
CREATE TABLE ferskvann (
	id          TEXT PRIMARY KEY,  -- OSM-id: 'w123' (way) eller 'r456' (relation)
	navn        TEXT NOT NULL,
	status      TEXT NOT NULL DEFAULT 'ukjent_grunneier'
	            CHECK (status IN ('fiskekort', 'ukjent_grunneier', 'forbud_vasspest', 'forbud_drikkevann')),
	sone        TEXT CHECK (sone IS NULL OR sone IN ('Vest-Karmøy', 'Øst-Karmøy', 'Avaldsnes', 'Fastlandet/Fosen')),
	lat         REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),    -- markørpunkt inne i vannet
	lng         REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
	areal_m2    REAL,
	geometri    TEXT,  -- GeoJSON Polygon/MultiPolygon (forenklet)
	salg        TEXT,  -- JSON: [{ "type": "vipps"|"butikk", "navn": "...", "nummer"?, "sted"?, "lenke"? }]
	advarsel    TEXT,  -- vises øverst i infoboksen for forbudsvann
	arter       TEXT,  -- kommaseparert, f.eks. 'ørret, røye'
	beskrivelse TEXT,
	CHECK (status <> 'fiskekort' OR sone IS NOT NULL),
	CHECK (status NOT LIKE 'forbud_%' OR advarsel IS NOT NULL)
);
CREATE INDEX idx_ferskvann_status ON ferskvann (status);
