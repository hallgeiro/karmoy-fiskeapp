// Karmøy Fiskevann – kart over ferskvann (Leaflet + Kartverket topo).
// Alt kjører i nettleseren: data ligger i SQLite i OPFS (se db-worker.js).
import { klar, query, run } from "/db.js";
import { bildeGruppe } from "/bilder.js";
import { artSvg } from "/arter.js";
import {
	antallFor, eksporterBackup, erfaringerHtml, fangsterHtml, importerBackup, initLogg, kobleListe, merkEndret, oppdaterBackupVarsel,
	tegnFangstpunkt, visMinLogg, åpneErfaringSkjema, åpneFangstSkjema,
} from "/logg.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
	String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const KILDER = {
	njff: "https://www.njff.no/fiske/fiskeregler",
	fritidsfiske: "https://www.karmoy.kommune.no/innbygger/kultur-og-fritid/tur-og-friluftsliv/jeg-vil-ut-pa-tur/fritidsfiske/",
	fiskekart: "https://www.karmoy.kommune.no/_f/p1/i62e78360-4026-41be-8709-f2ca6d82222c/tur-og-fiskekart-for-karmoy-kommune.pdf",
};
// Kjøpesteder per sone, fra kommunens side om fritidsfiske.
// Samme data som UTSALG/SALG_PER_SONE i scripts/hent-vann.mjs (vannene i databasen har sin egen kopi).
const VIPPS_VEST = {
	type: "vipps", navn: "Vipps", nummer: "629636", mottaker: "Vest-Karmøy grunneierlag",
	info: "Skriv inn Vipps-nummeret i Vipps-appen, så ser du hva kortene koster.",
};
const MX = { type: "butikk", navn: "MX Sport Kopervik", adresse: "Henrik Klausens gt. 2, 4250 Kopervik", telefon: ["52 85 12 88", "946 17 676"] };
const BASEN = { type: "butikk", navn: "Basen Redskaper AS", adresse: "Kanalveien, 4280 Skudeneshavn", telefon: ["52 82 72 70"] };
const SALAR = { type: "butikk", navn: "Salar Sportsfiske", adresse: "Salhusvegen 163, 5538 Haugesund", telefon: ["906 51 829"] };
const KJØPESTEDER = {
	"Vest-Karmøy": [VIPPS_VEST, MX, BASEN],
	"Øst-Karmøy": [MX, BASEN],
	Avaldsnes: [MX],
	"Fastlandet/Fosen": [SALAR],
};
// Grunneierlaget som står for fiskekortsalget i hver sone (Tur- og fiskekart for
// Karmøy kommune og kommunens side om fritidsfiske). Avaldsnes er ikke navngitt der.
const GRUNNEIERLAG = {
	"Vest-Karmøy": "Vest-Karmøy grunneierlag",
	"Øst-Karmøy": "Aust-Karmøy grunneierlag",
	Avaldsnes: null,
	"Fastlandet/Fosen": "Fastlandssiden og Fosen grunneierlag",
};
const grunneierlagHtml = (sone) =>
	GRUNNEIERLAG[sone]
		? `<p class="grunneierlag">Fiskekortene utstedes av <strong>${esc(GRUNNEIERLAG[sone])}</strong>.</p>`
		: `<p class="grunneierlag muted">Kommunen oppgir ikke hvilket grunneierlag som står for denne sonen.</p>`;
const kartsøk = (s) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.adresse ? `${s.navn}, ${s.adresse}` : `${s.navn} Karmøy`)}`;
const telLenke = (t) => `<a class="tel" href="tel:+47${t.replace(/\s/g, "")}">${esc(t)}</a>`;

/** Én linje per kjøpested: Vipps med nummer og kopier-knapp, butikk med adresse, telefon og kart. */
function kjøpestedHtml(s) {
	if (s.type === "vipps")
		return `<li class="salg salg-vipps">
			<span><strong>Vipps ${esc(s.nummer)}</strong>${s.mottaker ? `<small>${esc(s.mottaker)}</small>` : ""}${s.info ? `<small>${esc(s.info)}</small>` : ""}</span>
			${s.lenke ? `<a href="${esc(s.lenke)}" target="_blank" rel="noopener">Åpne Vipps</a>` : ""}
			<button type="button" data-kopier="${esc(s.nummer)}">Kopier nr.</button></li>`;
	return `<li class="salg">
		<span><strong>${esc(s.navn)}</strong>${s.adresse ? `<small>${esc(s.adresse)}</small>` : s.sted ? `<small>${esc(s.sted)}</small>` : ""}${
			s.telefon?.length ? `<small>Tlf. ${s.telefon.map(telLenke).join(" / ")}</small>` : ""
		}</span>
		<a href="${esc(s.lenke || kartsøk(s))}" target="_blank" rel="noopener">${s.lenke ? "Nettside" : "Vis på kart"}</a></li>`;
}

// Fargene ligger i style.css. Rød er reservert for forbud.
const STATUS = {
	fiskekort: { navn: "Fiskekort", farge: "var(--status-fiskekort)", forklaring: "Godkjent fiskevann – kjøp fiskekort" },
	forbud_vasspest: { navn: "Fiskeforbud", farge: "var(--danger)", forklaring: "Fiskeforbud (vasspest)", forbud: true },
	forbud_drikkevann: { navn: "Fiskeforbud", farge: "var(--danger)", forklaring: "Fiskeforbud (drikkevann)", forbud: true },
	forbud_annet: { navn: "Fiskeforbud", farge: "var(--danger)", forklaring: "Fiske ikke tillatt", forbud: true },
	ukjent_grunneier: { navn: "Ukjent", farge: "var(--status-ukjent)", forklaring: "Ikke i fiskekartet – kontakt grunneier" },
};
// Leaflet-polygoner trenger ekte farger, ikke CSS-variabler
const cssFarge = (v) => getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim();

const BARN_INFO = `<strong>Barn under 16 år</strong> fisker gratis med stang og håndsnøre i innlandsvann fra 1. januar til 20. august.
	Gjelder ikke i vassdrag med laks eller sjøørret, og ikke i vann med fiskeforbud.`;

const KARMOY_BOUNDS = [
	[59.1, 5.1],
	[59.45, 5.45],
];

let map;
const lag = new Map(); // id → { vann, marker, flate }
let valgtId = null;
let userMarker = null;

function toast(msg, ms = 3500) {
	const el = $("#toast");
	el.textContent = msg;
	el.hidden = false;
	clearTimeout(toast.t);
	toast.t = setTimeout(() => (el.hidden = true), ms);
}

// ---------- Kart ----------
function initMap() {
	map = L.map("map", { zoomControl: true, attributionControl: false, maxBounds: [[58.9, 4.8], [59.7, 5.9]], minZoom: 9 }).fitBounds(KARMOY_BOUNDS);

	// Kartverkets topografiske kart (CC BY 4.0). Merk rekkefølgen {z}/{y}/{x}.
	// crossOrigin: siden bruker COEP require-corp; Kartverket svarer med CORS-header.
	L.tileLayer("https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png", {
		maxZoom: 18,
		crossOrigin: true,
		// Kildene vises bak knappen «© Kilder» ved kartknappene (se index.html)
	}).addTo(map);

	map.on("click", lukkAlt);
}

const ARTER_KILDE = {
	fiskekart: `<a href="${KILDER.fiskekart}" target="_blank" rel="noopener">kommunens fiskekart</a>`,
	gbif: `fiskefunn i <a href="https://www.gbif.org/" target="_blank" rel="noopener">GBIF</a> (NINA, Vannmiljø, Artsobservasjoner m.fl.)`,
};
/** «GBIF 1998–2024 · 5 funn» under arter med funn i GBIF, ellers «Fiskekartet». */
function artFunn(v, art) {
	const g = v.arter_gbif?.[art];
	if (!g) return `<small class="art-funn">${String(v.arter_kilde ?? "").includes("fiskekart") ? "Fiskekartet" : ""}</small>`;
	const [fra, til, n] = g;
	const år = fra == null ? "år ukjent" : fra === til ? `${fra}` : `${fra}–${til}`;
	return `<small class="art-funn" title="${n} funn i GBIF, ${år}">GBIF ${år}<br>${n} funn</small>`;
}

const artKilde = (k) => {
	const deler = String(k ?? "").split(",").map((x) => ARTER_KILDE[x]).filter(Boolean);
	return deler.length ? `Kilde: ${deler.join(" og ")}.` : "";
};

// ---------- Brukerens egne sonemerkinger ----------
// Lagret lokalt i tabellen egne_soner. Gjelder bare vann uten status fra kommunen
// (ukjent_grunneier), og vises tydelig som «din egen merking».
let egne = new Map(); // vann_id → { sone, kilde, opprettet }
let alleVann = [];
const SONER = ["Vest-Karmøy", "Øst-Karmøy", "Avaldsnes", "Fastlandet/Fosen"];
const soneNavn = (sone) => (sone === "Fastlandet/Fosen" ? "Fastlandssiden og Fosen" : sone);
const egenSone = (v) => (v.status === "ukjent_grunneier" ? egne.get(v.id) : undefined);

async function lastEgneSoner() {
	egne = new Map((await query("SELECT vann_id, sone, kilde, opprettet FROM egne_soner")).map((r) => [r.vann_id, r]));
}

function markerIcon(v) {
	const s = STATUS[v.status];
	const valgt = v.id === valgtId ? " selected" : "";
	if (s.forbud)
		return L.divIcon({ className: `vann-marker${valgt}`, html: '<span class="pin pin-forbud">!</span>', iconSize: [34, 34], iconAnchor: [17, 17] });
	if (v.status === "fiskekort")
		return L.divIcon({ className: `vann-marker${valgt}`, html: '<span class="pin pin-fiskekort"></span>', iconSize: [26, 26], iconAnchor: [13, 13] });
	if (egenSone(v))
		return L.divIcon({ className: `vann-marker${valgt}`, html: '<span class="pin pin-egen"></span>', iconSize: [22, 22], iconAnchor: [11, 11] });
	return L.divIcon({ className: `vann-marker${valgt}`, html: '<span class="pin pin-ukjent"></span>', iconSize: [14, 14], iconAnchor: [7, 7] });
}

function flateStil(v) {
	const egen = egenSone(v);
	const farge = cssFarge(egen ? STATUS.fiskekort.farge : STATUS[v.status].farge);
	const valgt = v.id === valgtId;
	return {
		color: farge, weight: valgt ? 3 : egen ? 2 : 1.5, fillColor: farge,
		fillOpacity: egen ? (valgt ? 0.25 : 0.12) : valgt ? 0.45 : 0.25,
		dashArray: egen ? "6 5" : null,
	};
}

function leggTilVann(vann) {
	// Forbud øverst, deretter fiskekort, så ukjente
	const rekkefølge = { forbud_vasspest: 2000, forbud_drikkevann: 2000, forbud_annet: 2000, fiskekort: 1000, ukjent_grunneier: 0 };
	for (const v of vann) {
		const s = STATUS[v.status];
		const åpne = (e) => {
			L.DomEvent.stopPropagation(e);
			åpneVann(v);
		};
		const flate = v.geometri ? L.geoJSON(v.geometri, { style: () => flateStil(v) }).on("click", åpne).addTo(map) : null;
		const marker = L.marker([v.lat, v.lng], {
			icon: markerIcon(v),
			title: v.navn,
			alt: `${v.navn} – ${s.forklaring}`,
			keyboard: true,
			riseOnHover: true,
			zIndexOffset: rekkefølge[v.status],
		})
			.bindTooltip(v.navn, { direction: "top", offset: [0, -12], className: "vann-label" })
			.on("click", åpne)
			.addTo(map);
		lag.set(v.id, { vann: v, marker, flate });
	}
}

function visTegnforklaring(vann) {
	const antall = (...st) => vann.filter((v) => st.includes(v.status)).length;
	$("#legend-list").innerHTML = `
		<li><span class="pin pin-fiskekort"></span><span>Fiskekort<small>Godkjent fiskevann (${antall("fiskekort")})</small></span></li>
		<li><span class="pin pin-forbud">!</span><span>Fiskeforbud<small>Vasspest, drikkevann m.m. (${antall("forbud_vasspest", "forbud_drikkevann", "forbud_annet")})</small></span></li>
		${egne.size ? `<li><span class="pin pin-egen"></span><span>Din egen merking<small>Ikke bekreftet av kommunen (${vann.filter(egenSone).length})</small></span></li>` : ""}
		<li><span class="pin pin-ukjent"></span><span>Ukjent fiskerett<small>Kontakt grunneier (${antall("ukjent_grunneier") - vann.filter(egenSone).length})</small></span></li>`;
}

// ---------- Infoboks for ett vann ----------
function oppfrisk(id) {
	const l = lag.get(id);
	if (!l) return;
	l.marker.setIcon(markerIcon(l.vann));
	l.flate?.setStyle(flateStil(l.vann));
}

function salgHtml(v) {
	const salg = v.salg?.length ? v.salg : KJØPESTEDER[v.sone] ?? [];
	return `<h3>Kjøp fiskekort</h3>
		${grunneierlagHtml(v.sone)}
		<ul class="salg-liste">${salg.map(kjøpestedHtml).join("")}</ul>
		<p class="muted">Kommunen oppgir ikke priser – spør i butikken${salg.some((s) => s.type === "vipps") ? " eller se prisen i Vipps" : ""}.</p>`;
}

let åpentVann = null;
const arkBilder = bildeGruppe();

async function oppdaterAntall(v) {
	const n = await antallFor(v.id);
	for (const el of document.querySelectorAll("#sheet-content [data-antall]")) el.textContent = n[el.dataset.antall] ? `(${n[el.dataset.antall]})` : "";
}

/** Vis én av fanene i infoarket; Erfaringer og Fangster hentes fra databasen. */
async function visFane(fane) {
	const v = åpentVann;
	for (const b of document.querySelectorAll("#sheet-content [data-fane]")) b.setAttribute("aria-selected", String(b.dataset.fane === fane));
	for (const p of document.querySelectorAll("#sheet-content [data-panel]")) p.hidden = p.dataset.panel !== fane;
	const panel = $(`#sheet-content [data-panel="${fane}"]`);
	if (fane === "info") return;
	arkBilder.frigi();
	panel.innerHTML = fane === "fangster" ? await fangsterHtml(v, STATUS[v.status].forbud) : await erfaringerHtml(v);
	arkBilder.fyll(panel);
}

function åpneVann(v, fane = "info") {
	åpentVann = v;
	arkBilder.frigi();
	lukkPanel("#logg");
	lukkPanel("#kilder");
	const forrige = valgtId;
	valgtId = v.id;
	oppfrisk(forrige);
	oppfrisk(v.id);
	lukkPanel("#regler");
	lukkPanel("#legend");

	const s = STATUS[v.status];
	const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`;
	const norgeskart = `https://norgeskart.no/#!?project=norgeskart&layers=1002&zoom=14&lat=${v.lat}&lon=${v.lng}&markerLat=${v.lat}&markerLon=${v.lng}`;
	const areal = v.areal_m2 ? (v.areal_m2 >= 100_000 ? `${(v.areal_m2 / 1e6).toLocaleString("nb", { maximumFractionDigits: 2 })} km²` : `${(v.areal_m2 / 1000).toLocaleString("nb", { maximumFractionDigits: 1 })} daa`) : null;

	let status;
	if (s.forbud)
		status = `<div class="alert alert-danger" role="alert"><span class="icon" aria-hidden="true">⛔</span><div><strong>${esc(s.forklaring)}</strong>${esc(v.advarsel)}</div></div>`;
	else if (v.status === "fiskekort")
		status = `<div class="badge badge-fiskekort">✓ Godkjent fiskevann · Sone ${esc(v.sone)}${v.kartnr ? ` · Nr. ${esc(v.kartnr)} i fiskekartet` : ""}</div>${salgHtml(v)}`;
	else if (egenSone(v)) {
		const e = egenSone(v);
		status = `<div class="egen-merking">
				<div class="badge badge-egen">✎ Din egen merking – ikke bekreftet av kommunen</div>
				<p>Du har merket vannet som del av <strong>${esc(soneNavn(e.sone))}</strong>.${e.kilde ? ` Kilde: «${esc(e.kilde)}».` : ""}
				Vannet er ikke med i kommunens fiskekart – er du usikker, spør grunneier.</p>
				<button type="button" class="lenkeknapp" data-fjern-sone>Fjern merkingen</button>
			</div>
			${salgHtml({ salg: null, sone: e.sone })}`;
	} else
		status = `<div class="alert alert-ukjent"><span class="icon" aria-hidden="true">?</span><div><strong>Ukjent fiskerett – kontakt grunneier</strong>
			Vannet er ikke med i kommunens fiskekart. Fiskeretten tilhører grunneier, så spør om lov før du fisker.</div></div>
			<button type="button" class="knapp-stor sekundær" data-merk-sone>Merk som del av fiskekortsone …</button>
			<div class="alert alert-info"><span class="icon" aria-hidden="true">ℹ</span><div>${BARN_INFO}</div></div>`;

	const arter = `<section class="arter-blokk" aria-label="Arter i vannet"><h3>Arter i vannet</h3>${
		v.arter.length
			? `<ul class="arter">${v.arter.map((a) => `<li>${artSvg(a, 112)}<span>${esc(a)}</span>${artFunn(v, a)}</li>`).join("")}</ul>${
					s.forbud ? `<p class="muted">Artene finnes i vannet, men det er ikke lov å fiske her.</p>` : ""
				}<p class="arter-kilde">${artKilde(v.arter_kilde)}</p>`
			: `<p class="muted arter-ukjent">Arter ikke registrert – verken kommunens fiskekart eller fiskefunn i GBIF har opplysninger om dette vannet.</p>`
	}</section>`;
	const info = `
		${arter}
		${s.forbud ? "" : status}
		${v.beskrivelse ? `<p>${esc(v.beskrivelse)}</p>` : ""}
		<dl>
			${v.adkomst ? `<dt>Parkering og adkomst</dt><dd>${esc(v.adkomst)}<br><small class="muted">Fra kommunens fiskekart – kan være utdatert.</small></dd>` : ""}
			${areal ? `<dt>Areal</dt><dd>${areal}</dd>` : ""}
		</dl>
		<div class="actions">
			<a href="${gmaps}" target="_blank" rel="noopener">Veibeskrivelse</a>
			<a href="${norgeskart}" target="_blank" rel="noopener" class="secondary">Norgeskart</a>
			<a href="${KILDER.fiskekart}" target="_blank" rel="noopener" class="secondary">Kommunens fiskekart</a>
		</div>`;

	$("#sheet-content").innerHTML = `
		${s.forbud ? status : ""}
		<h2>${esc(v.navn)}</h2>
		${s.forbud ? "" : `<button type="button" class="knapp-stor logg-hurtig" data-ny="fangst">+ Logg fangst</button>`}
		<div class="faner" role="tablist" aria-label="Om vannet">
			<button type="button" role="tab" data-fane="info">Info &amp; fiskekort</button>
			<button type="button" role="tab" data-fane="erfaringer">Erfaringer <span class="antall" data-antall="erfaringer"></span></button>
			<button type="button" role="tab" data-fane="fangster">Fangster <span class="antall" data-antall="fangster"></span></button>
		</div>
		<div class="fane-innhold" role="tabpanel" data-panel="info">${info}</div>
		<div class="fane-innhold" role="tabpanel" data-panel="erfaringer" hidden></div>
		<div class="fane-innhold" role="tabpanel" data-panel="fangster" hidden></div>`;
	visFane(fane);
	oppdaterAntall(v);

	const sheet = $("#sheet");
	sheet.hidden = false;
	sheet.scrollTop = 0;

	// Flytt kartet så vannet ikke havner bak infoboksen
	const zoom = Math.max(map.getZoom(), 14);
	const bred = matchMedia("(min-width: 720px)").matches;
	const offset = bred ? L.point(-200, 0) : L.point(0, sheet.offsetHeight / 2);
	map.flyTo(map.unproject(map.project([v.lat, v.lng], zoom).add(offset), zoom), zoom, { duration: 0.6 });

	history.replaceState(null, "", `#vann-${v.id}`);
}

function lukkVann() {
	if ($("#sheet").hidden) return;
	$("#sheet").hidden = true;
	åpentVann = null;
	arkBilder.frigi();
	const forrige = valgtId;
	valgtId = null;
	oppfrisk(forrige);
	history.replaceState(null, "", location.pathname);
}

// ---------- Regler & fiskekort ----------
function visRegler(info) {
	const lagring = { opfs: "lagret i nettleseren (OPFS)", "opfs-sahpool": "lagret i nettleseren (OPFS)", minne: "ikke lagret – hentes på nytt ved hvert besøk" };
	$("#regler-content").innerHTML = `
		<ul class="regler">
			<li><h3>👧 Barn og unge</h3>
				<p>Barn under 16 år fisker gratis med stang og håndsnøre i innlandsvann fra 1. januar til 20. august
				(gjelder ikke lakse- og sjøørretførende vassdrag). <a href="${KILDER.njff}" target="_blank" rel="noopener">Kilde: NJFF</a></p></li>
			<li><h3>🎫 De 4 fiskekortsonene</h3>
				<p><strong>Vest-Karmøy</strong> (bl.a. Vipps 629636), <strong>Øst-Karmøy</strong>, <strong>Avaldsnes</strong>,
				samt <strong>Fastlandssiden og Fosen</strong>.</p>
				<p>Utsalgssteder lokalt er bl.a. MX Sport Kopervik, Basen Redskaper AS og Salar Sportsfiske.
				<a href="${KILDER.fritidsfiske}" target="_blank" rel="noopener">Kilde: Karmøy kommune</a></p>
				${Object.entries(KJØPESTEDER)
					.map(([sone, steder]) => `<h4>${esc(sone === "Fastlandet/Fosen" ? "Fastlandssiden og Fosen" : sone)}</h4>${grunneierlagHtml(sone)}<ul class="salg-liste">${steder.map(kjøpestedHtml).join("")}</ul>`)
					.join("")}
				<p class="muted">Fiskekortsalget drives av grunneierlagene, ikke kommunen, og fiskeretten i vannene utenfor fiskekortsonene tilhører grunneierne. Spør om pris i butikkene eller se prisen i Vipps (Vest-Karmøy).</p>
				<p class="pins-forklaring"><span class="pin pin-fiskekort"></span> Grønne vann på kartet er godkjente fiskevann.</p></li>
			<li class="regel-advarsel"><h3>🦠 Smittevern (vasspest)</h3>
				<p>Tørk eller desinfiser alltid vadere, håv og sluker før du flytter deg til et nytt vann på Karmøy,
				og fisk <strong>aldri</strong> i vann merket med rødt forbud.
				<a href="${KILDER.fiskekart}" target="_blank" rel="noopener">Kilde: Tur- og fiskekart for Karmøy (PDF)</a></p>
				<p class="pins-forklaring"><span class="pin pin-forbud">!</span> Røde vann har fiskeforbud.</p></li>
			<li><h3>🐟 Laks og sjøørret</h3>
				<p>Fiske etter anadrom fisk i elver/vassdrag krever statlig fiskeravgift (for personer over 18 år) i tillegg til eget fiskekort.</p></li>
			<li><h3>🏡 Andre vann</h3>
				<p class="pins-forklaring"><span class="pin pin-ukjent"></span> Gule/grå vann er ikke med i fiskekartet. Fiskeretten tilhører grunneier – spør om lov før du fisker.</p></li>
		</ul>
		<p class="kilde">Vann og kartdata: OpenStreetMap-bidragsytere (ODbL) og Kartverket. Fiskevann-data er ${lagring[info?.lagring] ?? "ikke lastet"}.
		Sjekk alltid kommunens fiskekart før du drar – reglene kan endre seg.</p>`;
}

function åpnePanel(sel) {
	const el = $(sel);
	el.hidden = false;
	el.scrollTop = 0;
	$(`[aria-controls="${sel.slice(1)}"]`)?.setAttribute("aria-expanded", "true");
}
function lukkPanel(sel) {
	$(sel).hidden = true;
	$(`[aria-controls="${sel.slice(1)}"]`)?.setAttribute("aria-expanded", "false");
}
function veksle(sel) {
	if ($(sel).hidden) {
		lukkAlt();
		åpnePanel(sel);
		if (sel === "#logg") visMinLogg();
		if (sel === "#regler") history.replaceState(null, "", "#regler");
	} else {
		lukkPanel(sel);
		if (sel === "#regler") history.replaceState(null, "", location.pathname);
	}
}
function lukkAlt() {
	lukkVann();
	lukkPanel("#regler");
	lukkPanel("#legend");
	lukkPanel("#logg");
	lukkPanel("#kilder");
	if (location.hash === "#regler") history.replaceState(null, "", location.pathname);
}

$("#nav-regler").addEventListener("click", () => veksle("#regler"));
$("#nav-legend").addEventListener("click", () => veksle("#legend"));
$("#nav-logg").addEventListener("click", () => veksle("#logg"));
$("#nav-kilder").addEventListener("click", () => veksle("#kilder"));

// Fangstlogg: faner, «+ Logg fangst», «+ Ny erfaring», backup
kobleListe($("#sheet-content"));
kobleListe($("#logg-content"));
document.addEventListener("click", (e) => {
	const fane = e.target.closest("#sheet-content [data-fane]");
	if (fane) return visFane(fane.dataset.fane);
	const ny = e.target.closest("[data-ny]");
	if (ny) {
		const vann = ny.closest("#sheet") ? åpentVann : null;
		return ny.dataset.ny === "fangst" ? åpneFangstSkjema(vann) : åpneErfaringSkjema(vann);
	}
	if (e.target.closest("[data-merk-sone]") && åpentVann) return åpneSoneSkjema(åpentVann);
	if (e.target.closest("[data-fjern-sone]") && åpentVann) return fjernEgenSone(åpentVann);
	if (e.target.closest("[data-eksporter]")) {
		const knapp = e.target.closest("[data-eksporter]");
		knapp.disabled = true;
		eksporterBackup()
			.catch((err) => toast(`Backup feilet: ${err.message}`, 8000))
			.finally(() => (knapp.disabled = false));
	}
});
document.addEventListener("change", (e) => {
	if (!e.target.matches("[data-importer]") || !e.target.files[0]) return;
	importerBackup(e.target.files[0]).catch((err) => toast(`Gjenoppretting feilet: ${err.message}`, 8000));
	e.target.value = "";
});

function åpneSoneSkjema(v) {
	$("#skjema-innhold").innerHTML = `<form class="skjema" novalidate>
		<h2>Merk ${esc(v.navn)} som del av fiskekortsone</h2>
		<p class="muted">Bruk dette når du vet at vannet har samme regler som en fiskekortsone, f.eks. fordi grunneierlaget har bekreftet det.
		Merkingen lagres bare på denne enheten og vises som «din egen merking», ikke som bekreftet av kommunen.</p>
		<label class="felt">Sone
			<select name="sone" required>
				<option value="">Velg sone …</option>
				${SONER.map((s) => `<option value="${esc(s)}">${esc(soneNavn(s))}</option>`).join("")}
			</select>
		</label>
		<label class="felt">Hvor har du det fra? (valgfritt)
			<input name="kilde" maxlength="200" placeholder="f.eks. Avklart med Vest-Karmøy grunneierlag, mai 2026">
		</label>
		<p class="skjema-feil" role="alert" hidden></p>
		<div class="skjema-knapper"><button type="button" data-avbryt class="sekundær">Avbryt</button><button type="submit">Lagre merking</button></div>
	</form>`;
	$("#skjema").showModal();
	const form = $("#skjema form");
	$("[data-avbryt]", form).addEventListener("click", () => $("#skjema").close());
	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		if (!form.sone.value) {
			$(".skjema-feil", form).textContent = "Velg en sone.";
			$(".skjema-feil", form).hidden = false;
			return;
		}
		await run("INSERT OR REPLACE INTO egne_soner (vann_id, sone, kilde) VALUES (?, ?, ?)", [v.id, form.sone.value, form.kilde.value.trim() || null]);
		await merkEndret();
		$("#skjema").close();
		await egneSonerEndret(v);
		toast(`${v.navn} er merket som del av ${soneNavn(form.sone.value)} (din egen merking).`);
	});
}

async function fjernEgenSone(v) {
	if (!confirm(`Fjerne din merking av ${v.navn}?`)) return;
	await run("DELETE FROM egne_soner WHERE vann_id = ?", [v.id]);
	await merkEndret();
	await egneSonerEndret(v);
	toast("Merkingen er fjernet.");
}

async function egneSonerEndret(v) {
	await lastEgneSoner();
	oppfrisk(v.id);
	visTegnforklaring(alleVann);
	if (åpentVann?.id === v.id) åpneVann(v);
}

/** Kalles når fangster/erfaringer er endret: oppdater det som vises. */
async function påEndring({ fane } = {}) {
	// Sonemerkinger kan ha endret seg (gjenoppretting fra backup)
	const før = egne;
	await lastEgneSoner();
	for (const id of new Set([...før.keys(), ...egne.keys()])) oppfrisk(id);
	visTegnforklaring(alleVann);
	if (åpentVann && !$("#sheet").hidden) {
		const aktiv = fane ?? $("#sheet-content [aria-selected=true]")?.dataset.fane ?? "info";
		await visFane(aktiv);
		await oppdaterAntall(åpentVann);
	}
	if (!$("#logg").hidden) await visMinLogg();
	await tegnFangstpunkt();
}
document.querySelectorAll("[data-lukk]").forEach((b) => b.addEventListener("click", lukkAlt));
document.addEventListener("keydown", (e) => e.key === "Escape" && !$("#skjema").open && lukkAlt());
document.addEventListener("click", async (e) => {
	const knapp = e.target.closest("[data-kopier]");
	if (!knapp) return;
	try {
		await navigator.clipboard.writeText(knapp.dataset.kopier);
		toast(`Kopierte ${knapp.dataset.kopier} – lim inn i Vipps.`);
	} catch {
		toast(`Vipps-nummer: ${knapp.dataset.kopier}`);
	}
});

// ---------- Min posisjon ----------
$("#locate").addEventListener("click", () => {
	if (!("geolocation" in navigator)) return toast("Nettleseren støtter ikke posisjon.");
	const btn = $("#locate");
	btn.classList.add("busy");
	navigator.geolocation.getCurrentPosition(
		(pos) => {
			btn.classList.remove("busy");
			const ll = [pos.coords.latitude, pos.coords.longitude];
			if (userMarker) userMarker.setLatLng(ll);
			else
				userMarker = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: "#1a73e8", fillOpacity: 1 })
					.addTo(map)
					.bindTooltip("Du er her");
			map.flyTo(ll, Math.max(map.getZoom(), 13));
		},
		(err) => {
			btn.classList.remove("busy");
			toast(err.code === err.PERMISSION_DENIED ? "Du har ikke gitt tilgang til posisjon." : "Fant ikke posisjonen din.");
		},
		{ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
	);
});

// ---------- Oppstart ----------
function tilVann(r) {
	return {
		...r,
		arter: r.arter ? r.arter.split(",").map((a) => a.trim()).filter(Boolean) : [],
		salg: r.salg ? JSON.parse(r.salg) : null,
		arter_gbif: r.arter_gbif ? JSON.parse(r.arter_gbif) : null,
		geometri: r.geometri ? JSON.parse(r.geometri) : null,
	};
}

async function init() {
	initMap();
	visRegler(null);
	if (location.hash === "#regler") åpnePanel("#regler");

	let info, vann;
	try {
		info = await klar;
	} catch (e) {
		toast(`Databasen kunne ikke starte: ${e.message}`, 8000);
		return;
	}
	try {
		vann = (await query("SELECT * FROM ferskvann ORDER BY areal_m2")).map(tilVann);
	} catch {
		vann = []; // ingen vann-data ennå (f.eks. første besøk uten nett) – loggen virker likevel
	}
	window.__dbInfo = info; // for feilsøking
	if (info.frakoblet) toast("Du er frakoblet – viser lagrede data.");
	if (!vann.length) toast(info.frakoblet ? "Ingen vann lastet ennå – koble til nett én gang." : "Ingen vann er lastet inn ennå.", 6000);
	if (info.lagring === "minne") console.warn("OPFS er ikke tilgjengelig; data lagres ikke lokalt.");

	// Minste vann sist, så de ligger øverst og kan klikkes
	alleVann = vann;
	await lastEgneSoner().catch(() => {});
	leggTilVann(vann.reverse());
	visTegnforklaring(vann);
	visRegler(info);
	initLogg({ map, vann: new Map(vann.map((v) => [v.id, v])), åpneVann, toast, lagring: info.lagring, påEndring });
	oppdaterBackupVarsel();

	const m = location.hash.match(/^#vann-([a-z0-9-]+)$/);
	if (m && lag.has(m[1])) åpneVann(lag.get(m[1]).vann);
}

init();

// ---------- Versjon ----------
// public/versjon.json skrives av scripts/versjon.mjs ved hver publisering.
async function visVersjon() {
	try {
		const v = await (await fetch("/versjon.json", { cache: "no-cache" })).json();
		const dato = (iso, opt = {}) => new Date(iso).toLocaleDateString("nb", { day: "2-digit", month: "2-digit", year: "numeric", ...opt });
		$("#versjon").textContent = `v${v.versjon} · oppdatert ${dato(v.oppdatert)}`;
		$("#versjon").title = `Appen ble sist oppdatert ${new Date(v.oppdatert).toLocaleString("nb")}`;
		$("#versjon-detaljer").textContent =
			`Appversjon ${v.versjon}${v.commit ? ` (${v.commit})` : ""}, oppdatert ${new Date(v.oppdatert).toLocaleString("nb", { dateStyle: "long", timeStyle: "short" })}.` +
			(v.vanndata ? ` Vann- og artsdata hentet ${dato(v.vanndata, { month: "long", day: "numeric" })}.` : "");
	} catch {
		/* ingen versjonsfil (lokal utvikling uten npm run dev) */
	}
}
visVersjon();

// ---------- PWA ----------
if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
	// Ny versjon av appen har tatt over: last siden på nytt én gang, så gamle og nye
	// filer ikke blandes. Ikke mens et skjema er åpent – da kan man miste det man skrev.
	const haddeKontroller = !!navigator.serviceWorker.controller;
	let lastetPåNytt = false;
	navigator.serviceWorker.addEventListener("controllerchange", () => {
		if (!haddeKontroller || lastetPåNytt) return;
		if (document.querySelector("#skjema")?.open) return toast("Appen er oppdatert – last siden på nytt når du er ferdig.", 8000);
		lastetPåNytt = true;
		location.reload();
	});
}
