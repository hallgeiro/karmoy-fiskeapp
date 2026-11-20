-- Startdata: fem vann i Karmøy kommune.
--
-- Navn og koordinater er hentet fra Kartverkets stedsnavnregister (SSR,
-- ws.geonorge.no/stedsnavn, EUREF89/WGS84) 20.11.2026. Stedsnummer står i hver rad.
--
-- Arter, fiskekort, parkering og vasspest-forbud er IKKE fylt inn fordi vi ikke
-- har en pålitelig kilde ennå. Sjekk med fiskekortselger / Karmøy kommune og
-- sett data_verifisert = 1 når en rad er kontrollert.
--
-- Området er anslått ut fra koordinatene og bør også kontrolleres.
--
-- Kan kjøres flere ganger: radene erstattes på id.
INSERT OR REPLACE INTO fiskevann
	(id, navn, omrade, lat, lng, arter, fiskekort_info, parkering_info, forbud_vasspest, beskrivelse, data_verifisert)
VALUES
	-- SSR stedsnummer 366102
	(1, 'Stiklevatnet', 'Øst-Karmøy', 59.21984, 5.27565, NULL, NULL, NULL, 0,
	 'Vann midt på sørlige del av Karmøy, sør for Buadalsvatna.', 0),
	-- SSR stedsnummer 123643
	(2, 'Aksnesvatnet', 'Fastlandet/Fosen', 59.38270, 5.35072, NULL, NULL, NULL, 0,
	 'Vann på fastlandssiden av Karmsundet.', 0),
	-- SSR stedsnummer 123956 (hovednavn Stora Fotvatnet, undernavn Fotvatn)
	(3, 'Fotvatnet (Stora Fotvatnet)', 'Øst-Karmøy', 59.29499, 5.27676, NULL, NULL, NULL, 0,
	 'Det største av Fotvatna nordvest for Kopervik. Midtra og Litla Fotvatnet ligger like øst for det.', 0),
	-- SSR stedsnummer 607048 (Øvre Buadalsvatnet, nr 183011, ligger ca. 700 m lenger sør)
	(4, 'Buadalsvatnet (Nedre)', 'Øst-Karmøy', 59.24171, 5.26718, NULL, NULL, NULL, 0,
	 'Nedre Buadalsvatnet i Buasdalen. Øvre Buadalsvatnet ligger like sør for det.', 0),
	-- SSR stedsnummer 244101
	(5, 'Hilleslandsvatnet', 'Øst-Karmøy', 59.18387, 5.27464, NULL, NULL, NULL, 0,
	 'Vann på sørlige Karmøy, nord for Skudeneshavn.', 0);
