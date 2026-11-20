// Personlig fiskedagbok: fangster og erfaringer per vann, med bilder.
// Alt lagres lokalt i nettleseren (SQLite + OPFS) og virker offline.
import { batch, eksporterDb, lagreBildefil, query, run } from "/db.js";
import { alleBilder, bildeGruppe, lagreBilde, slettBilde } from "/bilder.js";

const $ = (sel, rot = document) => rot.querySelector(sel);
export const esc = (s) =>
	String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ARTER = ["Ørret", "Røye", "Gjedde", "Abbor", "Sjøørret", "Laks", "Ål", "Karpe"];
const REDSKAP = ["Sluk", "Spinner", "Wobbler", "Mark", "Mark og dupp", "Flue", "Jig", "Mais/deig"];
const VINDRETNING = ["Nord", "Nordøst", "Øst", "Sørøst", "Sør", "Sørvest", "Vest", "Nordvest", "Vindstille"];

let ctx; // { map, vann: Map<id, vann>, åpneVann, toast, lagring, påEndring }
let fangstLag = null;

// ---------- Små hjelpere ----------
const lokalNå = () => {
	const d = new Date();
	d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
	return d.toISOString().slice(0, 16);
};
const visDato = (s) => {
	if (!s) return "";
	const d = new Date(s.length === 10 ? `${s}T12:00` : s);
	return s.length === 10
		? d.toLocaleDateString("nb", { day: "numeric", month: "short", year: "numeric" })
		: d.toLocaleString("nb", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const vekt = (g) => (g >= 1000 ? `${(g / 1000).toLocaleString("nb", { maximumFractionDigits: 2 })} kg` : `${g} g`);
const mål = (f) => [f.vekt_gram ? vekt(f.vekt_gram) : "", f.lengde_cm ? `${f.lengde_cm.toLocaleString("nb")} cm` : ""].filter(Boolean).join(" · ");
const tall = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));
const datalist = (id, verdier) => `<datalist id="${id}">${verdier.map((v) => `<option value="${esc(v)}">`).join("")}</datalist>`;

let bedtOmVarigLagring = false;
async function beOmVarigLagring() {
	// Ber nettleseren om ikke å slette dataene ved lite plass (særlig viktig på mobil)
	if (bedtOmVarigLagring || !navigator.storage?.persist) return;
	bedtOmVarigLagring = true;
	try {
		await navigator.storage.persist();
	} catch {
		/* ikke støttet */
	}
}

// ---------- Oppstart ----------
export function initLogg(c) {
	ctx = c;
	$("#skjema").addEventListener("close", () => {
		skjemaBilder.frigi();
		$("#skjema-innhold").innerHTML = "";
	});
	$("#skjema").addEventListener("click", (e) => e.target === $("#skjema") && $("#skjema").close());

	let vis = false;
	try {
		vis = localStorage.getItem("visFangstpunkt") === "1";
	} catch {
		/* privat modus */
	}
	$("#vis-fangstpunkt").checked = vis;
	$("#vis-fangstpunkt").addEventListener("change", (e) => {
		try {
			localStorage.setItem("visFangstpunkt", e.target.checked ? "1" : "0");
		} catch {
			/* privat modus */
		}
		tegnFangstpunkt();
	});
	tegnFangstpunkt();
}

// ---------- Tall per vann (til fanene) ----------
export async function antallFor(vannId) {
	const [r] = await query(
		"SELECT (SELECT COUNT(*) FROM fangster WHERE vann_id = ?1) AS fangster, (SELECT COUNT(*) FROM erfaringer WHERE vann_id = ?1) AS erfaringer",
		[vannId],
	);
	return r;
}

// ---------- Lister i infoarket ----------
function fangstKort(f, { visVann = false } = {}) {
	return `<article class="logg-kort" data-type="fangst" data-id="${f.id}">
		${f.bilde_filnavn ? `<img data-bilde="${esc(f.bilde_filnavn)}" alt="Bilde av fangsten" loading="lazy">` : ""}
		<div class="logg-tekst">
			<strong>🐟 ${esc(f.art)}</strong>${mål(f) ? ` <span class="maal">${esc(mål(f))}</span>` : ""}
			<small>${esc(visDato(f.dato))}${visVann && f.vann_navn ? ` · <a href="#vann-${esc(f.vann_id)}" data-gaa-til="${esc(f.vann_id)}">${esc(f.vann_navn)}</a>` : ""}${
				f.lat != null ? ` · <span title="Fiskeplass lagret">📍</span>` : ""
			}</small>
			${f.redskap || f.vaer_vind ? `<small>${esc([f.redskap, f.vaer_vind].filter(Boolean).join(" · "))}</small>` : ""}
			${f.notat ? `<p>${esc(f.notat)}</p>` : ""}
		</div>
		<button type="button" class="slett" data-slett="fangst" data-id="${f.id}" aria-label="Slett fangst">🗑</button>
	</article>`;
}

function erfaringKort(e, { visVann = false } = {}) {
	return `<article class="logg-kort" data-type="erfaring" data-id="${e.id}">
		${e.bilde_filnavn ? `<img data-bilde="${esc(e.bilde_filnavn)}" alt="Bilde" loading="lazy">` : ""}
		<div class="logg-tekst">
			<strong>💡 ${esc(e.tittel)}</strong>
			<small>${esc(visDato(e.dato))}${visVann && e.vann_navn ? ` · <a href="#vann-${esc(e.vann_id)}" data-gaa-til="${esc(e.vann_id)}">${esc(e.vann_navn)}</a>` : ""}</small>
			${e.vindretning_tips ? `<small>🌬 Vind: ${esc(e.vindretning_tips)}</small>` : ""}
			${e.tekst ? `<p>${esc(e.tekst)}</p>` : ""}
		</div>
		<button type="button" class="slett" data-slett="erfaring" data-id="${e.id}" aria-label="Slett erfaring">🗑</button>
	</article>`;
}

/** HTML for fanen «Fangster» for ett vann. */
export async function fangsterHtml(v, forbud) {
	const rader = await query("SELECT * FROM fangster WHERE vann_id = ? ORDER BY dato DESC", [v.id]);
	// «+ Logg fangst» står allerede øverst i infoarket
	return `${forbud ? `<p class="muted">Det er fiskeforbud i dette vannet.</p>` : ""}
		${rader.length ? rader.map((f) => fangstKort(f)).join("") : `<p class="tom">Ingen fangster logget her ennå.</p>`}`;
}

/** HTML for fanen «Erfaringer» for ett vann. */
export async function erfaringerHtml(v) {
	const rader = await query("SELECT * FROM erfaringer WHERE vann_id = ? ORDER BY dato DESC, id DESC", [v.id]);
	return `<button type="button" class="knapp-stor sekundær" data-ny="erfaring">+ Ny erfaring</button>
		${rader.length ? rader.map((e) => erfaringKort(e)).join("") : `<p class="tom">Ingen erfaringer her ennå – noter fiskeplasser, vind og adkomst.</p>`}`;
}

/** Felles klikkhåndtering for lister (slett, gå til vann). Kobles på et container-element én gang. */
export function kobleListe(el) {
	el.addEventListener("click", async (e) => {
		const slett = e.target.closest("[data-slett]");
		if (slett) {
			const type = slett.dataset.slett;
			const tabell = type === "fangst" ? "fangster" : "erfaringer";
			if (!confirm(type === "fangst" ? "Slette denne fangsten?" : "Slette denne erfaringen?")) return;
			const [rad] = await query(`SELECT bilde_filnavn FROM ${tabell} WHERE id = ?`, [Number(slett.dataset.id)]);
			await run(`DELETE FROM ${tabell} WHERE id = ?`, [Number(slett.dataset.id)]);
			await slettBilde(rad?.bilde_filnavn).catch(() => {});
			ctx.toast(type === "fangst" ? "Fangsten er slettet." : "Erfaringen er slettet.");
			await ctx.påEndring();
			return;
		}
		const gå = e.target.closest("[data-gaa-til]");
		if (gå) {
			e.preventDefault();
			const v = ctx.vann.get(gå.dataset.gaaTil);
			if (v) ctx.åpneVann(v);
			else ctx.toast("Vannet finnes ikke lenger i kartdataene.");
		}
	});
}

// ---------- Skjema (dialog) ----------
const skjemaBilder = bildeGruppe();

function vannValg(valgtId) {
	const liste = [...ctx.vann.values()].sort((a, b) => a.navn.localeCompare(b.navn, "nb"));
	const merke = (v) => (v.status.startsWith("forbud") ? " (forbud)" : v.status === "fiskekort" ? " (fiskekort)" : "");
	return `<select name="vann_id">
		<option value="">Annet / ikke på kartet</option>
		${liste.map((v) => `<option value="${esc(v.id)}"${v.id === valgtId ? " selected" : ""}>${esc(v.navn + merke(v))}</option>`).join("")}
	</select>`;
}

function bildeFelt() {
	// Ingen capture-attributt: på mobil kan man da velge kamera eller bildegalleri
	return `<label class="felt">Bilde
		<input type="file" name="bilde" accept="image/*">
		<img class="forhaand" alt="" hidden>
		${ctx.lagring === "minne" ? `<small class="advarsel">Nettleseren lagrer ikke data her (privat vindu?) – bildet blir ikke tatt vare på.</small>` : ""}
	</label>`;
}

function kobleBildeForhåndsvisning(form) {
	const inp = $('input[name="bilde"]', form);
	const img = $(".forhaand", form);
	let url;
	inp.addEventListener("change", () => {
		if (url) URL.revokeObjectURL(url);
		const f = inp.files[0];
		img.hidden = !f;
		if (f) img.src = url = URL.createObjectURL(f);
	});
	$("#skjema").addEventListener("close", () => url && URL.revokeObjectURL(url), { once: true });
}

function åpneDialog(html) {
	$("#skjema-innhold").innerHTML = html;
	$("#skjema").showModal();
	const form = $("#skjema form");
	$("[data-avbryt]", form).addEventListener("click", () => $("#skjema").close());
	return form;
}

/** «+ Logg fangst». vann kan være null (fra Min logg). */
export function åpneFangstSkjema(vann) {
	const form = åpneDialog(`<form class="skjema" novalidate>
		<h2>Logg fangst</h2>
		<label class="felt">Vann ${vannValg(vann?.id)}</label>
		<label class="felt">Tidspunkt <input type="datetime-local" name="dato" value="${lokalNå()}" required></label>
		<label class="felt">Art <input name="art" list="arter" required autocomplete="off" placeholder="f.eks. Ørret"></label>
		${datalist("arter", ARTER)}
		<div class="to-felt">
			<label class="felt">Vekt (gram) <input type="number" name="vekt_gram" inputmode="numeric" min="1" step="1" placeholder="450"></label>
			<label class="felt">Lengde (cm) <input type="number" name="lengde_cm" inputmode="decimal" min="1" step="0.5" placeholder="32"></label>
		</div>
		<label class="felt">Redskap <input name="redskap" list="redskap" autocomplete="off" placeholder="f.eks. Sluk"></label>
		${datalist("redskap", REDSKAP)}
		<label class="felt">Vær og vind <input name="vaer_vind" placeholder="f.eks. Overskyet, svak vind fra sørvest"></label>
		<div class="felt">Fiskeplass
			<div class="gps">
				<button type="button" data-gps>📍 Bruk min posisjon</button>
				<span class="gps-status muted">Valgfritt – merker nøyaktig hvor du tok fisken.</span>
			</div>
			<input type="hidden" name="lat"><input type="hidden" name="lng">
		</div>
		${bildeFelt()}
		<label class="felt">Notat <textarea name="notat" rows="3" placeholder="Agn, dybde, hvor i vannet …"></textarea></label>
		<p class="skjema-feil" role="alert" hidden></p>
		<div class="skjema-knapper"><button type="button" data-avbryt class="sekundær">Avbryt</button><button type="submit">Lagre fangst</button></div>
	</form>`);
	kobleBildeForhåndsvisning(form);

	$("[data-gps]", form).addEventListener("click", () => {
		const status = $(".gps-status", form);
		if (!("geolocation" in navigator)) return (status.textContent = "Nettleseren støtter ikke posisjon.");
		status.textContent = "Henter posisjon …";
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				form.lat.value = pos.coords.latitude.toFixed(6);
				form.lng.value = pos.coords.longitude.toFixed(6);
				status.innerHTML = `Lagret: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)} (±${Math.round(pos.coords.accuracy)} m) <button type="button" data-fjern-gps class="lenkeknapp">Fjern</button>`;
				$("[data-fjern-gps]", form).addEventListener("click", () => {
					form.lat.value = form.lng.value = "";
					status.textContent = "Ingen posisjon lagres.";
				});
			},
			(err) => (status.textContent = err.code === err.PERMISSION_DENIED ? "Du har ikke gitt tilgang til posisjon." : "Fant ikke posisjonen din."),
			{ enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
		);
	});

	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		const feil = $(".skjema-feil", form);
		const art = form.art.value.trim();
		if (!art || !form.dato.value) {
			feil.textContent = "Fyll inn art og tidspunkt.";
			feil.hidden = false;
			return;
		}
		const knapp = $('button[type="submit"]', form);
		knapp.disabled = true;
		knapp.textContent = "Lagrer …";
		try {
			const fil = form.bilde.files[0];
			const bilde = fil ? await lagreBilde(fil, "fangst") : null;
			const v = ctx.vann.get(form.vann_id.value);
			await run(
				`INSERT INTO fangster (vann_id, vann_navn, dato, art, vekt_gram, lengde_cm, redskap, vaer_vind, lat, lng, bilde_filnavn, notat)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					v?.id ?? null,
					v?.navn ?? null,
					form.dato.value,
					art,
					tall(form.vekt_gram.value) ? Math.round(tall(form.vekt_gram.value)) : null,
					tall(form.lengde_cm.value) || null,
					form.redskap.value.trim() || null,
					form.vaer_vind.value.trim() || null,
					tall(form.lat.value),
					tall(form.lng.value),
					bilde,
					form.notat.value.trim() || null,
				],
			);
			beOmVarigLagring();
			$("#skjema").close();
			ctx.toast(`Fangst lagret: ${art}${v ? ` i ${v.navn}` : ""}.`);
			await ctx.påEndring({ fane: "fangster" });
		} catch (err) {
			feil.textContent = `Klarte ikke lagre: ${err.message}`;
			feil.hidden = false;
			knapp.disabled = false;
			knapp.textContent = "Lagre fangst";
		}
	});
}

/** «+ Ny erfaring». */
export function åpneErfaringSkjema(vann) {
	const form = åpneDialog(`<form class="skjema" novalidate>
		<h2>Ny erfaring</h2>
		<label class="felt">Vann ${vannValg(vann?.id)}</label>
		<label class="felt">Dato <input type="date" name="dato" value="${lokalNå().slice(0, 10)}" required></label>
		<label class="felt">Tittel <input name="tittel" required placeholder="f.eks. Best fra odden på østsiden"></label>
		<label class="felt">Beste vindretning <input name="vindretning_tips" list="vindretning" autocomplete="off" placeholder="f.eks. Sørvest"></label>
		${datalist("vindretning", VINDRETNING)}
		<label class="felt">Tips <textarea name="tekst" rows="5" placeholder="Fiskeplasser, adkomst, parkering, dybde, agn …"></textarea></label>
		${bildeFelt()}
		<p class="skjema-feil" role="alert" hidden></p>
		<div class="skjema-knapper"><button type="button" data-avbryt class="sekundær">Avbryt</button><button type="submit">Lagre erfaring</button></div>
	</form>`);
	kobleBildeForhåndsvisning(form);

	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		const feil = $(".skjema-feil", form);
		const tittel = form.tittel.value.trim();
		if (!tittel || !form.dato.value) {
			feil.textContent = "Fyll inn tittel og dato.";
			feil.hidden = false;
			return;
		}
		const knapp = $('button[type="submit"]', form);
		knapp.disabled = true;
		knapp.textContent = "Lagrer …";
		try {
			const fil = form.bilde.files[0];
			const bilde = fil ? await lagreBilde(fil, "erfaring") : null;
			const v = ctx.vann.get(form.vann_id.value);
			await run(
				`INSERT INTO erfaringer (vann_id, vann_navn, dato, tittel, tekst, vindretning_tips, bilde_filnavn) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[v?.id ?? null, v?.navn ?? null, form.dato.value, tittel, form.tekst.value.trim() || null, form.vindretning_tips.value.trim() || null, bilde],
			);
			beOmVarigLagring();
			$("#skjema").close();
			ctx.toast("Erfaringen er lagret.");
			await ctx.påEndring({ fane: "erfaringer" });
		} catch (err) {
			feil.textContent = `Klarte ikke lagre: ${err.message}`;
			feil.hidden = false;
			knapp.disabled = false;
			knapp.textContent = "Lagre erfaring";
		}
	});
}

// ---------- Fangstpunkter på kartet ----------
export async function tegnFangstpunkt() {
	if (fangstLag) {
		fangstLag.remove();
		fangstLag = null;
	}
	if (!$("#vis-fangstpunkt").checked) return;
	const rader = await query("SELECT id, art, dato, vekt_gram, lengde_cm, vann_navn, lat, lng FROM fangster WHERE lat IS NOT NULL AND lng IS NOT NULL");
	fangstLag = L.layerGroup(
		rader.map((f) =>
			L.marker([f.lat, f.lng], {
				icon: L.divIcon({ className: "fangst-pin", html: "🐟", iconSize: [22, 22], iconAnchor: [11, 11] }),
				keyboard: false,
				zIndexOffset: 3000,
			}).bindTooltip(`${esc(f.art)}${mål(f) ? ` · ${esc(mål(f))}` : ""}<br>${esc(visDato(f.dato))}${f.vann_navn ? ` · ${esc(f.vann_navn)}` : ""}`, {
				direction: "top",
				offset: [0, -10],
			}),
		),
	).addTo(ctx.map);
	if (!rader.length) ctx.toast("Ingen fangster med lagret posisjon ennå. Bruk «📍 Bruk min posisjon» når du logger.");
}

// ---------- Min logg ----------
const loggBilder = bildeGruppe();

export async function visMinLogg() {
	const el = $("#logg-content");
	const [fangster, erfaringer] = await Promise.all([
		query("SELECT * FROM fangster ORDER BY dato DESC"),
		query("SELECT * FROM erfaringer ORDER BY dato DESC, id DESC"),
	]);

	// Største fisk per art: vekt først, ellers lengde
	const største = new Map();
	for (const f of fangster) {
		const n = f.art.trim().toLowerCase();
		const b = største.get(n);
		const større = !b || (f.vekt_gram ?? 0) > (b.vekt_gram ?? 0) || ((f.vekt_gram ?? 0) === (b.vekt_gram ?? 0) && (f.lengde_cm ?? 0) > (b.lengde_cm ?? 0));
		if (større) største.set(n, f);
	}
	const perVann = new Map();
	for (const f of fangster) if (f.vann_navn) perVann.set(f.vann_id, { navn: f.vann_navn, id: f.vann_id, n: (perVann.get(f.vann_id)?.n ?? 0) + 1 });
	const besteVann = [...perVann.values()].sort((a, b) => b.n - a.n).slice(0, 3);
	const totalVekt = fangster.reduce((s, f) => s + (f.vekt_gram ?? 0), 0);

	const tidslinje = [...fangster.map((f) => ({ t: f.dato, html: fangstKort(f, { visVann: true }) })), ...erfaringer.map((e) => ({ t: e.dato, html: erfaringKort(e, { visVann: true }) }))]
		.sort((a, b) => (a.t < b.t ? 1 : -1))
		.map((x) => x.html)
		.join("");

	loggBilder.frigi();
	el.innerHTML = `
		<div class="logg-knapper">
			<button type="button" class="knapp-stor" data-ny="fangst">+ Logg fangst</button>
			<button type="button" class="knapp-stor sekundær" data-ny="erfaring">+ Ny erfaring</button>
		</div>
		<div class="stat-rad">
			<div class="stat"><b>${fangster.length}</b><span>fisk</span></div>
			<div class="stat"><b>${totalVekt ? esc(vekt(totalVekt)) : "–"}</b><span>totalt</span></div>
			<div class="stat"><b>${perVann.size}</b><span>vann</span></div>
			<div class="stat"><b>${erfaringer.length}</b><span>erfaringer</span></div>
		</div>
		${
			største.size
				? `<h3>Største fisk per art</h3><ul class="rekorder">${[...største.values()]
						.sort((a, b) => (b.vekt_gram ?? 0) - (a.vekt_gram ?? 0))
						.map((f) => `<li><strong>${esc(f.art)}</strong> ${esc(mål(f) || "–")}<small>${esc(visDato(f.dato))}${f.vann_navn ? ` · ${esc(f.vann_navn)}` : ""}</small></li>`)
						.join("")}</ul>`
				: ""
		}
		${
			besteVann.length
				? `<h3>Beste vann</h3><ol class="beste-vann">${besteVann
						.map((v) => `<li><a href="#vann-${esc(v.id)}" data-gaa-til="${esc(v.id)}">${esc(v.navn)}</a> <span class="muted">${v.n} fisk</span></li>`)
						.join("")}</ol>`
				: ""
		}
		<h3>Tidslinje</h3>
		<div class="tidslinje">${tidslinje || `<p class="tom">Loggen er tom. Trykk «+ Logg fangst» når du får fisk!</p>`}</div>
		<section class="innstillinger">
			<h3>Backup</h3>
			<p class="muted">Loggen og bildene ligger bare i denne nettleseren på denne enheten. Ta backup jevnlig – sletter du nettleserdata, forsvinner de.</p>
			<div class="logg-knapper">
				<button type="button" class="knapp-stor sekundær" data-eksporter>⬇ Eksporter backup (.zip)</button>
				<label class="knapp-stor sekundær filknapp">⬆ Gjenopprett fra backup<input type="file" accept=".zip,application/zip" data-importer hidden></label>
			</div>
			<p class="muted lagring-info"></p>
		</section>`;
	loggBilder.fyll(el);
	visLagringsinfo($(".lagring-info", el));
}

async function visLagringsinfo(el) {
	const deler = [];
	deler.push(ctx.lagring === "minne" ? "⚠ Data lagres ikke i denne nettleseren (privat vindu?)." : "Lagret lokalt i nettleseren (OPFS).");
	try {
		const { usage, quota } = await navigator.storage.estimate();
		deler.push(`Bruker ${(usage / 1e6).toLocaleString("nb", { maximumFractionDigits: 1 })} MB av ${(quota / 1e9).toLocaleString("nb", { maximumFractionDigits: 1 })} GB.`);
		if (navigator.storage.persisted) deler.push((await navigator.storage.persisted()) ? "Varig lagring er slått på." : "Varig lagring er ikke bekreftet av nettleseren – ta backup.");
	} catch {
		/* ikke støttet */
	}
	el.textContent = deler.join(" ");
}

// ---------- Backup (.zip) ----------
let jszipLaster;
function lastJSZip() {
	if (window.JSZip) return Promise.resolve(window.JSZip);
	jszipLaster ??= new Promise((løs, avvis) => {
		const s = Object.assign(document.createElement("script"), { src: "/vendor/jszip/jszip.min.js" });
		s.onload = () => løs(window.JSZip);
		s.onerror = () => avvis(new Error("Klarte ikke laste zip-biblioteket"));
		document.head.append(s);
	});
	return jszipLaster;
}

export async function eksporterBackup() {
	const JSZip = await lastJSZip();
	const [fangster, erfaringer, bilder, dbBytes] = await Promise.all([
		query("SELECT * FROM fangster ORDER BY id"),
		query("SELECT * FROM erfaringer ORDER BY id"),
		alleBilder(),
		eksporterDb(),
	]);
	const zip = new JSZip();
	const nå = new Date();
	zip.file(
		"fiskedagbok.json",
		JSON.stringify({ app: "Karmøy Fiskevann", format: 1, eksportert: nå.toISOString(), fangster, erfaringer }, null, 2),
	);
	zip.file("karmoy.sqlite3", dbBytes);
	const mappe = zip.folder("bilder");
	for (const b of bilder) mappe.file(b.navn, b.fil);
	zip.file(
		"LES-MEG.txt",
		[
			"Backup av fiskedagboka fra Karmøy Fiskevann.",
			"",
			"fiskedagbok.json – fangster og erfaringer (brukes ved gjenoppretting i appen)",
			"karmoy.sqlite3   – hele SQLite-databasen (kan åpnes med f.eks. DB Browser for SQLite)",
			"bilder/          – bildene (JPEG)",
			"",
			"Gjenopprett: Min logg → «Gjenopprett fra backup» og velg denne zip-fila.",
		].join("\n"),
	);
	const blob = await zip.generateAsync({ type: "blob", compression: "STORE" }); // JPEG er allerede komprimert
	const navn = `karmoy-fiskedagbok-${nå.toISOString().slice(0, 10)}.zip`;
	const fil = new File([blob], navn, { type: "application/zip" });
	const url = URL.createObjectURL(fil);
	Object.assign(document.createElement("a"), { href: url, download: navn }).click();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
	ctx.toast(`Backup laget: ${fangster.length} fangster, ${erfaringer.length} erfaringer, ${bilder.length} bilder.`, 6000);
}

const FANGST_KOL = ["id", "vann_id", "vann_navn", "dato", "art", "vekt_gram", "lengde_cm", "redskap", "vaer_vind", "lat", "lng", "bilde_filnavn", "notat", "opprettet"];
const ERFARING_KOL = ["id", "vann_id", "vann_navn", "dato", "tittel", "tekst", "vindretning_tips", "bilde_filnavn", "opprettet"];
const TRYGT_FILNAVN = /^[a-z0-9_-]+\.(jpe?g|png|webp)$/i;

export async function importerBackup(fil) {
	const JSZip = await lastJSZip();
	const zip = await JSZip.loadAsync(fil);
	const json = zip.file("fiskedagbok.json");
	if (!json) throw new Error("Fila er ikke en backup fra denne appen (mangler fiskedagbok.json).");
	const data = JSON.parse(await json.async("string"));
	if (!Array.isArray(data.fangster) || !Array.isArray(data.erfaringer)) throw new Error("Ugyldig backup.");
	const [{ n }] = await query("SELECT (SELECT COUNT(*) FROM fangster) + (SELECT COUNT(*) FROM erfaringer) AS n");
	if (
		!confirm(
			`Gjenopprette ${data.fangster.length} fangster og ${data.erfaringer.length} erfaringer fra ${visDato(data.eksportert?.slice(0, 10))}?` +
				(n ? `\n\nDette erstatter de ${n} oppføringene som ligger på denne enheten nå.` : ""),
		)
	)
		return;

	// Bildene først, så databasen (én transaksjon)
	const iBackup = new Set();
	for (const f of Object.values(zip.files)) {
		const navn = f.name.replace(/^bilder\//, "");
		if (f.dir || !f.name.startsWith("bilder/") || !TRYGT_FILNAVN.test(navn)) continue;
		await lagreBildefil(navn, await f.async("blob"));
		iBackup.add(navn);
	}
	const ins = (tabell, kol, r) => ({ sql: `INSERT INTO ${tabell} (${kol.join(", ")}) VALUES (${kol.map(() => "?").join(", ")})`, bind: kol.map((k) => r[k] ?? null) });
	await batch([
		{ sql: "DELETE FROM fangster" },
		{ sql: "DELETE FROM erfaringer" },
		...data.fangster.map((r) => ins("fangster", FANGST_KOL, r)),
		...data.erfaringer.map((r) => ins("erfaringer", ERFARING_KOL, r)),
	]);
	// Rydd bort bilder som ikke hører til den gjenopprettede loggen
	for (const b of await alleBilder()) if (!iBackup.has(b.navn)) await slettBilde(b.navn).catch(() => {});
	beOmVarigLagring();
	ctx.toast(`Gjenopprettet ${data.fangster.length} fangster og ${data.erfaringer.length} erfaringer.`, 6000);
	await ctx.påEndring();
}
