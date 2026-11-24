import { describe, expect, it } from "vitest";
import { leggTilDager, lokalDagStart, lokalDato, månefase, måneHendelser, månePosisjon, solHendelser, solHøyde } from "../public/astro.js";

// Kjente verdier fra SunCalcs egne tester: Kyiv-området, 5. mars 2013, kl. 00:00 UTC
const DATO = new Date("2013-03-05T00:00:00Z");
const [BREDDE, LENGDE] = [50.5, 30.5];

describe("sol og måne", () => {
	it("solhøyde stemmer med referansen", () => {
		expect(solHøyde(DATO, BREDDE, LENGDE)).toBeCloseTo(-40.109, 2);
	});

	it("månens posisjon stemmer med referansen", () => {
		const m = månePosisjon(DATO, BREDDE, LENGDE);
		expect(m.høyde).toBeCloseTo(0.8337, 3);
		expect(m.azimut).toBeCloseTo(-0.9784, 3);
		expect(m.avstand).toBeCloseTo(364121, -1);
	});

	it("månefase stemmer med referansen, og fullmåne i november 2026 er nesten helt lys", () => {
		const f = månefase(DATO);
		expect(f.lyst).toBeCloseTo(0.4848, 3);
		expect(f.fase).toBeCloseTo(0.7548, 3);
		expect(månefase(new Date("2026-11-24T22:00:00Z")).lyst).toBeGreaterThan(0.99);
	});

	it("soloppgang og solnedgang ligger innenfor ett minutt av referansen", () => {
		const h = solHendelser(DATO, new Date("2013-03-06T00:00:00Z"), BREDDE, LENGDE);
		expect(Math.abs(h.opp - new Date("2013-03-05T04:34:56Z"))).toBeLessThan(60000);
		expect(Math.abs(h.ned - new Date("2013-03-05T15:46:57Z"))).toBeLessThan(60000);
		expect(h.tilstand).toBe("normal");
	});

	it("finner månens kulminasjon og opp-/nedgang på Karmøy", () => {
		const start = lokalDagStart("Europe/Oslo", "2026-11-24");
		const slutt = lokalDagStart("Europe/Oslo", "2026-11-25");
		const m = måneHendelser(start, slutt, 59.27, 5.28);
		expect(m.opp.length + m.ned.length).toBeGreaterThan(0);
		expect(m.øvre.length + m.nedre.length).toBeGreaterThan(0);
		for (const t of [...m.opp, ...m.ned, ...m.øvre, ...m.nedre]) expect(t >= start && t < slutt).toBe(true);
		// Fullmåne: laveste punkt like før middag, høyeste rundt midnatt
		expect(m.nedre).toHaveLength(1);
		expect(Math.abs(m.nedre[0] - new Date("2026-11-24T11:05:00Z"))).toBeLessThan(30 * 60000);
	});
});

describe("midnattssol og mørketid", () => {
	const dag = (dato, b, l) => solHendelser(lokalDagStart("Europe/Oslo", dato), lokalDagStart("Europe/Oslo", leggTilDager(dato, 1)), b, l);

	it("Tromsø har midnattssol midt på sommeren og mørketid midt på vinteren", () => {
		expect(dag("2026-06-21", 69.65, 18.96)).toMatchObject({ tilstand: "midnattssol", opp: null, ned: null });
		expect(dag("2026-12-21", 69.65, 18.96)).toMatchObject({ tilstand: "mørketid", opp: null, ned: null });
	});

	it("Karmøy har alltid både soloppgang og solnedgang", () => {
		for (const d of ["2026-06-21", "2026-12-21", "2026-03-29", "2026-10-25"]) {
			const h = dag(d, 59.27, 5.28);
			expect(h.tilstand).toBe("normal");
			expect(h.opp).toBeInstanceOf(Date);
			expect(h.ned).toBeInstanceOf(Date);
		}
		const jun = dag("2026-06-21", 59.27, 5.28);
		const des = dag("2026-12-21", 59.27, 5.28);
		expect(jun.ned - jun.opp).toBeGreaterThan(des.ned - des.opp);
	});
});

describe("tidssone", () => {
	it("døgnet er 23 og 25 timer når sommertiden skifter", () => {
		const lengde = (d) => (lokalDagStart("Europe/Oslo", leggTilDager(d, 1)) - lokalDagStart("Europe/Oslo", d)) / 3600000;
		expect(lengde("2026-03-29")).toBe(23);
		expect(lengde("2026-10-25")).toBe(25);
		expect(lengde("2026-11-24")).toBe(24);
	});

	it("lokal midnatt og dato", () => {
		expect(lokalDagStart("Europe/Oslo", "2026-11-24").toISOString()).toBe("2026-11-23T23:00:00.000Z");
		expect(lokalDagStart("Europe/Oslo", "2026-07-01").toISOString()).toBe("2026-06-30T22:00:00.000Z");
		expect(lokalDato("Europe/Oslo", Date.parse("2026-11-24T23:30:00Z"))).toBe("2026-11-25");
		expect(leggTilDager("2026-12-30", 3)).toBe("2027-01-02");
	});
});
