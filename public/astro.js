// Sol og måne beregnet lokalt – ingen nett og ingen eksterne data.
//
// Formlene er de forenklede, publiserte algoritmene fra «Astronomy Answers» (Meeus-baserte),
// de samme som biblioteket SunCalc (MIT, © Vladimir Agafonkin) bygger på. Koden er skrevet
// på nytt for denne appen. Nøyaktigheten er rundt et minutt for sol og noen få minutter
// for måne, mer enn nok til å planlegge fiske. Tidspunkter er Date (UTC); bruk
// tidssonehjelperne nederst til å regne i stedets lokale tid.

const RAD = Math.PI / 180;
const DAG_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const SKRÅNING = RAD * 23.4397; // jordaksens helning

/** Solas øvre kant over horisonten ved opp-/nedgang (refraksjon og solradius), i grader. */
export const SOL_HORISONT = -0.833;
/** Månens høyde ved opp-/nedgang (parallakse, refraksjon og radius), i grader. */
export const MÅNE_HORISONT = 0.133;

// ---------- Tid og koordinater ----------
const tilDager = (dato) => dato.valueOf() / DAG_MS - 0.5 + J1970 - J2000;
const rektascensjon = (l, b) => Math.atan2(Math.sin(l) * Math.cos(SKRÅNING) - Math.tan(b) * Math.sin(SKRÅNING), Math.cos(l));
const deklinasjon = (l, b) => Math.asin(Math.sin(b) * Math.cos(SKRÅNING) + Math.cos(b) * Math.sin(SKRÅNING) * Math.sin(l));
const høyde = (H, breddegrad, dek) => Math.asin(Math.sin(breddegrad) * Math.sin(dek) + Math.cos(breddegrad) * Math.cos(dek) * Math.cos(H));
const siderealTid = (dager, lengdeVest) => RAD * (280.16 + 360.9856235 * dager) - lengdeVest;

/** Refraksjon (radianer) for en høyde over horisonten (radianer). */
function refraksjon(h) {
	const hh = h < 0 ? 0 : h;
	return 0.0002967 / Math.tan(hh + 0.00312536 / (hh + 0.08901179));
}

// ---------- Sol ----------
function solKoordinater(dager) {
	const M = RAD * (357.5291 + 0.98560028 * dager);
	const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
	const L = M + C + RAD * 102.9372 + Math.PI;
	return { dek: deklinasjon(L, 0), ra: rektascensjon(L, 0) };
}

/** Solas høyde over horisonten i grader (uten refraksjon) for et tidspunkt og sted. */
export function solHøyde(dato, breddegrad, lengdegrad) {
	const d = tilDager(dato);
	const k = solKoordinater(d);
	const H = siderealTid(d, RAD * -lengdegrad) - k.ra;
	return høyde(H, RAD * breddegrad, k.dek) / RAD;
}

// ---------- Måne ----------
function måneKoordinater(dager) {
	const L = RAD * (218.316 + 13.176396 * dager);
	const M = RAD * (134.963 + 13.064993 * dager);
	const F = RAD * (93.272 + 13.22935 * dager);
	const l = L + RAD * 6.289 * Math.sin(M);
	const b = RAD * 5.128 * Math.sin(F);
	return { ra: rektascensjon(l, b), dek: deklinasjon(l, b), avstand: 385001 - 20905 * Math.cos(M) };
}

/** Månens posisjon: høyde (grader, med refraksjon) og azimut (radianer fra sør, mot vest). */
export function månePosisjon(dato, breddegrad, lengdegrad) {
	const lw = RAD * -lengdegrad;
	const phi = RAD * breddegrad;
	const d = tilDager(dato);
	const k = måneKoordinater(d);
	const H = siderealTid(d, lw) - k.ra;
	let h = høyde(H, phi, k.dek);
	h += refraksjon(h);
	return { høyde: h / RAD, azimut: Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(k.dek) * Math.cos(phi)), avstand: k.avstand };
}

/**
 * Månefase for et tidspunkt: `lyst` er andelen av skiva som er opplyst (0–1) og `fase` går
 * fra 0 (nymåne) via 0,5 (fullmåne) til 1 (neste nymåne). Fasen er under 0,5 når månen tiltar.
 */
export function månefase(dato) {
	const d = tilDager(dato);
	const s = solKoordinater(d);
	const m = måneKoordinater(d);
	const SOL_AVSTAND = 149598000; // km
	const phi = Math.acos(Math.sin(s.dek) * Math.sin(m.dek) + Math.cos(s.dek) * Math.cos(m.dek) * Math.cos(s.ra - m.ra));
	const inc = Math.atan2(SOL_AVSTAND * Math.sin(phi), m.avstand - SOL_AVSTAND * Math.cos(phi));
	const vinkel = Math.atan2(Math.cos(s.dek) * Math.sin(s.ra - m.ra), Math.sin(s.dek) * Math.cos(m.dek) - Math.cos(s.dek) * Math.sin(m.dek) * Math.cos(s.ra - m.ra));
	return { lyst: (1 + Math.cos(inc)) / 2, fase: 0.5 + (0.5 * inc * (vinkel < 0 ? -1 : 1)) / Math.PI };
}

// ---------- Søk etter hendelser i et tidsrom ----------
const SKANNE_STEG_MS = 10 * 60000;

/**
 * Tidspunkter (ms) der f(t) krysser null, med retning: +1 stigende, −1 synkende.
 * Skanner med faste steg og forfiner hvert kryss med halvering (ca. ett sekund).
 */
function nullkryss(f, fra, til) {
	const ut = [];
	let tForrige = fra;
	let fForrige = f(tForrige);
	for (let t = fra + SKANNE_STEG_MS; ; t += SKANNE_STEG_MS) {
		const tNå = Math.min(t, til);
		const fNå = f(tNå);
		if ((fForrige < 0 && fNå >= 0) || (fForrige >= 0 && fNå < 0)) {
			const retning = fNå > fForrige ? 1 : -1;
			let lav = tForrige;
			let høy = tNå;
			for (let i = 0; i < 20; i++) {
				const midt = (lav + høy) / 2;
				const fm = f(midt);
				if ((fm < 0) === (fForrige < 0)) lav = midt;
				else høy = midt;
			}
			ut.push({ tid: new Date((lav + høy) / 2), retning });
		}
		if (tNå >= til) break;
		tForrige = tNå;
		fForrige = fNå;
	}
	return ut;
}

/** Tidspunkter der f(t) har et lokalt toppunkt (type «topp») eller bunnpunkt («bunn»). */
function ytterpunkter(f, fra, til) {
	const ut = [];
	const steg = SKANNE_STEG_MS;
	for (let t = fra + steg; t < til; t += steg) {
		const a = f(t - steg);
		const b = f(t);
		const c = f(Math.min(t + steg, til));
		const topp = b > a && b >= c;
		const bunn = b < a && b <= c;
		if (!topp && !bunn) continue;
		// Gyllent snitt rundt t for å finne ytterpunktet innenfor ±ett steg
		const fortegn = topp ? 1 : -1;
		let lav = t - steg;
		let høy = Math.min(t + steg, til);
		for (let i = 0; i < 24; i++) {
			const m1 = lav + (høy - lav) / 3;
			const m2 = høy - (høy - lav) / 3;
			if (fortegn * f(m1) < fortegn * f(m2)) lav = m1;
			else høy = m2;
		}
		const tid = (lav + høy) / 2;
		if (tid > fra && tid < til) ut.push({ tid: new Date(tid), type: topp ? "topp" : "bunn" });
	}
	return ut;
}

/**
 * Sol i et tidsrom [fra, til) (Date): opp- og nedgang, og hva solen gjør hvis den verken
 * går opp eller ned (`tilstand`: «normal», «midnattssol» eller «mørketid»).
 */
export function solHendelser(fra, til, breddegrad, lengdegrad) {
	const f = (t) => solHøyde(new Date(t), breddegrad, lengdegrad) - SOL_HORISONT;
	const kryss = nullkryss(f, fra.getTime(), til.getTime());
	const opp = kryss.find((k) => k.retning > 0)?.tid ?? null;
	const ned = kryss.find((k) => k.retning < 0)?.tid ?? null;
	let tilstand = "normal";
	if (!kryss.length) tilstand = f(fra.getTime()) > 0 ? "midnattssol" : "mørketid";
	return { opp, ned, tilstand };
}

/**
 * Måne i et tidsrom [fra, til): oppgang, nedgang, øvre kulminasjon (høyest) og nedre
 * kulminasjon (lavest). Hver liste kan ha 0–2 tidspunkter fordi en månedag (tiden mellom to kulminasjoner) er ca. 24 t 50 min.
 */
export function måneHendelser(fra, til, breddegrad, lengdegrad) {
	const h = (t) => månePosisjon(new Date(t), breddegrad, lengdegrad).høyde;
	const kryss = nullkryss((t) => h(t) - MÅNE_HORISONT, fra.getTime(), til.getTime());
	const topper = ytterpunkter(h, fra.getTime(), til.getTime());
	return {
		opp: kryss.filter((k) => k.retning > 0).map((k) => k.tid),
		ned: kryss.filter((k) => k.retning < 0).map((k) => k.tid),
		øvre: topper.filter((k) => k.type === "topp").map((k) => k.tid),
		nedre: topper.filter((k) => k.type === "bunn").map((k) => k.tid),
	};
}

// ---------- Tidssone (stedets lokale tid) ----------
const delerFormat = new Map();
function delerIn(tidssone) {
	if (!delerFormat.has(tidssone)) {
		delerFormat.set(
			tidssone,
			new Intl.DateTimeFormat("en-GB", { timeZone: tidssone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }),
		);
	}
	return delerFormat.get(tidssone);
}

/** Forskjellen mellom lokal tid og UTC i millisekunder i en tidssone på et gitt tidspunkt. */
export function tidssoneForskyvning(tidssone, utcMs) {
	const p = Object.fromEntries(delerIn(tidssone).formatToParts(new Date(utcMs)).map((x) => [x.type, Number(x.value)]));
	return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}

/** Datoen (ÅÅÅÅ-MM-DD) i stedets tidssone for et tidspunkt. */
export function lokalDato(tidssone, utcMs) {
	return new Date(utcMs + tidssoneForskyvning(tidssone, utcMs)).toISOString().slice(0, 10);
}

/** Tidspunktet (Date) der den lokale datoen ÅÅÅÅ-MM-DD begynner, kl. 00:00 i tidssonen. */
export function lokalDagStart(tidssone, dato) {
	const [å, m, d] = dato.split("-").map(Number);
	const lokalMs = Date.UTC(å, m - 1, d);
	let utc = lokalMs - tidssoneForskyvning(tidssone, lokalMs);
	utc = lokalMs - tidssoneForskyvning(tidssone, utc); // andre runde tar hensyn til sommertid-skifte
	return new Date(utc);
}

/** Neste dato (ÅÅÅÅ-MM-DD) etter en gitt dato, dagens dato pluss `antall` dager. */
export function leggTilDager(dato, antall) {
	const [å, m, d] = dato.split("-").map(Number);
	return new Date(Date.UTC(å, m - 1, d + antall)).toISOString().slice(0, 10);
}
