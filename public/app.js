// Karmøy Fiskeapp – frontend (vanilla JS + Leaflet)

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
	String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function api(path, opts = {}) {
	const res = await fetch(path, {
		...opts,
		headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
	});
	if (res.status === 204) return null;
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error || `Feil ${res.status}`);
	return data;
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const fmtDate = new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium", timeStyle: "short" });
const fmtHour = new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" });
const fmtNum = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 });

const TYPE_LABEL = { molo: "Molo", svaberg: "Svaberg", strand: "Strand", bru: "Bru", havn: "Havn" };

let spots = [];
let species = [];
let map;
const markers = new Map();

// ---------- Tabs ----------
function showView(name) {
	document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === name)));
	document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
	if (name === "map") setTimeout(() => map?.invalidateSize(), 0);
	if (name === "log") loadCatches();
	if (name === "stats") loadStats();
}
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));

// ---------- Map ----------
function initMap() {
	map = L.map("map").setView([59.26, 5.24], 10);
	L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
		maxZoom: 18,
		attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
	}).addTo(map);

	for (const s of spots) {
		const m = L.marker([s.lat, s.lon], { title: s.name }).addTo(map);
		m.bindTooltip(s.name);
		m.on("click", () => openSpot(s.id));
		markers.set(s.id, m);
	}
}

function renderSpotList() {
	const panel = $("#spot-panel");
	panel.innerHTML = `
		<p class="muted">Trykk på en fiskeplass på kartet eller i listen.</p>
		<ul id="spot-list" class="spot-list">
			${spots
				.map(
					(s) => `<li><button data-spot="${esc(s.id)}"><span>${esc(s.name)}</span><span class="muted">${esc(TYPE_LABEL[s.type] || s.type)}</span></button></li>`,
				)
				.join("")}
		</ul>`;
	panel.querySelectorAll("[data-spot]").forEach((b) => b.addEventListener("click", () => openSpot(b.dataset.spot)));
}

async function openSpot(id) {
	const panel = $("#spot-panel");
	const s = spots.find((x) => x.id === id);
	if (!s) return;
	map?.setView([s.lat, s.lon], 13, { animate: true });
	markers.get(id)?.openTooltip();

	panel.innerHTML = `
		<button class="link" id="back">← Alle plasser</button>
		<h2>${esc(s.name)}</h2>
		<p><span class="tag">${esc(TYPE_LABEL[s.type] || s.type)}</span></p>
		<p>${esc(s.description)}</p>
		<h3>Vanlige arter</h3>
		<p>${s.species.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</p>
		<h3>Vær neste timer</h3>
		<div id="weather" class="weather"><span class="muted">Henter værvarsel …</span></div>
		<p class="muted" style="font-size:.78rem">Data fra MET Norge (yr)</p>
		<div class="row-between"><h3>Siste fangster her</h3><button class="primary" id="log-here">+ Logg</button></div>
		<ul id="spot-catches" class="catch-list"><li class="muted">Laster …</li></ul>`;

	$("#back").addEventListener("click", renderSpotList);
	$("#log-here").addEventListener("click", () => openCatchDialog(id));

	api(`/api/spots/${id}/weather`)
		.then(({ forecast }) => renderWeather(forecast))
		.catch((e) => ($("#weather").innerHTML = `<span class="error">${esc(e.message)}</span>`));

	api(`/api/spots/${id}`)
		.then((d) => renderCatchList($("#spot-catches"), d.recentCatches, { showSpot: false }))
		.catch((e) => ($("#spot-catches").innerHTML = `<li class="error">${esc(e.message)}</li>`));
}

function renderWeather(forecast) {
	const el = $("#weather");
	if (!el) return;
	// Hver tredje time for å holde det kompakt
	const hours = forecast.filter((_, i) => i % 3 === 0).slice(0, 8);
	el.innerHTML = hours
		.map((h) => {
			// Pilen peker dit vinden blåser (fra-retning + 180°)
			const rot = h.windFromDirection == null ? 0 : h.windFromDirection + 180;
			return `<div class="hour">
				<div class="muted">${fmtHour.format(new Date(h.time))}</div>
				<div class="t">${h.airTemperature == null ? "–" : Math.round(h.airTemperature) + "°"}</div>
				<div><span class="wind-arrow" style="transform:rotate(${rot}deg)">↑</span> ${h.windSpeed == null ? "–" : Math.round(h.windSpeed)}${h.windGust != null ? ` (${Math.round(h.windGust)})` : ""} m/s</div>
				<div class="muted">${h.precipitation ? fmtNum.format(h.precipitation) + " mm" : "opphold"}</div>
			</div>`;
		})
		.join("");
}

// ---------- Catches ----------
function renderCatchList(el, catches, { showSpot = true } = {}) {
	if (!catches.length) {
		el.innerHTML = `<li class="muted">Ingen fangster logget ennå.</li>`;
		return;
	}
	el.innerHTML = catches
		.map((c) => {
			const size = [c.weightKg != null && `${fmtNum.format(c.weightKg)} kg`, c.lengthCm != null && `${fmtNum.format(c.lengthCm)} cm`]
				.filter(Boolean)
				.join(" · ");
			return `<li>
				<div>
					<div class="species">${esc(cap(c.species))}${size ? ` <span class="muted">· ${esc(size)}</span>` : ""}</div>
					<div class="meta">${showSpot ? esc(c.spotName) + " · " : ""}${fmtDate.format(new Date(c.caughtAt))}</div>
					${c.note ? `<div class="meta">${esc(c.note)}</div>` : ""}
				</div>
				<button class="link danger" data-delete="${c.id}" aria-label="Slett fangst">Slett</button>
			</li>`;
		})
		.join("");
	el.querySelectorAll("[data-delete]").forEach((b) =>
		b.addEventListener("click", async () => {
			if (!confirm("Slette denne fangsten?")) return;
			try {
				await api(`/api/catches/${b.dataset.delete}`, { method: "DELETE" });
				b.closest("li").remove();
				if (!el.children.length) el.innerHTML = `<li class="muted">Ingen fangster logget ennå.</li>`;
			} catch (e) {
				alert(e.message);
			}
		}),
	);
}

async function loadCatches() {
	const params = new URLSearchParams();
	const spot = $("#filter-spot").value;
	const sp = $("#filter-species").value;
	if (spot) params.set("spot", spot);
	if (sp) params.set("species", sp);
	const el = $("#catch-list");
	try {
		renderCatchList(el, await api(`/api/catches?${params}`));
	} catch (e) {
		el.innerHTML = `<li class="error">${esc(e.message)}</li>`;
	}
}

// ---------- Dialog ----------
const dialog = $("#catch-dialog");
const form = $("#catch-form");

function toLocalInput(d) {
	const off = d.getTimezoneOffset();
	return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function openCatchDialog(spotId) {
	form.reset();
	$("#form-error").textContent = "";
	if (spotId) form.spotId.value = spotId;
	form.caughtAt.value = toLocalInput(new Date());
	dialog.showModal();
}

$("#new-catch").addEventListener("click", () => openCatchDialog());
$("#cancel-catch").addEventListener("click", () => dialog.close());

form.addEventListener("submit", async (ev) => {
	ev.preventDefault();
	const fd = new FormData(form);
	const body = Object.fromEntries(fd.entries());
	if (body.caughtAt) body.caughtAt = new Date(body.caughtAt).toISOString();
	try {
		const saved = await api("/api/catches", { method: "POST", body: JSON.stringify(body) });
		dialog.close();
		// Oppdater det som er synlig
		if ($("#view-log").classList.contains("active")) loadCatches();
		if ($("#spot-catches")) openSpot(saved.spotId);
	} catch (e) {
		$("#form-error").textContent = e.message;
	}
});

// ---------- Stats ----------
async function loadStats() {
	const el = $("#stats");
	try {
		const { bySpecies, bySpot } = await api("/api/stats");
		if (!bySpecies.length) {
			el.innerHTML = `<p class="muted">Ingen fangster ennå. Logg den første!</p>`;
			return;
		}
		const bars = (rows, labelFn) => {
			const max = Math.max(...rows.map((r) => r.count));
			return rows
				.map(
					(r) => `<div class="bar-row"><span class="label">${esc(labelFn(r))}</span><div class="bar" style="width:${(r.count / max) * 100}%"></div><span class="n">${r.count}</span></div>`,
				)
				.join("");
		};
		const total = bySpecies.reduce((a, r) => a + r.count, 0);
		el.innerHTML = `
			<p><strong>${total}</strong> fangster totalt</p>
			<h3>Per art</h3>${bars(bySpecies, (r) => r.species)}
			<h3>Per plass</h3>${bars(bySpot, (r) => spots.find((s) => s.id === r.spot_id)?.name ?? r.spot_id)}`;
	} catch (e) {
		el.innerHTML = `<p class="error">${esc(e.message)}</p>`;
	}
}

// ---------- Init ----------
async function init() {
	[spots, species] = await Promise.all([api("/api/spots"), api("/api/species")]);

	const spotOpts = spots.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
	const speciesOpts = species.map((s) => `<option value="${esc(s)}">${esc(s[0].toUpperCase() + s.slice(1))}</option>`).join("");
	form.spotId.innerHTML = spotOpts;
	form.species.innerHTML = speciesOpts;
	$("#filter-spot").insertAdjacentHTML("beforeend", spotOpts);
	$("#filter-species").insertAdjacentHTML("beforeend", speciesOpts);
	$("#filter-spot").addEventListener("change", loadCatches);
	$("#filter-species").addEventListener("change", loadCatches);

	renderSpotList();
	try {
		initMap();
	} catch (e) {
		console.error(e);
		$("#map").innerHTML = `<p class="error" style="padding:16px">Kartet kunne ikke lastes. Listen over plasser fungerer fortsatt.</p>`;
	}
}

init().catch((e) => {
	document.querySelector("main").innerHTML = `<p class="error" style="padding:16px">Klarte ikke starte appen: ${esc(e.message)}</p>`;
});
