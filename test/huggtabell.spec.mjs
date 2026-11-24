import { describe, expect, it } from "vitest";
import { byggDag, byggUke, KALDT_BÅND_MIN, trykkForDag, trykkPerioder } from "../public/huggtabell.js";

const TIME = 3600000;
const MIN = 60000;
const OSLO = { tidssone: "Europe/Oslo", breddegrad: 59.27, lengdegrad: 5.28 };
const MIDNATT = Date.UTC(2026, 10, 23, 23); // 24.11.2026 00:00 lokal tid
const timer = (fraTime, tilTime) => Array.from({ length: tilTime - fraTime }, (_, i) => MIDNATT + (fraTime + i) * TIME);
const klokke = (ms) => new Date(ms + TIME).toISOString().slice(11, 16); // lokal tid (UTC+1)

/** Trykkserie som er stabil, faller 7 hPa kl. 11–22 og er stabil igjen. */
const serie = (tider, f) => tider.map((t) => f((t - MIDNATT) / TIME));

describe("trykkPerioder", () => {
	const tider = timer(-24, 168);
	const faller = serie(tider, (h) => (h < 11 ? 1010 : h <= 22 ? 1010 - (7 * (h - 11)) / 11 : 1003));

	it("finner fallet og gir start, slutt og total endring", () => {
		const [p, ...rest] = trykkPerioder(tider, faller);
		expect(rest).toHaveLength(0);
		expect(p.retning).toBe("faller");
		expect(klokke(p.fra)).toBe("11:00");
		expect(klokke(p.til)).toBe("22:00");
		expect(p.endring).toBeCloseTo(-7, 5);
	});

	it("stabilt trykk gir ingen perioder", () => {
		expect(trykkPerioder(tider, tider.map(() => 1012))).toEqual([]);
	});

	it("grensen er 1 hPa på 3 timer", () => {
		const sakte = (perTime) => tider.map((_, i) => 1010 - perTime * i);
		expect(trykkPerioder(tider, sakte(0.3))).toEqual([]); // 0,9 hPa på 3 t
		expect(trykkPerioder(tider, sakte(1 / 3 + 0.001))).toHaveLength(1);
	});

	it("skiller fall og stigning, og tåler manglende verdier", () => {
		const v = serie(tider, (h) => (h < 0 ? 1000 : h < 10 ? 1000 + h : 1010 - (h - 10) * 1.5 > 1000 ? 1010 - (h - 10) * 1.5 : 1000));
		const ps = trykkPerioder(tider, v);
		expect(ps.map((p) => p.retning)).toEqual(["stiger", "faller"]);
		const hull = faller.map((x, i) => (i % 17 === 0 ? null : x));
		expect(() => trykkPerioder(tider, hull)).not.toThrow();
	});

	it("klipper en periode over midnatt til døgnet", () => {
		// Faller 20:00 → 06:00 neste døgn (−6 hPa), 0,6 hPa/t
		const v = serie(tider, (h) => (h < 20 ? 1010 : h <= 30 ? 1010 - 0.6 * (h - 20) : 1004));
		const alle = trykkPerioder(tider, v);
		const dag1 = trykkForDag(alle, tider, v, MIDNATT, MIDNATT + 24 * TIME);
		const dag2 = trykkForDag(alle, tider, v, MIDNATT + 24 * TIME, MIDNATT + 48 * TIME);
		expect(klokke(dag1[0].fra)).toBe("20:00");
		expect(klokke(dag1[0].til)).toBe("00:00");
		expect(dag1[0].endring).toBeCloseTo(-2.4, 1);
		expect(klokke(dag2[0].fra)).toBe("00:00");
		expect(klokke(dag2[0].til)).toBe("06:00");
		expect(dag2[0].endring).toBeCloseTo(-3.6, 1);
	});
});

describe("byggDag", () => {
	const tider = timer(-24, 168);
	const varsel = (temp) => ({ tider, trykk: serie(tider, (h) => (h < 11 ? 1010 : h <= 22 ? 1010 - (7 * (h - 11)) / 11 : 1003)), temp: tider.map(() => temp) });

	it("grålysning og skumring følger reglene rundt sol opp og ned", () => {
		const d = byggDag({ ...OSLO, dato: "2026-11-24", varsel: null });
		expect(d.gråLys.fra).toBe(d.sol.opp - 45 * MIN);
		expect(d.gråLys.til).toBe(d.sol.opp + 65 * MIN);
		expect(d.skumring.fra).toBe(d.sol.ned - 65 * MIN);
		expect(d.skumring.til).toBe(d.sol.ned + 45 * MIN);
		expect(klokke(d.sol.opp)).toBe("08:52");
	});

	it("månens hovedperioder er to timer og biperiodene en time", () => {
		const d = byggDag({ ...OSLO, dato: "2026-11-24", varsel: null });
		expect(d.måne.hoved.length + d.måne.bi.length).toBeGreaterThan(0);
		for (const p of d.måne.hoved) expect(p.til - p.fra).toBe(120 * MIN);
		for (const p of d.måne.bi) expect(p.til - p.fra).toBe(60 * MIN);
		expect(d.måne.lyst).toBeGreaterThan(0.99);
	});

	it("uten vær: ingen trykk og ingen kaldt-råd", () => {
		const d = byggDag({ ...OSLO, dato: "2026-11-24", varsel: null });
		expect(d.trykk).toBeNull();
		expect(d.kaldt).toBe(false);
	});

	it("døgn utenfor varselets tidsrom får ingen trykkopplysninger (ikke «stabilt»)", () => {
		const d = byggDag({ ...OSLO, dato: "2026-12-30", varsel: varsel(3) });
		expect(d.trykk).toBeNull();
		expect(d.temp).toBeNull();
	});

	it("kaldt vær gir midt-på-dagen-bånd, mildt vær gjør ikke", () => {
		const kald = byggDag({ ...OSLO, dato: "2026-11-24", varsel: varsel(3) });
		expect(kald.kaldt).toBe(true);
		expect(kald.kaldtBånd.fra - kald.start).toBe(KALDT_BÅND_MIN.fra * MIN);
		expect(kald.kaldtBånd.til - kald.start).toBe(KALDT_BÅND_MIN.til * MIN);
		expect(byggDag({ ...OSLO, dato: "2026-11-24", varsel: varsel(9) }).kaldt).toBe(false);
	});

	it("trykkfall kommer med i dagen", () => {
		const d = byggDag({ ...OSLO, dato: "2026-11-24", varsel: varsel(3) });
		expect(d.trykk).toHaveLength(1);
		expect(d.trykk[0].retning).toBe("faller");
		expect(d.trykk[0].endring).toBeCloseTo(-7, 5);
	});

	it("midnattssol og mørketid gir ingen grålysning eller skumring", () => {
		const sommer = byggDag({ tidssone: "Europe/Oslo", breddegrad: 69.65, lengdegrad: 18.96, dato: "2026-06-21", varsel: null });
		expect(sommer.tilstand).toBe("midnattssol");
		expect(sommer.gråLys).toBeNull();
		expect(sommer.skumring).toBeNull();
		const vinter = byggDag({ tidssone: "Europe/Oslo", breddegrad: 69.65, lengdegrad: 18.96, dato: "2026-12-21", varsel: null });
		expect(vinter.tilstand).toBe("mørketid");
	});

	it("byggUke gir det antallet sammenhengende døgn man ber om", () => {
		const uke = byggUke({ ...OSLO, varsel: null }, "2026-11-24", 3);
		expect(uke.map((d) => d.dato)).toEqual(["2026-11-24", "2026-11-25", "2026-11-26"]);
		for (let i = 1; i < 3; i++) expect(uke[i].start).toBe(uke[i - 1].slutt);
	});
});
