import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
	behandle,
	finnVann,
	kobleStatus,
	lagSeedSql,
	merkepunkt,
	settSammenRinger,
	behandleVann,
	gbifArterPerVann,
	leggTilGbifArter,
	vannFraSsr,
	sqlVerdi,
	vannFraElement,
} from "../scripts/hent-vann.mjs";

const p = (lat, lon) => ({ lat, lon });
/** Kvadrat rundt (lat, lon) med halv side d grader. */
const kvadrat = (lat, lon, d) => [p(lat - d, lon - d), p(lat - d, lon + d), p(lat + d, lon + d), p(lat + d, lon - d), p(lat - d, lon - d)];

// Liten, håndlaget Overpass-respons (out geom)
const OVERPASS = {
	osm3s: { timestamp_osm_base: "2026-11-20T08:00:00Z" },
	elements: [
		{ type: "way", id: 1, tags: { natural: "water", name: "Stiklevatnet" }, geometry: kvadrat(59.22, 5.27, 0.002) },
		{ type: "way", id: 2, tags: { natural: "water", water: "lake", name: "Fotvatnet" }, geometry: kvadrat(59.29, 5.27, 0.001) },
		// Samme navn to steder
		{ type: "way", id: 3, tags: { natural: "water", name: "Storavatnet" }, geometry: kvadrat(59.3, 5.2, 0.001) },
		{ type: "way", id: 4, tags: { natural: "water", name: "Storavatnet" }, geometry: kvadrat(59.35, 5.3, 0.001) },
		// Skal ikke med: elv, uten navn, åpen ring
		{ type: "way", id: 5, tags: { natural: "water", water: "river", name: "Elva" }, geometry: kvadrat(59.25, 5.25, 0.001) },
		{ type: "way", id: 6, tags: { natural: "water" }, geometry: kvadrat(59.26, 5.26, 0.0005) },
		{ type: "way", id: 7, tags: { natural: "water", name: "Åpen" }, geometry: kvadrat(59.27, 5.27, 0.001).slice(0, 4) },
		// Drikkevann som relation: ytre ring i to biter (den ene snudd), og ei øy
		{
			type: "relation",
			id: 10,
			tags: { type: "multipolygon", natural: "water", water: "reservoir", name: "Drikkevatnet" },
			members: [
				{ type: "way", ref: 11, role: "outer", geometry: [p(59.2, 5.3), p(59.2, 5.32), p(59.22, 5.32)] },
				{ type: "way", ref: 12, role: "outer", geometry: [p(59.2, 5.3), p(59.22, 5.3), p(59.22, 5.32)] },
				{ type: "way", ref: 13, role: "inner", geometry: kvadrat(59.21, 5.31, 0.002) },
			],
		},
		// Medlem av relation 10 som også er tagget som vann – skal ikke telle dobbelt
		{ type: "way", id: 11, tags: { natural: "water", name: "Drikkevatnet" }, geometry: [p(59.2, 5.3), p(59.2, 5.32), p(59.22, 5.32)] },
	],
};

const GODKJENTE = [
	{ navn: "Stiklevatn", sone: "Vest-Karmøy" }, // navnevariant
	{ navn: "Fotvatnet", sone: "Øst-Karmøy", arter: "ørret, røye" },
	{ navn: "Storavatnet", sone: "Avaldsnes" }, // tvetydig → advarsel
	{ navn: "Finnesikke", sone: "Avaldsnes" },
];
const FORBUD = [{ navn: "Drikkevatnet", status: "forbud_drikkevann" }];
const SALG = { "Vest-Karmøy": [{ type: "vipps", navn: "Vipps", nummer: "629636" }], "Øst-Karmøy": [], Avaldsnes: [], "Fastlandet/Fosen": [] };

const kjør = () => behandle(OVERPASS, { godkjente: GODKJENTE, forbud: FORBUD, salgPerSone: SALG });

describe("geometri", () => {
	it("setter sammen ringer av biter i begge retninger", () => {
		const { ringer, åpne } = settSammenRinger([
			[[0, 0], [1, 0], [1, 1]],
			[[0, 0], [0, 1], [1, 1]],
			[[5, 5], [6, 6]],
		]);
		expect(ringer).toHaveLength(1);
		expect(ringer[0]).toHaveLength(5);
		expect(ringer[0][0]).toEqual(ringer[0][4]);
		expect(åpne).toBe(1);
	});

	it("legger markøren inne i vannet, også for U-formede vann", () => {
		const u = [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]];
		const [x, y] = merkepunkt({ ytre: u, indre: [] });
		const iBen = (x < 1 || x > 2) || y < 1;
		expect(iBen).toBe(true);
	});

	it("regner areal minus øyer og lager MultiPolygon/Polygon", () => {
		const v = vannFraElement(OVERPASS.elements.find((e) => e.id === 10));
		expect(v.id).toBe("r10");
		expect(v.geometri.type).toBe("Polygon");
		expect(v.geometri.coordinates).toHaveLength(2); // ytre + øy
		// ~1140 m × 2220 m minus øy ~228 m × 444 m
		expect(v.areal_m2).toBeGreaterThan(2_300_000);
		expect(v.areal_m2).toBeLessThan(2_500_000);
	});
});

describe("behandle + kobleStatus", () => {
	it("tar bare med navngitte innsjøer, uten duplikater", () => {
		const { rader, utenNavn, ugyldig } = kjør();
		expect(rader.map((r) => r.id).sort()).toEqual(["r10", "w1", "w2", "w3", "w4"]);
		expect(utenNavn).toBe(1);
		expect(ugyldig).toBe(1);
	});

	it("gir ukjent_grunneier som standard og kobler godkjente og forbud", () => {
		const { rader, advarsler } = kjør();
		const r = Object.fromEntries(rader.map((x) => [x.id, x]));
		expect(r.w1).toMatchObject({ status: "fiskekort", sone: "Vest-Karmøy", salg: SALG["Vest-Karmøy"] });
		expect(r.w2).toMatchObject({ status: "fiskekort", sone: "Øst-Karmøy", salg: [], arter: "ørret, røye" });
		expect(r.w3.status).toBe("ukjent_grunneier");
		expect(r.w4.status).toBe("ukjent_grunneier");
		expect(r.r10.status).toBe("forbud_drikkevann");
		expect(r.r10.advarsel).toMatch(/drikkevann/i);

		expect(advarsler.some((a) => a.includes("Storavatnet") && a.includes("2 vann"))).toBe(true);
		expect(advarsler.some((a) => a.includes("Finnesikke") && a.includes("fant ikke"))).toBe(true);
		expect(kjør().merknader.some((a) => a.includes("Øst-Karmøy") && a.includes("Ingen salgsinfo"))).toBe(true);
	});

	it("osm-id løser tvetydige navn, og forbud vinner over fiskekort", () => {
		const vann = kjør().rader;
		expect(finnVann({ navn: "Storavatnet", osm: "w4" }, vann).treff[0].id).toBe("w4");
		const { rader, advarsler } = kobleStatus(vann, {
			godkjente: [{ navn: "Stiklevatnet", sone: "Vest-Karmøy" }],
			forbud: [{ navn: "Stiklevatnet", status: "forbud_vasspest", advarsel: "Vasspest!" }],
			salgPerSone: SALG,
		});
		expect(rader.find((r) => r.id === "w1")).toMatchObject({ status: "forbud_vasspest", advarsel: "Vasspest!", salg: null });
		expect(advarsler.join()).toMatch(/forbudet gjelder/);
	});
});

describe("kobling via punkt", () => {
	it("finner vannet punktet ligger i, også med annet navn, og slår sammen to oppføringer", () => {
		const vann = kjør().rader;
		const { rader, advarsler, merknader } = kobleStatus(vann, {
			godkjente: [
				{ nr: 17, navn: "Storavatn Nord", sone: "Vest-Karmøy", punkt: [59.3005, 5.2005], adkomst: "Nordfra." },
				{ nr: 16, navn: "Storavatnet", sone: "Øst-Karmøy", punkt: [59.2995, 5.1995], adkomst: "Sørfra." },
				{ nr: 3, navn: "Feilnavn", sone: "Avaldsnes", punkt: [59.3502, 5.3] }, // innenfor w4
				{ nr: 4, navn: "Langt unna", sone: "Avaldsnes", punkt: [59.0, 5.0] },
			],
			forbud: [{ navn: "Drikkevatnet", status: "forbud_annet", punkt: [59.205, 5.305] }],
			salgPerSone: SALG,
		});
		const r = Object.fromEntries(rader.map((x) => [x.id, x]));
		expect(r.w3).toMatchObject({ status: "fiskekort", sone: "Øst-Karmøy", kartnr: "16, 17" });
		expect(r.w3.adkomst).toBe("Sørfra. Storavatn Nord: Nordfra.");
		expect(r.w3.beskrivelse).toMatch(/Storavatn Nord \(nr. 17\) hører til fiskekortområdet Vest-Karmøy/);
		expect(r.w4).toMatchObject({ status: "fiskekort", kartnr: "3" });
		expect(merknader.join()).toMatch(/nr. 3 «Feilnavn».*«Storavatnet» \(w4\)/);
		expect(advarsler).toEqual([]);
		expect(merknader.join()).toMatch(/nr. 4 «Langt unna»: finnes ikke i datasettet – lagt inn fra konfigurasjonen/);
		// punkt inne i Drikkevatnet (relation med øy)
		expect(r.r10.status).toBe("forbud_annet");
	});
});

describe("Kartverket SSR (punkt uten omriss)", () => {
	const ssr = (nr, navn, lat, lng, type = "Vann") => ({ stedsnummer: nr, skrivemåte: navn, navneobjekttype: type, representasjonspunkt: { nord: lat, øst: lng } });
	const vann = vannFraSsr([
		ssr(1, "Tistreivatnet", 59.26102, 5.25492),
		ssr(2, "Vaulen", 59.22976, 5.26884, "Tjern"),
		ssr(3, "Helgelandsvatnet", 59.30689, 5.3511),
		ssr(4, "Øvre Helgalandsvatnet", 59.30605, 5.35094),
		ssr(5, "Janastemmen", 59.29234, 5.26908, "Tjern"),
		ssr(6, "Slettvatnet", 59.2919, 5.26777),
	]);

	it("kobler annen skrivemåte, men ikke et annet vann 270 m unna", () => {
		const { rader, merknader } = behandleVann(vann, {
			godkjente: [
				{ nr: 26, navn: "Tistreidvatn", sone: "Vest-Karmøy", punkt: [59.2611, 5.2549] },
				{ nr: 17, navn: "Stiklevatn Nord", sone: "Vest-Karmøy", punkt: [59.22729, 5.26893] }, // Vaulen er 270 m unna
				{ nr: 41, navn: "Øvre Helgelandsvatn", sone: "Fastlandet/Fosen", punkt: [59.30605, 5.35094] },
				{ nr: 30, navn: "Slettevatn", sone: "Avaldsnes", punkt: [59.2919, 5.26777] },
			],
			forbud: [],
			salgPerSone: SALG,
		});
		const r = Object.fromEntries(rader.map((x) => [x.id, x]));
		expect(r.s1).toMatchObject({ status: "fiskekort", kartnr: "26" });
		expect(r.s2.status).toBe("ukjent_grunneier");
		expect(r["k17-stiklevatn-nord"]).toMatchObject({ status: "fiskekort", sone: "Vest-Karmøy", lat: 59.22729, geometri: null });
		// «Helgelandsvatnet» 93 m fra «Øvre Helgalandsvatnet» er samme vann – fjernes
		expect(r.s3).toBeUndefined();
		expect(r.s4.status).toBe("fiskekort");
		// «Janastemmen» 99 m fra Slettvatnet har annet navn – beholdes
		expect(r.s5.status).toBe("ukjent_grunneier");
		expect(merknader.join("\n")).toMatch(/Stiklevatn Nord.*lagt inn fra konfigurasjonen/);
	});
});

describe("GBIF-arter", () => {
	const vann = [
		{ id: "s1", navn: "Tjøsvollvatnet", lat: 59.26541, lng: 5.19885, arter: "gjedde" },
		{ id: "s2", navn: "Litla Mjåvatnet", lat: 59.2235, lng: 5.29166, arter: null },
	];
	it("kobler på stedsnavn eller nærhet, ikke på dårlige koordinater", () => {
		const funn = [
			{ art: "ørret", lat: 59.2654, lng: 5.1988, usikkerhet: 50, lokalitet: "Tjøsvollvatnet, Karmøy, Ro", datasett: "a" },
			{ art: "ål", lat: 59.27, lng: 5.21, usikkerhet: 25000, lokalitet: "Tjøsvollvatnet", datasett: "a" }, // navnet treffer
			{ art: "abbor", lat: 59.2236, lng: 5.2918, usikkerhet: 100, lokalitet: null, datasett: "b" }, // nær nok
			{ art: "gjedde", lat: 59.2236, lng: 5.2918, usikkerhet: 20000, lokalitet: null, datasett: "c" }, // for unøyaktig
			{ art: "røye", lat: 59.3, lng: 5.4, usikkerhet: 10, lokalitet: "Et annet sted", datasett: "d" }, // langt unna
		];
		const { perVann, brukt } = gbifArterPerVann(funn, vann);
		expect([...perVann.get("s1")].sort()).toEqual(["ål", "ørret"]);
		expect([...perVann.get("s2")]).toEqual(["abbor"]);
		expect([...brukt].sort()).toEqual(["a", "b"]);
		const rader = vann.map((v) => ({ ...v }));
		expect(leggTilGbifArter(rader, perVann)).toBe(2);
		expect(rader[0]).toMatchObject({ arter: "gjedde, ørret, ål", arter_kilde: "fiskekart,gbif" });
		expect(rader[1]).toMatchObject({ arter: "abbor", arter_kilde: "gbif" });
	});
});

describe("seed.sql", () => {
	it("escaper tekst og JSON", () => {
		expect(sqlVerdi("O'Hara")).toBe("'O''Hara'");
		expect(sqlVerdi(null)).toBe("NULL");
		expect(sqlVerdi([{ a: "b'c" }])).toBe(`'[{"a":"b''c"}]'`);
	});

	it("kan kjøres i SQLite, to ganger, og har stabil versjon", () => {
		const sql = lagSeedSql(kjør().rader, { hentet: new Date("2026-11-20") });
		expect(sql).toMatch(/^-- versjon: [0-9a-f]{8}\n/);
		expect(lagSeedSql(kjør().rader, { hentet: new Date("2026-11-20") })).toBe(sql);

		const db = new DatabaseSync(":memory:");
		db.exec(sql);
		db.exec(sql);
		const rader = db.prepare("SELECT id, status, sone, salg, geometri FROM ferskvann ORDER BY id").all();
		expect(rader.map((r) => `${r.id}:${r.status}`)).toEqual([
			"r10:forbud_drikkevann",
			"w1:fiskekort",
			"w2:fiskekort",
			"w3:ukjent_grunneier",
			"w4:ukjent_grunneier",
		]);
		expect(JSON.parse(rader.find((r) => r.id === "w1").salg)[0].nummer).toBe("629636");
		expect(JSON.parse(rader[0].geometri).type).toBe("Polygon");
	});

	it("skjemaet avviser fiskekort uten sone og forbud uten advarsel", () => {
		const db = new DatabaseSync(":memory:");
		db.exec(lagSeedSql([]));
		expect(() => db.exec("INSERT INTO ferskvann (id, navn, status, lat, lng) VALUES ('w9', 'X', 'fiskekort', 59, 5)")).toThrow(/CHECK/);
		expect(() => db.exec("INSERT INTO ferskvann (id, navn, status, lat, lng) VALUES ('w9', 'X', 'forbud_vasspest', 59, 5)")).toThrow(/CHECK/);
		expect(() => db.exec("INSERT INTO ferskvann (id, navn, status, lat, lng) VALUES ('w9', 'X', 'tull', 59, 5)")).toThrow(/CHECK/);
	});
});
