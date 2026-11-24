// Reglene bak huggtabellen: lys, lufttrykk, vind, skydekke og måne for hver dag.
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

/** Vind (m/s, 10 m over bakken): lett til moderat vind kruser vannet og regnes som gunstig, sterk vind som en sikkerhetssak. */
export const VIND_GUNSTIG_MS = { fra: 3, til: 8 };
export const VIND_KRAFTIG_MS = 10;
/** Skydekke (%): under første grense regnes dagen som klar, over andre som skyet. */
export const SKY_KLART_PST = 25;
export const SKY_SKYET_PST = 75;

// ---------- Vind og skydekke ----------
const RETNINGER = ["N", "NØ", "Ø", "SØ", "S", "SV", "V", "NV"];

/** Kompassretning (N, NØ, …) for en vindretning i grader, der vinden kommer fra. */
export const retningNavn = (grader) => RETNINGER[Math.round((((grader % 360) + 360) % 360) / 45) % 8];

/**
 * Timer med gunstig og kraftig vind i `[fra, til)`. Sammenhengende timer slås sammen.
 * Vind mellom grensene (over «gunstig», under «kraftig») hører ikke til noen av dem.
 *
 * @param {number[]} tider  tidspunkter i ms, ett per time
 * @param {(number|null)[]} vind  vindstyrke i m/s
 * @returns {{gunstige: {fra:number, til:number}[], kraftige: {fra:number, til:number}[]}}
 */
export function vindPerioder(tider, vind, fra, til) {
	const ut = { gunstige: [], kraftige: [] };
	const legg = (liste, t) => {
		const sist = liste[liste.length - 1];
		if (sist && sist.til === t) sist.til = t + TIME;
		else liste.push({ fra: t, til: t + TIME });
	};
	tider.forEach((t, i) => {
		const v = vind[i];
		if (v == null || t < fra || t >= til) return;
		if (v >= VIND_KRAFTIG_MS) legg(ut.kraftige, t);
		else if (v >= VIND_GUNSTIG_MS.fra && v <= VIND_GUNSTIG_MS.til) legg(ut.gunstige, t);
	});
	return ut;
}

/**
 * Gjennomsnitt av vind og skydekke i `[fra, til)`. Retningen er vektorgjennomsnitt veid med
 * vindstyrke, så to motsatte vinder ikke gir en tilfeldig middelverdi.
 * Returnerer null når det ikke finnes data i tidsrommet.
 */
export function værSnitt(tider, vind, retning, sky, fra, til) {
	const timer = tider.map((t, i) => i).filter((i) => tider[i] >= fra && tider[i] < til);
	const gyldig = (liste) => timer.map((i) => liste?.[i]).filter((v) => v != null);
	const v = gyldig(vind);
	const sn = (liste) => (liste.length ? liste.reduce((a, b) => a + b, 0) / liste.length : null);
	let navn = null;
	if (v.length && retning) {
		let x = 0;
		let y = 0;
		for (const i of timer) {
			if (vind[i] == null || retning[i] == null) continue;
			x += vind[i] * Math.sin((retning[i] * Math.PI) / 180);
			y += vind[i] * Math.cos((retning[i] * Math.PI) / 180);
		}
		if (Math.hypot(x, y) > 0.5) navn = retningNavn((Math.atan2(x, y) * 180) / Math.PI);
	}
	const s = gyldig(sky);
	if (!v.length && !s.length) return null;
	return { vind: v.length ? { snitt: sn(v), maks: Math.max(...v), navn } : null, sky: s.length ? { snitt: sn(s) } : null };
}

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
 * @param {{tider:number[], trykk:(number|null)[], temp:(number|null)[], vind?:(number|null)[], vindretning?:(number|null)[], sky?:(number|null)[]}|null} o.varsel  timeserie fra værvarselet, eller null uten nett
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
	// Vind og skydekke i dagslys (hele døgnet ved midnattssol og mørketid)
	let vind = null;
	let sky = null;
	let skyTimer = null;
	if (dekket && Array.isArray(varsel.vind) && varsel.vind.length === varsel.tider.length) {
		const lysFra = sol.opp ? sol.opp.getTime() : start.getTime();
		const lysTil = sol.opp && sol.ned ? sol.ned.getTime() : slutt.getTime();
		const snitt = værSnitt(varsel.tider, varsel.vind, varsel.vindretning, varsel.sky, lysFra, lysTil);
		if (snitt?.vind) vind = { ...snitt.vind, ...vindPerioder(varsel.tider, varsel.vind, start.getTime(), slutt.getTime()) };
		if (snitt?.sky) sky = snitt.sky;
		if (sky && Array.isArray(varsel.sky) && varsel.sky.length === varsel.tider.length) {
			skyTimer = varsel.tider.map((t, i) => ({ fra: t, til: t + TIME, pst: varsel.sky[i] })).filter((h) => h.fra >= start.getTime() && h.fra < slutt.getTime() && h.pst != null);
		}
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
		vind,
		sky,
		skyTimer,
		kaldt,
		kaldtBånd,
	};
}

/** `antall` døgn fra og med `startDato`. */
export const byggUke = (o, startDato, antall = 7) =>
  Array.from({ length: antall }, (_, i) => byggDag({ ...o, dato: leggTilDager(startDato, i) }));
