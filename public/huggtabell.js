// Reglene bak huggtabellen: lys, lufttrykk og måne for hver dag.
// Ren logikk uten DOM og uten nett, slik at den kan testes i Node (test/huggtabell.spec.mjs).
//
// Reglene er tommelfingerregler fra fiskere, ikke målt sammenheng. Lys og lufttrykk har
// best støtte; månen svakest. Appen sier det der tabellen vises.
import { leggTilDager, lokalDagStart, månefase, måneHendelser, solHendelser } from "./astro.js";

const MIN = 60000;
const TIME = 3600000;

// ---------- Regler (endres her) ----------
/** Grålysning: fra så mange minutter før til så mange etter soloppgang. */
export const GRÅLYS = { før: 45, etter: 65 };
/** Skumring: fra så mange minutter før til så mange etter solnedgang. */
export const SKUMRING = { før: 65, etter: 45 };
/** Lufttrykk: minste endring (hPa) over `TRYKK_VINDU_TIMER` timer for å regnes som stigende/fallende. */
export const TRYKK_TERSKEL_HPA = 1;
export const TRYKK_VINDU_TIMER = 3;
/** Månen: halv bredde rundt kulminasjon (hovedperiode) og rundt opp-/nedgang (biperiode), i minutter. */
export const MÅNE_HOVED_MIN = 60;
export const MÅNE_BI_MIN = 30;
/** Kaldt vær: under denne døgnmiddeltemperaturen (°C) pekes det på midt på dagen som et ekstra hint. */
export const KALDT_SNITT_C = 5;
/** Tidsrommet midt på dagen som fremheves ved kaldt vær, i minutter etter lokal midnatt. */
export const KALDT_BÅND_MIN = { fra: 11 * 60, til: 14 * 60 + 30 };

// ---------- Lufttrykk ----------
/**
 * Sammenhengende perioder med stigende eller fallende lufttrykk i en timeserie.
 * Hvert tidspunkt t regnes som en del av en periode når trykket har endret seg minst
 * `TRYKK_TERSKEL_HPA` de siste `TRYKK_VINDU_TIMER` timene. Perioder med samme retning slås
 * sammen, også med én time uten utslag imellom.
 *
 * @param {number[]} tider  tidspunkter i ms, ett per time, stigende
 * @param {(number|null)[]} trykk  lufttrykk i hPa, samme lengde (null = mangler)
 * @returns {{retning: "faller"|"stiger", fra: number, til: number, endring: number}[]}
 */
export function trykkPerioder(tider, trykk) {
	const perioder = [];
	let aktiv = null; // { retning, fraIdx, tilIdx }
	const avslutt = () => {
		if (!aktiv) return;
		const faller = aktiv.retning === "faller";
		// Treffvinduene starter og slutter uten å vite når trykket egentlig snudde. Start i toppen
		// (faller) eller bunnen (stiger) av første vindu og slutt i bunnen/toppen av siste vindu.
		const start = ytterpunkt(trykk, aktiv.fraIdx, Math.min(aktiv.fraIdx + TRYKK_VINDU_TIMER, aktiv.tilIdx), faller ? "maks" : "min", "sist");
		const slutt = ytterpunkt(trykk, Math.max(aktiv.tilIdx - TRYKK_VINDU_TIMER, aktiv.fraIdx), aktiv.tilIdx, faller ? "min" : "maks", "først");
		const [fraIdx, tilIdx] = start != null && slutt != null && slutt > start ? [start, slutt] : [aktiv.fraIdx, aktiv.tilIdx];
		perioder.push({ retning: aktiv.retning, fra: tider[fraIdx], til: tider[tilIdx], endring: trykk[tilIdx] - trykk[fraIdx] });
		aktiv = null;
	};
	for (let i = TRYKK_VINDU_TIMER; i < tider.length; i++) {
		const a = trykk[i - TRYKK_VINDU_TIMER];
		const b = trykk[i];
		const endring = a == null || b == null ? 0 : b - a;
		if (Math.abs(endring) < TRYKK_TERSKEL_HPA) continue;
		const retning = endring < 0 ? "faller" : "stiger";
		const fraIdx = i - TRYKK_VINDU_TIMER;
		if (aktiv && aktiv.retning === retning && i - aktiv.tilIdx <= 2) {
			aktiv.tilIdx = i;
			continue;
		}
		avslutt();
		aktiv = { retning, fraIdx, tilIdx: i };
	}
	avslutt();
	return perioder;
}

/** Indeksen til største («maks») eller minste («min») verdi i [fra, til]; ved likhet første eller siste. */
function ytterpunkt(verdier, fra, til, type, ved) {
	let best = null;
	for (let j = fra; j <= til; j++) {
		const v = verdier[j];
		if (v == null) continue;
		const bedre = best == null || (type === "maks" ? v > verdier[best] : v < verdier[best]) || (ved === "sist" && v === verdier[best]);
		if (bedre) best = j;
	}
	return best;
}

/** Trykket (hPa) på et tidspunkt, lineært mellom timene. null utenfor serien eller ved manglende verdi. */
export function trykkVed(tider, trykk, t) {
	if (!tider.length || t < tider[0] || t > tider[tider.length - 1]) return null;
	const i = tider.findIndex((x) => x >= t);
	if (i <= 0) return trykk[0] ?? null;
	const [t0, t1, p0, p1] = [tider[i - 1], tider[i], trykk[i - 1], trykk[i]];
	if (p0 == null || p1 == null) return null;
	return t1 === t0 ? p1 : p0 + ((p1 - p0) * (t - t0)) / (t1 - t0);
}

/** Trykkperiodene som overlapper et døgn, klippet til døgnet, med endringen innenfor døgnet. */
export function trykkForDag(perioder, tider, trykk, dagStart, dagSlutt) {
	const ut = [];
	for (const p of perioder) {
		const fra = Math.max(p.fra, dagStart);
		const til = Math.min(p.til, dagSlutt);
		if (til <= fra) continue;
		const a = trykkVed(tider, trykk, fra);
		const b = trykkVed(tider, trykk, til);
		if (a == null || b == null) continue;
		const endring = b - a;
		if (Math.abs(endring) < TRYKK_TERSKEL_HPA) continue; // en uttynnet rest av en periode over midnatt
		ut.push({ retning: p.retning, fra, til, endring });
	}
	return ut;
}

// ---------- Hele døgnet ----------
/**
 * Alt tabellen og figuren trenger for ett lokalt døgn.
 *
 * @param {object} o
 * @param {string} o.dato  ÅÅÅÅ-MM-DD i stedets tidssone
 * @param {string} o.tidssone  f.eks. «Europe/Oslo»
 * @param {number} o.breddegrad
 * @param {number} o.lengdegrad
 * @param {{tider:number[], trykk:(number|null)[], temp:(number|null)[]}|null} o.varsel  timeserie fra værvarselet, eller null uten nett
 */
export function byggDag({ dato, tidssone, breddegrad, lengdegrad, varsel }) {
	const start = lokalDagStart(tidssone, dato);
	const slutt = lokalDagStart(tidssone, leggTilDager(dato, 1));
	const sol = solHendelser(start, slutt, breddegrad, lengdegrad);

	// Lys. Uten opp- eller nedgang (midnattssol, mørketid) finnes ingen grålysning eller skumring.
	const gråLys = sol.opp ? { fra: sol.opp.getTime() - GRÅLYS.før * MIN, til: sol.opp.getTime() + GRÅLYS.etter * MIN } : null;
	const skumring = sol.ned ? { fra: sol.ned.getTime() - SKUMRING.før * MIN, til: sol.ned.getTime() + SKUMRING.etter * MIN } : null;

	// Måne
	const måne = måneHendelser(start, slutt, breddegrad, lengdegrad);
	const hoved = [
		...måne.øvre.map((t) => ({ type: "øvre", midt: t.getTime() })),
		...måne.nedre.map((t) => ({ type: "nedre", midt: t.getTime() })),
	]
		.sort((a, b) => a.midt - b.midt)
		.map((p) => ({ ...p, fra: p.midt - MÅNE_HOVED_MIN * MIN, til: p.midt + MÅNE_HOVED_MIN * MIN }));
	const bi = [
		...måne.opp.map((t) => ({ type: "opp", midt: t.getTime() })),
		...måne.ned.map((t) => ({ type: "ned", midt: t.getTime() })),
	]
		.sort((a, b) => a.midt - b.midt)
		.map((p) => ({ ...p, fra: p.midt - MÅNE_BI_MIN * MIN, til: p.midt + MÅNE_BI_MIN * MIN }));
	const fase = månefase(new Date(start.getTime() + 12 * TIME));

	// Vær
	let trykk = null;
	let temp = null;
	// Bare døgn som varselet dekker helt: ellers ville manglende data sett ut som «stabilt trykk»
	const dekket = varsel?.tider.length && varsel.tider[0] <= start.getTime() && varsel.tider[varsel.tider.length - 1] >= slutt.getTime() - TIME;
	if (dekket) {
		const alle = trykkPerioder(varsel.tider, varsel.trykk);
		trykk = trykkForDag(alle, varsel.tider, varsel.trykk, start.getTime(), slutt.getTime());
		const verdier = varsel.tider.map((t, i) => (t >= start.getTime() && t < slutt.getTime() ? varsel.temp[i] : null)).filter((v) => v != null);
		if (verdier.length >= 12) temp = { snitt: verdier.reduce((s, v) => s + v, 0) / verdier.length };
	}
	const kaldt = temp != null && temp.snitt < KALDT_SNITT_C;
	const kaldtBånd = kaldt ? { fra: start.getTime() + KALDT_BÅND_MIN.fra * MIN, til: start.getTime() + KALDT_BÅND_MIN.til * MIN } : null;

	return {
		dato,
		start: start.getTime(),
		slutt: slutt.getTime(),
		tilstand: sol.tilstand,
		sol: { opp: sol.opp?.getTime() ?? null, ned: sol.ned?.getTime() ?? null },
		gråLys,
		skumring,
		måne: { lyst: fase.lyst, fase: fase.fase, hoved, bi },
		trykk,
		temp,
		kaldt,
		kaldtBånd,
	};
}

/** `antall` døgn fra og med `startDato`. */
export const byggUke = (o, startDato, antall = 7) =>
  Array.from({ length: antall }, (_, i) => byggDag({ ...o, dato: leggTilDager(startDato, i) }));
