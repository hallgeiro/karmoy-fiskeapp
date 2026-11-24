// «Fisketider»: 3-dagers huggtabell og døgnfigur for et sted i Norge.
// Sol og måne regnes ut lokalt (astro.js); bare lufttrykk og temperatur hentes fra Open-Meteo.
// Uten nett vises sol og måne likevel, og siste lagrede varsel brukes hvis det finnes.
// Reglene ligger i huggtabell.js.
import { lokalDato } from "./astro.js";
import { byggUke } from "./huggtabell.js";
import { esc } from "/logg.js";

const $ = (sel, rot = document) => rot.querySelector(sel);

// ---------- Oppsett ----------
const STANDARD_STED = { navn: "Karmøy kommune", lat: 59.27, lng: 5.28, tidssone: "Europe/Oslo" };
const VARSEL_URL = "https://api.open-meteo.com/v1/forecast";
const STED_URL = "https://geocoding-api.open-meteo.com/v1/search";
const NETT_TIDSFRIST_MS = 10000;
/** Antall dager i tabellen: i dag og de to neste. */
const ANTALL_DAGER = 3;
/** Varselet hentes på nytt når panelet åpnes og det er eldre enn dette. */
const VARSEL_GYLDIG_MS = 30 * 60000;
/** Et lagret varsel brukes uten nett så lenge det ikke er eldre enn dette. */
const VARSEL_LAGRET_MAKS_MS = 3 * 86400000;
const NØKKEL_STED = "fisketider-sted";
const NØKKEL_VARSEL = "fisketider-varsel";
const TIME_MS = 3600000;

// ---------- Tilstand ----------
let sted = lesLagret(NØKKEL_STED) ?? STANDARD_STED;
let varsel = null; // { tider, trykk, temp, hentet, tidssone, fraCache }
let dager = [];
let valgtDato = null;
let status = "";
let treff = [];
let søkTekst = "";
let lastet = false;
let sisteHenting = 0;
let figurBredde = 0;

function lesLagret(nøkkel) {
	try {
		return JSON.parse(localStorage.getItem(nøkkel));
	} catch {
		return null; // ingenting lagret, eller lagring er ikke tilgjengelig
	}
}
function lagre(nøkkel, verdi) {
	try {
		localStorage.setItem(nøkkel, JSON.stringify(verdi));
	} catch {
		/* varselet gjelder da bare til siden lastes på nytt */
	}
}

// ---------- Formatering ----------
const tidFormat = new Map();
/** «11:00» i stedets tidssone. */
function tid(ms) {
	const tz = tidssone();
	if (!tidFormat.has(tz)) tidFormat.set(tz, new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }));
	return tidFormat.get(tz).format(new Date(ms));
}
const periode = (p) => `${tid(p.fra)}–${tid(p.til)}`;
const hPa = (v) => `${v.toLocaleString("nb", { maximumFractionDigits: 1, signDisplay: "exceptZero" })} hPa`;
const gradTall = (v) => v.toLocaleString("nb", { maximumFractionDigits: 0 });
const tidssone = () => varsel?.tidssone ?? sted.tidssone ?? STANDARD_STED.tidssone;
const iDag = () => lokalDato(tidssone(), Date.now());
const trykkTekst = (p) => `${p.retning === "faller" ? "Faller" : "Stiger"} ${periode(p)} (${hPa(p.endring)})`;

function dagNavn(dag, kort = false) {
	const f = new Intl.DateTimeFormat("nb", { timeZone: tidssone(), weekday: kort ? "short" : "long", day: "numeric", month: "short" });
	const tekst = f.format(new Date(dag.start + 12 * TIME_MS)).replace(/\.$/, "");
	return tekst.charAt(0).toUpperCase() + tekst.slice(1);
}

const MÅNE_TYPE = { øvre: "månen høyest", nedre: "månen lavest", opp: "måneoppgang", ned: "månenedgang" };

// ---------- Månefase som liten tegning ----------
/**
 * Månen som SVG. `fase` er 0 (nymåne) – 0,5 (fullmåne) – 1. På den nordlige halvkule er den
 * høyre siden opplyst når månen tiltar og den venstre når den avtar.
 */
function månefaseSvg(fase, lyst, størrelse = 22) {
	const r = 10;
	const c = 11;
	const k = Math.cos(2 * Math.PI * fase); // 1 ved nymåne, −1 ved fullmåne
	const rx = Math.abs(k) * r;
	const sti = `M ${c} ${c - r} A ${r} ${r} 0 0 1 ${c} ${c + r} A ${rx.toFixed(2)} ${r} 0 0 ${k > 0 ? 0 : 1} ${c} ${c - r} Z`;
	const speil = fase > 0.5 ? ` transform="translate(${2 * c},0) scale(-1,1)"` : "";
	return `<svg class="ft-måne" viewBox="0 0 22 22" width="${størrelse}" height="${størrelse}" role="img" aria-label="Månen er ${Math.round(lyst * 100)} % opplyst">
		<circle cx="${c}" cy="${c}" r="${r}" class="ft-måne-mørk"/><path d="${sti}" class="ft-måne-lys"${speil}/></svg>`;
}

// ---------- Dagens beste vinduer ----------
const VINDU_TRINN_TIMER = 3;
const VINDU_MARG_TIMER = 1;

/**
 * Ett avrundet bånd for dagslyset: natt, grålysning, dag og skumring, med «nå»-strek,
 * tidsakse og forklaring. Båndet viser bare lys; trykk, kulde og måne ligger i figuren under.
 * Ved midnattssol og mørketid vises hele døgnet i én farge, uten grålysning og skumring.
 */
function vinduBånd(dag) {
	const polar = dag.tilstand !== "normal";
	const timer = (ms) => (ms - dag.start) / TIME_MS;
	const fraT = polar || !dag.gråLys ? 0 : Math.max(0, Math.floor((timer(dag.gråLys.fra) - VINDU_MARG_TIMER) / VINDU_TRINN_TIMER) * VINDU_TRINN_TIMER);
	const tilT = polar || !dag.skumring ? 24 : Math.min(24, Math.ceil((timer(dag.skumring.til) + VINDU_MARG_TIMER) / VINDU_TRINN_TIMER) * VINDU_TRINN_TIMER);
	const fra = dag.start + fraT * TIME_MS;
	const til = dag.start + tilT * TIME_MS;
	const pst = (ms) => Math.max(0, Math.min(100, ((ms - fra) / (til - fra)) * 100));
	const del = (a, b, klasse, tittel) => (b > a ? `<span class="ft-v ${klasse}" style="left:${pst(a).toFixed(2)}%;width:${(pst(b) - pst(a)).toFixed(2)}%" title="${esc(tittel)}"></span>` : "");

	let deler = "";
	let sol = "";
	if (dag.tilstand === "midnattssol") deler = del(fra, til, "ft-v-dag", "Midnattssol");
	else if (dag.tilstand === "mørketid") deler = "";
	else {
		const { opp, ned } = dag.sol;
		if (opp && ned) {
			deler += del(opp, ned, "ft-v-dag", `Sola er oppe ${tid(opp)}–${tid(ned)}`);
			sol = `sol ${tid(opp)}–${tid(ned)}`;
		}
		if (dag.gråLys && opp) {
			deler += del(dag.gråLys.fra, opp, "ft-v-mork", `Grålysning ${periode(dag.gråLys)}`);
			deler += del(opp, dag.gråLys.til, "ft-v-lys", `Grålysning ${periode(dag.gråLys)}`);
		}
		if (dag.skumring && ned) {
			deler += del(dag.skumring.fra, ned, "ft-v-lys", `Skumring ${periode(dag.skumring)}`);
			deler += del(ned, dag.skumring.til, "ft-v-mork", `Skumring ${periode(dag.skumring)}`);
		}
	}
	if (dag.tilstand === "midnattssol") sol = "midnattssol";
	if (dag.tilstand === "mørketid") sol = "mørketid";

	let akse = "";
	for (let t = fraT; t <= tilT; t += VINDU_TRINN_TIMER) {
		akse += `<span class="ft-v-tikk" style="left:${((t - fraT) / (tilT - fraT)) * 100}%">${tid(dag.start + t * TIME_MS).slice(0, 2)}</span>`;
	}

	const nå = dag.dato === iDag() ? Date.now() : null;
	const visNå = nå && nå >= fra && nå < til;
	const nålinje = visNå ? `<span class="ft-v-nå" style="left:${pst(nå).toFixed(2)}%"></span>` : "";

	const tegnforklaring = [];
	if (dag.gråLys && !polar) tegnforklaring.push(`<span class="ft-v-lg"><i class="ft-v-lys"></i>Grålysning <b>${periode(dag.gråLys)}</b></span>`);
	if (dag.skumring && !polar) tegnforklaring.push(`<span class="ft-v-lg"><i class="ft-v-lys"></i>Skumring <b>${periode(dag.skumring)}</b></span>`);
	if (visNå) tegnforklaring.push(`<span class="ft-v-lg"><i class="ft-v-nå-prikk"></i>Nå <b>${tid(nå)}</b></span>`);

	return `<div class="ft-vindu">
		<div class="ft-v-topp"><span>Dagens beste vinduer</span><span class="ft-v-sol">${esc(sol)}</span></div>
		<div class="ft-v-bånd" role="img" aria-label="Dagslys ${esc(dagNavn(dag))}: ${esc(sol)}">${deler}${nålinje}</div>
		<div class="ft-v-akse" aria-hidden="true">${akse}</div>
		<div class="ft-v-lgr">${tegnforklaring.join("")}</div>
	</div>`;
}

// ---------- Døgnfigur ----------
const FIGUR = { etikett: 46, høyreMarg: 8, akse: 22, bane: 24, mellom: 8 };

/** SVG med døgnet fra 00:00 til 24:00 og ett bånd per lag: lufttrykk, kaldt vær og måne. */
function figurSvg(dag, bredde) {
	const plassB = bredde - FIGUR.etikett - FIGUR.høyreMarg;
	const x = (ms) => FIGUR.etikett + Math.max(0, Math.min(1, (ms - dag.start) / (dag.slutt - dag.start))) * plassB;
	const baner = [];
	const bånd = (fra, til, klasse, tittel, tekst = "") => {
		const a = x(fra);
		const b = x(til);
		if (b - a < 1) return "";
		const midt = (a + b) / 2;
		return `<rect x="${a.toFixed(1)}" y="0" width="${(b - a).toFixed(1)}" height="${FIGUR.bane}" rx="4" class="${klasse}"><title>${esc(tittel)}</title></rect>${
			tekst && b - a > 64 ? `<text x="${midt.toFixed(1)}" y="${FIGUR.bane / 2 + 4}" text-anchor="middle" class="ft-btekst">${esc(tekst)}</text>` : ""
		}`;
	};
	const bane = (navn, innhold, notat = "") => baner.push({ navn, innhold, notat });

	// Lag 1: lufttrykk
	if (dag.trykk)
		bane(
			"Trykk",
			`<rect x="${FIGUR.etikett}" width="${plassB}" height="${FIGUR.bane}" rx="4" class="ft-skinne"/>` +
				dag.trykk.map((p) => bånd(p.fra, p.til, p.retning === "faller" ? "ft-faller" : "ft-stiger", trykkTekst(p), p.retning === "faller" ? hPa(p.endring) : "")).join(""),
		);

	// Lag 3: kaldt vær
	if (dag.kaldtBånd) bane("Kaldt", `<rect x="${FIGUR.etikett}" width="${plassB}" height="${FIGUR.bane}" rx="4" class="ft-skinne"/>${bånd(dag.kaldtBånd.fra, dag.kaldtBånd.til, "ft-kaldt", "Kaldt: midt på dagen er ofte best")}`);

	// Lag 4: måne, mer diskret
	bane(
		"Måne",
		`<rect x="${FIGUR.etikett}" width="${plassB}" height="${FIGUR.bane}" rx="4" class="ft-skinne"/>` +
			dag.måne.bi.map((p) => bånd(p.fra, p.til, "ft-mane-bi", `Biperiode: ${MÅNE_TYPE[p.type]} ${tid(p.midt)}`)).join("") +
			dag.måne.hoved.map((p) => bånd(p.fra, p.til, "ft-mane-hoved", `Hovedperiode: ${MÅNE_TYPE[p.type]} ${tid(p.midt)}`)).join(""),
	);

	// Timeakse: en strek hver tredje time, med klokkeslett i stedets tid
	let akse = "";
	for (let t = dag.start, i = 0; t < dag.slutt; t += 3 * TIME_MS, i++) {
		const px = x(t).toFixed(1);
		akse += `<line x1="${px}" x2="${px}" y1="${FIGUR.akse - 4}" y2="__H__" class="ft-rutenett"/><text x="${px}" y="12" text-anchor="middle" class="ft-akse">${tid(t).slice(0, 2)}</text>`;
	}
	const høyde = FIGUR.akse + baner.length * (FIGUR.bane + FIGUR.mellom);
	akse = akse.replaceAll("__H__", String(høyde - FIGUR.mellom));

	const rader = baner
		.map((b, i) => {
			const y = FIGUR.akse + i * (FIGUR.bane + FIGUR.mellom);
			return `<g transform="translate(0,${y})"><text x="0" y="${FIGUR.bane / 2 + 4}" class="ft-etikett">${b.navn}</text>${b.innhold}</g>`;
		})
		.join("");

	const nå = dag.dato === iDag() ? Date.now() : null;
	const nålinje =
		nå && nå >= dag.start && nå < dag.slutt
			? `<line x1="${x(nå).toFixed(1)}" x2="${x(nå).toFixed(1)}" y1="${FIGUR.akse - 6}" y2="${høyde - FIGUR.mellom}" class="ft-nå"/><text x="${x(nå).toFixed(1)}" y="${høyde + 6}" text-anchor="middle" class="ft-nå-tekst">nå</text>`
			: "";

	return `<svg class="ft-svg" width="${bredde}" height="${høyde + (nå ? 12 : 0)}" viewBox="0 0 ${bredde} ${høyde + (nå ? 12 : 0)}" role="img" aria-label="Beste huggtider gjennom døgnet, ${esc(dagNavn(dag))}">${akse}${rader}${nålinje}</svg>`;
}

/** Forklaring under figuren: hva som ligger i hvert lag denne dagen. */
function figurForklaring(dag) {
	const punkter = [];
	if (dag.tilstand === "midnattssol") punkter.push(`<li><span class="ft-prikk ft-sol"></span><span><strong>Midnattssol</strong> – sola går ikke ned. Det er lyst hele døgnet, så det finnes ingen egen grålysning eller skumring.</span></li>`);
	else if (dag.tilstand === "mørketid") punkter.push(`<li><span class="ft-prikk ft-natt"></span><span><strong>Mørketid</strong> – sola kommer ikke over horisonten i dag.</span></li>`);
	if (dag.trykk) {
		const fall = dag.trykk.filter((p) => p.retning === "faller");
		const stig = dag.trykk.filter((p) => p.retning === "stiger");
		if (!dag.trykk.length) punkter.push(`<li><span class="ft-prikk ft-skinne"></span><span><strong>Lufttrykk:</strong> stabilt (mindre enn 1 hPa på 3 timer).</span></li>`);
		for (const p of fall) punkter.push(`<li><span class="ft-prikk ft-faller"></span><span><strong>${trykkTekst(p)}</strong> – trykkfall før værskifte, ekstra huggvillig.</span></li>`);
		for (const p of stig) punkter.push(`<li><span class="ft-prikk ft-stiger"></span><span>${trykkTekst(p)}</span></li>`);
	}
	if (dag.kaldt)
		punkter.push(
			`<li><span class="ft-prikk ft-kaldt"></span><span><strong>Kaldt vann:</strong> midt på dagen (${tid(dag.kaldtBånd.fra)}–${tid(dag.kaldtBånd.til)}) er ofte best. Døgnets snitt er ${gradTall(dag.temp.snitt)} °C i lufta, så vannet er trolig kaldt.</span></li>`,
		);
	const hoved = dag.måne.hoved.map((p) => `${periode(p)} (${MÅNE_TYPE[p.type]})`).join(", ");
	const bi = dag.måne.bi.map((p) => `${periode(p)} (${MÅNE_TYPE[p.type]})`).join(", ");
	punkter.push(
		`<li><span class="ft-prikk ft-mane-hoved"></span><span><strong>Måne:</strong> ${hoved ? `hovedperiode ${hoved}` : "ingen hovedperiode i dag"}${bi ? `; biperiode ${bi}` : ""}.
			<small class="muted">Månen har svakere faglig belegg enn lys og trykk – bruk den som et ekstra hint.</small></span></li>`,
	);
	return `<ul class="ft-forklaring">${punkter.join("")}</ul>`;
}

// ---------- Tabell ----------
function tabellRad(dag) {
	const dagensDato = iDag();
	const lys = (p) => (dag.tilstand === "midnattssol" ? "Midnattssol" : dag.tilstand === "mørketid" ? "Mørketid" : p ? periode(p) : "–");
	let trykk;
	if (!dag.trykk) trykk = `<span class="muted" title="Ingen værvarsel for denne dagen">–</span>`;
	else if (!dag.trykk.length) trykk = "Stabilt";
	else trykk = dag.trykk.map((p) => `<span class="ft-trykk ${p.retning === "faller" ? "ft-trykk-faller" : "ft-trykk-stiger"}">${p.retning === "faller" ? "↓" : "↑"} ${trykkTekst(p)}</span>`).join("");
	const måne = (liste) => (liste.length ? liste.map((p) => `<span class="ft-tid">${periode(p)} <small>${MÅNE_TYPE[p.type]}</small></span>`).join("") : "–");
	const celle = (etikett, innhold, klasse = "") => `<td data-label="${etikett}"${klasse ? ` class="${klasse}"` : ""}><div class="ft-celle">${innhold}</div></td>`;
	return `<tr data-dato="${dag.dato}" class="${dag.dato === valgtDato ? "valgt" : ""}">
		<th scope="row"><button type="button" class="ft-dag" data-dato="${dag.dato}" aria-pressed="${dag.dato === valgtDato}">${esc(dagNavn(dag, true))}${dag.dato === dagensDato ? ' <small class="ft-idag">i dag</small>' : ""}</button></th>
		${celle("Grålysning", lys(dag.gråLys), "ft-lys")}
		${celle("Skumring", lys(dag.skumring), "ft-lys")}
		${celle("Lufttrykk", trykk, "ft-trykkcelle")}
		${celle("Måne", `${månefaseSvg(dag.måne.fase, dag.måne.lyst)}<span>${Math.round(dag.måne.lyst * 100)} %</span>`, "ft-fase")}
		${celle("Månens hovedperioder", måne(dag.måne.hoved))}
		${celle("Månens biperioder", måne(dag.måne.bi))}
	</tr>`;
}

const GUIDE = `<details class="ft-guide">
	<summary>Slik bruker du tabellen</summary>
	<p class="muted">Dette er tommelfingerregler fra fiskere, ikke noe fasitsvar. Bruk tabellen til å velge <em>når</em> du drar, og se på forholdene ved vannet for å velge <em>hvordan</em>.</p>
	<dl>
		<dt>Lys</dt><dd>Grålysning og skumring er ofte de mest pålitelige periodene, særlig for ørret, abbor og gjedde. Fisken er mer aktiv når lyset skifter.</dd>
		<dt>Lufttrykk</dt><dd>Fallende trykk før et værskifte gir ofte mer huggvillig fisk. Stabilt høyt trykk og klarvær gir oftere en roligere fisk, og rett etter at trykket har snudd og stiger raskt kan det bli en pause.</dd>
		<dt>Vanntemperatur</dt><dd>I kaldt vann (omtrent under 5 °C) er fisken tregere, og det er ofte best midt på dagen når det er varmest. I varmt sommervann er tidlig morgen og sen kveld best, og fisken står gjerne dypere midt på dagen. Tabellen kjenner bare lufttemperaturen, så sjekk vannet selv hvis du kan.</dd>
		<dt>Vind</dt><dd>Litt vind som kruser overflaten gir ofte mer aktiv fisk og bedre dekning for deg. Vind inn mot land samler gjerne næring langs bredden. Sterk vind gjør det vanskelig å fiske, og vind bør også vurderes opp mot sikkerhet på vannet.</dd>
		<dt>Skydekke</dt><dd>Overskyet vær gir ofte fisk som tar over større deler av dagen og står grunnere. Ved sol og klarvær trekker fisken ofte til skygge og dypere vann midt på dagen, så grålysning og skumring blir viktigere.</dd>
		<dt>Måne</dt><dd>Månens betydning er svakest dokumentert. Bruk den som et ekstra hint når lys og trykk allerede peker i samme retning.</dd>
	</dl>
	<p class="muted">Sjekk alltid fiskekort og regler for vannet under «Kart» og «Regler &amp; kort» før du fisker.</p>
</details>`;

// ---------- Visning ----------
function stedHtml() {
	const lat = sted.lat.toLocaleString("nb", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	const lng = sted.lng.toLocaleString("nb", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	return `<div class="ft-sted">
		<div><strong>${esc(sted.navn)}</strong> <small class="muted">${lat}° N, ${lng}° Ø</small></div>
		<form class="ft-sok" role="search">
			<input type="search" name="q" placeholder="Søk sted i Norge" aria-label="Søk etter sted i Norge" autocomplete="off" value="${esc(søkTekst)}">
			<button type="submit">Søk</button>
			<button type="button" data-ft-gps>📍 Min posisjon</button>
		</form>
		<ul class="ft-treff" ${treff.length ? "" : "hidden"}>${treff.map((t, i) => `<li><button type="button" data-ft-treff="${i}">${esc(t.navn)}${t.område ? ` <small class="muted">${esc(t.område)}</small>` : ""}</button></li>`).join("")}</ul>
		<p class="ft-status muted" role="status" ${status ? "" : "hidden"}>${status}</p>
	</div>`;
}

function tegn() {
	const rot = $("#fisketider-content");
	if (!rot) return;
	const dag = dager.find((d) => d.dato === valgtDato) ?? dager[0];
	rot.innerHTML = `${stedHtml()}
		<h3 class="ft-tittel">Beste huggtider gjennom døgnet <small>${dag ? esc(dagNavn(dag)) : ""}</small></h3>
		<div id="ft-figur" class="ft-figur"></div>
		<div id="ft-forklaring">${dag ? figurForklaring(dag) : ""}</div>
		<h3 class="ft-tittel">Huggtabell – de neste tre dagene</h3>
		<div class="ft-tabell-ramme"><table class="ft-tabell">
			<thead><tr><th scope="col">Dag</th><th scope="col">Grålysning</th><th scope="col">Skumring</th><th scope="col">Lufttrykk</th><th scope="col">Måne</th><th scope="col">Hovedperioder</th><th scope="col">Biperioder</th></tr></thead>
			<tbody>${dager.map(tabellRad).join("")}</tbody>
		</table></div>
		<p class="ft-hint muted">Trykk på en dag for å se døgnfiguren for den dagen. Hovedperioder er ±1 time rundt månens høyeste og laveste punkt, biperioder ±30 minutter rundt opp- og nedgang.</p>
		${GUIDE}
		<p class="kilde">Sol og måne er regnet ut i appen og stemmer til noen minutter. Lufttrykk og temperatur: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0). Stedsøk: Open-Meteo/GeoNames.</p>`;
	tegnFigur();
}

/** Tegner figuren i bredden den har fått. Kalles også når panelet skifter størrelse. */
function tegnFigur() {
	const boks = $("#ft-figur");
	const dag = dager.find((d) => d.dato === valgtDato) ?? dager[0];
	if (!boks || !dag) return;
	figurBredde = Math.max(300, Math.floor(boks.clientWidth || 300));
	boks.innerHTML = vinduBånd(dag) + figurSvg(dag, figurBredde);
}

function oppdaterValgtDag() {
	const dag = dager.find((d) => d.dato === valgtDato);
	if (!dag) return;
	for (const r of document.querySelectorAll("#fisketider-content tbody tr")) {
		const valgt = r.dataset.dato === valgtDato;
		r.classList.toggle("valgt", valgt);
		$("button", r).setAttribute("aria-pressed", String(valgt));
	}
	$("#fisketider-content .ft-tittel small").textContent = dagNavn(dag);
	$("#ft-forklaring").innerHTML = figurForklaring(dag);
	tegnFigur();
}

// ---------- Data ----------
const varselNøkkel = (s) => `${s.lat.toFixed(2)},${s.lng.toFixed(2)}`;

async function hentJson(url) {
	const stopp = new AbortController();
	const frist = setTimeout(() => stopp.abort(), NETT_TIDSFRIST_MS);
	try {
		const svar = await fetch(url, { signal: stopp.signal });
		if (!svar.ok) throw new Error(`HTTP ${svar.status}`);
		return await svar.json();
	} finally {
		clearTimeout(frist);
	}
}

/** Timeserie for lufttrykk og temperatur: i dag og seks dager framover, pluss i går som bakgrunn for trykkendringer. */
async function hentVarsel(s) {
	const q = new URLSearchParams({ latitude: s.lat, longitude: s.lng, hourly: "surface_pressure,temperature_2m", timezone: "auto", timeformat: "unixtime", past_days: 1, forecast_days: ANTALL_DAGER });
	const j = await hentJson(`${VARSEL_URL}?${q}`);
	const h = j?.hourly;
	const gyldig = Array.isArray(h?.time) && h.time.length > 24 && h.time.every(Number.isFinite) && Array.isArray(h.surface_pressure) && h.surface_pressure.length === h.time.length;
	if (!gyldig) throw new Error("Uventet svar fra værtjenesten");
	return {
		tider: h.time.map((t) => t * 1000),
		trykk: h.surface_pressure,
		temp: Array.isArray(h.temperature_2m) && h.temperature_2m.length === h.time.length ? h.temperature_2m : h.time.map(() => null),
		tidssone: typeof j.timezone === "string" ? j.timezone : STANDARD_STED.tidssone,
		hentet: Date.now(),
		fraCache: false,
	};
}

function lagretVarsel(s) {
	const c = lesLagret(NØKKEL_VARSEL);
	if (!c || c.nøkkel !== varselNøkkel(s) || !Array.isArray(c.varsel?.tider) || Date.now() - c.varsel.hentet > VARSEL_LAGRET_MAKS_MS) return null;
	return { ...c.varsel, fraCache: true };
}

async function last() {
	status = "Henter værvarsel …";
	tegn();
	try {
		varsel = await hentVarsel(sted);
		lagre(NØKKEL_VARSEL, { nøkkel: varselNøkkel(sted), varsel });
		status = "";
	} catch {
		varsel = lagretVarsel(sted);
		status = varsel
			? `Ingen nett akkurat nå. Viser lagret varsel fra ${new Date(varsel.hentet).toLocaleString("nb", { dateStyle: "short", timeStyle: "short" })}.`
			: "Fikk ikke hentet værvarsel (ingen nett?). Sol og måne er regnet ut i appen, men lufttrykk og temperatur mangler.";
	}
	sisteHenting = Date.now();
	bygg();
}

function bygg() {
	const tz = tidssone();
	dager = byggUke({ tidssone: tz, breddegrad: sted.lat, lengdegrad: sted.lng, varsel }, iDag(), ANTALL_DAGER);
	if (!dager.some((d) => d.dato === valgtDato)) valgtDato = dager[0].dato;
	tegn();
}

async function velgSted(nytt) {
	sted = nytt;
	lagre(NØKKEL_STED, sted);
	treff = [];
	søkTekst = "";
	varsel = null;
	await last();
}

async function søk(tekst) {
	const navn = tekst.trim();
	if (navn.length < 2) return;
	søkTekst = navn;
	status = "Søker …";
	treff = [];
	tegn();
	try {
		const q = new URLSearchParams({ name: navn, count: 8, language: "nb", countryCode: "NO", format: "json" });
		const j = await hentJson(`${STED_URL}?${q}`);
		treff = (j.results ?? []).map((r) => ({ navn: r.name, område: [r.admin2, r.admin1].filter((x) => x && x !== r.name).join(", "), lat: r.latitude, lng: r.longitude, tidssone: r.timezone }));
		status = treff.length ? "" : "Fant ingen steder med det navnet i Norge.";
	} catch {
		status = "Stedsøket krever nett. Prøv igjen når du har dekning.";
	}
	tegn();
}

function bruksPosisjon() {
	if (!("geolocation" in navigator)) {
		status = "Nettleseren støtter ikke posisjon.";
		return tegn();
	}
	status = "Henter posisjon …";
	tegn();
	navigator.geolocation.getCurrentPosition(
		(pos) => velgSted({ navn: "Min posisjon", lat: Number(pos.coords.latitude.toFixed(4)), lng: Number(pos.coords.longitude.toFixed(4)), tidssone: STANDARD_STED.tidssone }),
		(feil) => {
			status = feil.code === feil.PERMISSION_DENIED ? "Du har ikke gitt tilgang til posisjon." : "Fant ikke posisjonen din.";
			tegn();
		},
		{ enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
	);
}

// ---------- Oppstart ----------
/** Kalles hver gang panelet åpnes. Første gang hentes varselet; senere bare når det er eldre enn 30 minutter. */
export async function visFisketider() {
	if (lastet && Date.now() - sisteHenting < VARSEL_GYLDIG_MS) {
		bygg(); // «i dag» kan ha skiftet siden sist
		return;
	}
	lastet = true;
	valgtDato = null;
	await last();
}

const rot = $("#fisketider");
rot?.addEventListener("submit", (e) => {
	if (!e.target.closest(".ft-sok")) return;
	e.preventDefault();
	søk(new FormData(e.target).get("q"));
});
rot?.addEventListener("click", (e) => {
	const dagKnapp = e.target.closest("[data-dato]");
	if (dagKnapp) {
		valgtDato = dagKnapp.dataset.dato;
		oppdaterValgtDag();
		$("#ft-figur")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		return;
	}
	const valgt = e.target.closest("[data-ft-treff]");
	if (valgt) return velgSted(treff[Number(valgt.dataset.ftTreff)]);
	if (e.target.closest("[data-ft-gps]")) bruksPosisjon();
});
// Figuren tegnes i pikslene den har, så den må tegnes på nytt når bredden endres
if (rot && "ResizeObserver" in window) {
	new ResizeObserver(() => {
		const b = $("#ft-figur")?.clientWidth;
		if (b && Math.abs(b - figurBredde) > 4) tegnFigur();
	}).observe(rot);
}
