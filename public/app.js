// Karmøy Fiskevann – kart over ferskvann (Leaflet + Kartverket topo)

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
	String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Fiskekort-soner = områdene i databasen. Fargene ligger i style.css.
const SONER = {
	"Vest-Karmøy": "var(--sone-vest)",
	"Øst-Karmøy": "var(--sone-ost)",
	Avaldsnes: "var(--sone-avaldsnes)",
	"Fastlandet/Fosen": "var(--sone-fastland)",
};
const soneFarge = (omrade) => SONER[omrade] ?? "#6b7280";

const KARMOY_BOUNDS = [
	[59.1, 5.1],
	[59.45, 5.45],
];

let map;
const markers = new Map();
let selectedId = null;
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

	// Kartverkets topografiske kart (gratis, CC BY 4.0). Merk rekkefølgen {z}/{y}/{x}.
	L.tileLayer("https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png", {
		maxZoom: 18,
		attribution: '&copy; <a href="https://www.kartverket.no/">Kartverket</a>',
	}).addTo(map);

	map.on("click", closeSheet);
}

function markerIcon(v) {
	const cls = v.forbudVasspest ? "pin pin-forbud" : "pin";
	const style = v.forbudVasspest ? "" : `style="background:${soneFarge(v.omrade)}"`;
	const size = v.forbudVasspest ? 34 : 30;
	return L.divIcon({
		className: `vann-marker${v.id === selectedId ? " selected" : ""}`,
		html: `<span class="${cls}" ${style}>${v.forbudVasspest ? "!" : ""}</span>`,
		iconSize: [size, size],
		iconAnchor: [size / 2, size / 2],
	});
}

function addMarkers(vann) {
	for (const v of vann) {
		const m = L.marker([v.lat, v.lng], {
			icon: markerIcon(v),
			title: v.navn,
			alt: v.forbudVasspest ? `${v.navn} – fiskeforbud` : v.navn,
			keyboard: true,
			riseOnHover: true,
			// Forbudsmarkører alltid øverst
			zIndexOffset: v.forbudVasspest ? 1000 : 0,
		}).addTo(map);
		m.bindTooltip(v.navn, { direction: "top", offset: [0, -16], className: "vann-label" });
		m.on("click", (e) => {
			L.DomEvent.stopPropagation(e);
			openSheet(v);
		});
		markers.set(v.id, { marker: m, vann: v });
	}
}

function renderLegend(vann) {
	const brukt = new Set(vann.map((v) => v.omrade));
	$("#legend-list").innerHTML = Object.keys(SONER)
		.map(
			(o) =>
				`<li><span class="pin" style="background:${SONER[o]}"></span>${esc(o)}${
					brukt.has(o) ? "" : ' <span style="color:var(--muted);font-size:.8em">(ingen vann ennå)</span>'
				}</li>`,
		)
		.join("");
}

// ---------- Detaljark ----------
function field(label, value) {
	return `<dt>${esc(label)}</dt><dd>${value ? esc(value) : '<span class="missing">Ikke registrert</span>'}</dd>`;
}

function refreshIcon(id) {
	if (id != null && markers.has(id)) markers.get(id).marker.setIcon(markerIcon(markers.get(id).vann));
}

function openSheet(v) {
	const prev = selectedId;
	selectedId = v.id;
	refreshIcon(prev);
	refreshIcon(v.id);

	const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`;
	const norgeskart = `https://norgeskart.no/#!?project=norgeskart&layers=1002&zoom=14&lat=${v.lat}&lon=${v.lng}&markerLat=${v.lat}&markerLon=${v.lng}`;

	$("#sheet-content").innerHTML = `
		<h2>${esc(v.navn)}</h2>
		<div class="zone"><span class="pin" style="background:${soneFarge(v.omrade)}"></span>Sone: ${esc(v.omrade)}</div>
		${
			v.forbudVasspest
				? `<div class="alert alert-danger" role="alert"><span class="icon" aria-hidden="true">⚠</span><div><strong>Fiskeforbud</strong>Det er forbud mot fiske i dette vannet på grunn av vasspest. Ikke fisk her, og ikke flytt utstyr, båt eller vann til andre vassdrag.</div></div>`
				: ""
		}
		${
			v.dataVerifisert
				? ""
				: `<div class="alert alert-warn"><div><strong>Ikke verifisert</strong>Arter, fiskekort, parkering og forbud er ikke kontrollert ennå. Sjekk med fiskekortselger før du drar.</div></div>`
		}
		${v.beskrivelse ? `<p>${esc(v.beskrivelse)}</p>` : ""}
		<dl>
			<dt>Arter</dt>
			<dd>${v.arter.length ? `<div class="chips">${v.arter.map((a) => `<span class="chip">${esc(a)}</span>`).join("")}</div>` : '<span class="missing">Ikke registrert</span>'}</dd>
			${field("Fiskekort", v.fiskekortInfo)}
			${field("Parkering", v.parkeringInfo)}
		</dl>
		<div class="actions">
			<a href="${gmaps}" target="_blank" rel="noopener">Veibeskrivelse</a>
			<a href="${norgeskart}" target="_blank" rel="noopener" class="secondary">Åpne i Norgeskart</a>
		</div>`;

	const sheet = $("#sheet");
	sheet.hidden = false;
	sheet.scrollTop = 0;

	// Flytt kartet slik at markøren ikke havner bak arket
	const zoom = Math.max(map.getZoom(), 13);
	const isWide = matchMedia("(min-width: 720px)").matches;
	const offset = isWide ? L.point(-200, 0) : L.point(0, sheet.offsetHeight / 2);
	const center = map.unproject(map.project([v.lat, v.lng], zoom).add(offset), zoom);
	map.flyTo(center, zoom, { duration: 0.6 });

	history.replaceState(null, "", `#vann-${v.id}`);
}

function closeSheet() {
	if ($("#sheet").hidden) return;
	$("#sheet").hidden = true;
	const prev = selectedId;
	selectedId = null;
	refreshIcon(prev);
	history.replaceState(null, "", location.pathname);
}

$("#sheet-close").addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => e.key === "Escape" && closeSheet());

// ---------- Tegnforklaring ----------
$("#legend-toggle").addEventListener("click", () => {
	const el = $("#legend");
	el.hidden = !el.hidden;
	$("#legend-toggle").setAttribute("aria-expanded", String(!el.hidden));
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
async function init() {
	initMap();
	let vann;
	try {
		const res = await fetch("/api/vann");
		if (!res.ok) throw new Error(`Feil ${res.status}`);
		vann = await res.json();
		if (res.headers.get("x-fra-cache")) toast("Du er frakoblet – viser lagrede data.");
	} catch (e) {
		toast(`Klarte ikke hente fiskevann: ${e.message}`, 8000);
		return;
	}
	addMarkers(vann);
	renderLegend(vann);

	const m = location.hash.match(/^#vann-(\d+)$/);
	if (m && markers.has(Number(m[1]))) openSheet(markers.get(Number(m[1])).vann);
}

init();

// ---------- PWA ----------
if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
