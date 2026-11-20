// Karmøy Fiskevann – kart over ferskvann (Leaflet + Kartverket topo).
// Alt kjører i nettleseren: data ligger i SQLite i OPFS (se db-worker.js).
import { klar, query } from "/db.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
	String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const KILDER = {
	njff: "https://www.njff.no/fiske/fiskeregler",
	fritidsfiske: "https://www.karmoy.kommune.no/innbygger/kultur-og-fritid/tur-og-friluftsliv/jeg-vil-ut-pa-tur/fritidsfiske/",
	fiskekart: "https://www.karmoy.kommune.no/_f/p1/i62e78360-4026-41be-8709-f2ca6d82222c/tur-og-fiskekart-for-karmoy-kommune.pdf",
};
const LOKALE_UTSALG = ["MX Sport Kopervik", "Basen Redskaper AS", "Salar Sportsfiske"];
const kartsøk = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${q} Karmøy`)}`;

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
	map = L.map("map", { zoomControl: true, maxBounds: [[58.9, 4.8], [59.7, 5.9]], minZoom: 9 }).fitBounds(KARMOY_BOUNDS);

	// Kartverkets topografiske kart (CC BY 4.0). Merk rekkefølgen {z}/{y}/{x}.
	// crossOrigin: siden bruker COEP require-corp; Kartverket svarer med CORS-header.
	L.tileLayer("https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png", {
		maxZoom: 18,
		crossOrigin: true,
		attribution:
			'&copy; <a href="https://www.kartverket.no/">Kartverket</a> · Vann: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
	}).addTo(map);

	map.on("click", lukkAlt);
}

function markerIcon(v) {
	const s = STATUS[v.status];
	const valgt = v.id === valgtId ? " selected" : "";
	if (s.forbud)
		return L.divIcon({ className: `vann-marker${valgt}`, html: '<span class="pin pin-forbud">!</span>', iconSize: [34, 34], iconAnchor: [17, 17] });
	if (v.status === "fiskekort")
		return L.divIcon({ className: `vann-marker${valgt}`, html: '<span class="pin pin-fiskekort"></span>', iconSize: [26, 26], iconAnchor: [13, 13] });
	return L.divIcon({ className: `vann-marker${valgt}`, html: '<span class="pin pin-ukjent"></span>', iconSize: [14, 14], iconAnchor: [7, 7] });
}

function flateStil(v) {
	const farge = cssFarge(STATUS[v.status].farge);
	const valgt = v.id === valgtId;
	return { color: farge, weight: valgt ? 3 : 1.5, fillColor: farge, fillOpacity: valgt ? 0.45 : 0.25 };
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
		<li><span class="pin pin-ukjent"></span><span>Ukjent fiskerett<small>Kontakt grunneier (${antall("ukjent_grunneier")})</small></span></li>`;
}

// ---------- Infoboks for ett vann ----------
function oppfrisk(id) {
	const l = lag.get(id);
	if (!l) return;
	l.marker.setIcon(markerIcon(l.vann));
	l.flate?.setStyle(flateStil(l.vann));
}

function salgHtml(v) {
	const salg = v.salg ?? [];
	const linje = (s) => {
		if (s.type === "vipps")
			return `<li class="salg"><span><strong>Vipps ${esc(s.nummer)}</strong>${v.sone ? `<small>Fiskekort ${esc(v.sone)}</small>` : ""}</span>
				${s.lenke ? `<a href="${esc(s.lenke)}" target="_blank" rel="noopener">Åpne Vipps</a>` : ""}
				<button type="button" data-kopier="${esc(s.nummer)}">Kopier nr.</button></li>`;
		return `<li class="salg"><span><strong>${esc(s.navn)}</strong>${s.sted ? `<small>${esc(s.sted)}</small>` : ""}</span>
			<a href="${esc(s.lenke || kartsøk(s.navn))}" target="_blank" rel="noopener">${s.lenke ? "Nettside" : "Vis på kart"}</a></li>`;
	};
	if (salg.length) return `<h3>Kjøp fiskekort</h3><ul class="salg-liste">${salg.map(linje).join("")}</ul>`;
	return `<h3>Kjøp fiskekort</h3>
		<p class="muted">Fiskekort for ${esc(v.sone)} selges bl.a. hos lokale utsalgssteder – spør etter kort for denne sonen.</p>
		<ul class="salg-liste">${LOKALE_UTSALG.map((n) => linje({ type: "butikk", navn: n })).join("")}</ul>`;
}

function åpneVann(v) {
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
	else
		status = `<div class="alert alert-ukjent"><span class="icon" aria-hidden="true">?</span><div><strong>Ukjent fiskerett – kontakt grunneier</strong>
			Vannet er ikke med i kommunens fiskekart. Fiskeretten tilhører grunneier, så spør om lov før du fisker.</div></div>
			<div class="alert alert-info"><span class="icon" aria-hidden="true">ℹ</span><div>${BARN_INFO}</div></div>`;

	$("#sheet-content").innerHTML = `
		${s.forbud ? status : ""}
		<h2>${esc(v.navn)}</h2>
		${s.forbud ? "" : status}
		${v.beskrivelse ? `<p>${esc(v.beskrivelse)}</p>` : ""}
		<dl>
			${v.arter.length ? `<dt>Arter</dt><dd><div class="chips">${v.arter.map((a) => `<span class="chip">${esc(a)}</span>`).join("")}</div></dd>` : ""}
			${v.adkomst ? `<dt>Parkering og adkomst</dt><dd>${esc(v.adkomst)}<br><small class="muted">Fra kommunens fiskekart – kan være utdatert.</small></dd>` : ""}
			${areal ? `<dt>Areal</dt><dd>${areal}</dd>` : ""}
		</dl>
		<div class="actions">
			<a href="${gmaps}" target="_blank" rel="noopener">Veibeskrivelse</a>
			<a href="${norgeskart}" target="_blank" rel="noopener" class="secondary">Norgeskart</a>
			<a href="${KILDER.fiskekart}" target="_blank" rel="noopener" class="secondary">Kommunens fiskekart</a>
		</div>`;

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
				<p>Utsalgssteder lokalt er bl.a. ${LOKALE_UTSALG.map((n) => `<a href="${kartsøk(n)}" target="_blank" rel="noopener">${esc(n)}</a>`).join(", ")}.
				<a href="${KILDER.fritidsfiske}" target="_blank" rel="noopener">Kilde: Karmøy kommune</a></p>
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
	if (location.hash === "#regler") history.replaceState(null, "", location.pathname);
}

$("#nav-regler").addEventListener("click", () => veksle("#regler"));
$("#nav-legend").addEventListener("click", () => veksle("#legend"));
document.querySelectorAll("[data-lukk]").forEach((b) => b.addEventListener("click", lukkAlt));
document.addEventListener("keydown", (e) => e.key === "Escape" && lukkAlt());
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
		vann = (await query("SELECT * FROM ferskvann ORDER BY areal_m2")).map(tilVann);
	} catch (e) {
		toast(`Klarte ikke laste fiskevann: ${e.message}`, 8000);
		return;
	}
	window.__dbInfo = info; // for feilsøking
	if (info.frakoblet) toast("Du er frakoblet – viser lagrede data.");
	if (!vann.length) toast("Ingen vann er lastet inn ennå.", 6000);
	if (info.lagring === "minne") console.warn("OPFS er ikke tilgjengelig; data lagres ikke lokalt.");

	// Minste vann sist, så de ligger øverst og kan klikkes
	leggTilVann(vann.reverse());
	visTegnforklaring(vann);
	visRegler(info);

	const m = location.hash.match(/^#vann-([wr]\d+)$/);
	if (m && lag.has(m[1])) åpneVann(lag.get(m[1]).vann);
}

init();

// ---------- PWA ----------
if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
