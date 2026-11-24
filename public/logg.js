// Personlig fiskedagbok: fangster og erfaringer per vann, med bilder.
// Alt lagres lokalt i nettleseren (SQLite + OPFS) og virker offline.
import { batch, eksporterDb, lagreBildefil, query, run } from "/db.js";
import { alleBilder, bildeGruppe, lagreBilde, slettBilde } from "/bilder.js";
import { artSvg } from "/arter.js";

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

// ---------- Backup-påminnelse ----------
// meta.sist_endret settes ved hver endring i loggen, meta.sist_backup ved eksport.
// Er det endret etter siste backup, vises et varselikon på «Min logg».
const settMeta = (nøkkel, verdi) => run("INSERT OR REPLACE INTO meta (nokkel, verdi) VALUES (?, ?)", [nøkkel, verdi]);

export async function backupStatus() {
	const rader = await query("SELECT nokkel, verdi FROM meta WHERE nokkel IN ('sist_endret', 'sist_backup')");
	const m = Object.fromEntries(rader.map((r) => [r.nokkel, r.verdi]));
	return { sistEndret: m.sist_endret ?? null, sistBackup: m.sist_backup ?? null, trengerBackup: !!m.sist_endret && (!m.sist_backup || m.sist_endret > m.sist_backup) };
}

/** Kall etter hver endring av fangster, erfaringer eller egne sonemerkinger. */
export async function merkEndret() {
	await settMeta("sist_endret", new Date().toISOString());
	await oppdaterBackupVarsel();
}

export async function oppdaterBackupVarsel() {
	const { trengerBackup } = await backupStatus();
	const knapp = $("#nav-logg");
	if (!knapp) return;
	knapp.classList.toggle("har-varsel", trengerBackup);
	knapp.setAttribute("aria-label", trengerBackup ? "Min logg – du har endringer uten backup" : "Min logg");
	knapp.title = trengerBackup ? "Endringer uten backup – ta backup i Min logg" : "";
}

const siden = (iso) => {
	const dager = Math.floor((Date.now() - new Date(iso)) / 86_400_000);
	return dager <= 0 ? "i dag" : dager === 1 ? "i går" : `for ${dager} dager siden`;
};

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
			<strong class="art-tittel">${artSvg(f.art, 40)} ${esc(f.art)}</strong>${mål(f) ? ` <span class="maal">${esc(mål(f))}</span>` : ""}
			<small>${esc(visDato(f.dato))}${visVann && f.vann_navn ? ` · <a href="#vann-${esc(f.vann_id)}" data-gaa-til="${esc(f.vann_id)}">${esc(f.vann_navn)}</a>` : ""}${
				f.lat != null ? ` · <span title="Fiskeplass lagret">📍</span>` : ""
			}</small>
			${f.redskap || f.vaer_vind ? `<small>${esc([f.redskap, f.vaer_vind].filter(Boolean).join(" · "))}</small>` : ""}
			${f.notat ? `<p>${esc(f.notat)}</p>` : ""}
		</div>
		<div class="kort-knapper">
			<button type="button" class="rediger" data-rediger="fangst" data-id="${f.id}" aria-label="Rediger fangst">✏️</button>
			<button type="button" class="slett" data-slett="fangst" data-id="${f.id}" aria-label="Slett fangst">🗑</button>
		</div>
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
		<div class="kort-knapper">
			<button type="button" class="rediger" data-rediger="erfaring" data-id="${e.id}" aria-label="Rediger erfaring">✏️</button>
			<button type="button" class="slett" data-slett="erfaring" data-id="${e.id}" aria-label="Slett erfaring">🗑</button>
		</div>
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

/** Felles klikkhåndtering for lister (rediger, slett, gå til vann). Kobles på et container-element én gang. */
export function kobleListe(el) {
	el.addEventListener("click", async (e) => {
		const rediger = e.target.closest("[data-rediger]");
		if (rediger) {
			const fangst = rediger.dataset.rediger === "fangst";
			const [rad] = await query(`SELECT * FROM ${fangst ? "fangster" : "erfaringer"} WHERE id = ?`, [Number(rediger.dataset.id)]);
			if (!rad) return ctx.toast("Fant ikke oppføringen.");
			const vann = ctx.vann.get(rad.vann_id) ?? null;
			return fangst ? åpneFangstSkjema(vann, rad) : åpneErfaringSkjema(vann, rad);
		}
		const slett = e.target.closest("[data-slett]");
		if (slett) {
			const type = slett.dataset.slett;
			const tabell = type === "fangst" ? "fangster" : "erfaringer";
			if (!confirm(type === "fangst" ? "Slette denne fangsten?" : "Slette denne erfaringen?")) return;
			const [rad] = await query(`SELECT bilde_filnavn FROM ${tabell} WHERE id = ?`, [Number(slett.dataset.id)]);
			await run(`DELETE FROM ${tabell} WHERE id = ?`, [Number(slett.dataset.id)]);
			await merkEndret();
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

/** Nedtrekksliste med vann. Et vann som ikke lenger finnes i kartdataene, beholdes som valg ved redigering. */
function vannValg(valgtId, rad = null) {
	const liste = [...ctx.vann.values()].sort((a, b) => a.navn.localeCompare(b.navn, "nb"));
	const merke = (v) => (v.status.startsWith("forbud") ? " (forbud)" : v.status === "fiskekort" ? " (fiskekort)" : "");
	const foreldreløs = rad?.vann_id && !ctx.vann.has(rad.vann_id);
	return `<select name="vann_id">
		<option value="">Annet / ikke på kartet</option>
		${foreldreløs ? `<option value="${esc(rad.vann_id)}" selected>${esc(rad.vann_navn ?? "Ukjent vann")} (ikke på kartet lenger)</option>` : ""}
		${liste.map((v) => `<option value="${esc(v.id)}"${v.id === valgtId ? " selected" : ""}>${esc(v.navn + merke(v))}</option>`).join("")}
	</select>`;
}

/** Vannet som er valgt i skjemaet. Beholder vann som ikke lenger er på kartet når det ikke byttes. */
function vannFraSkjema(form, rad) {
	const valgt = form.vann_id.value;
	const v = ctx.vann.get(valgt);
	if (v) return { id: v.id, navn: v.navn };
	if (valgt && rad?.vann_id === valgt) return { id: rad.vann_id, navn: rad.vann_navn };
	return { id: null, navn: null };
}

function bildeFelt(rad = null) {
	const gammel = rad?.bilde_filnavn;
	// Ingen capture-attributt: på mobil kan man da velge kamera eller bildegalleri
	return `${
		gammel
			? `<div class="felt">Nåværende bilde
				<img class="naavaerende" data-bilde="${esc(gammel)}" alt="Nåværende bilde">
				<label class="bryter"><input type="checkbox" name="fjern_bilde"> Fjern bildet</label>
			</div>`
			: ""
	}
	<label class="felt">${gammel ? "Bytt bilde" : "Bilde"}
		<input type="file" name="bilde" accept="image/*">
		<img class="forhaand" alt="" hidden>
		${ctx.lagring === "minne" ? `<small class="advarsel">Nettleseren lagrer ikke data her (privat vindu?) – bildet blir ikke tatt vare på.</small>` : ""}
	</label>`;
}

function kobleBildeForhåndsvisning(form) {
	const inp = $('input[name="bilde"]', form);
	const img = $(".forhaand", form);
	const gammel = $(".naavaerende", form);
	const fjern = $('input[name="fjern_bilde"]', form);
	const oppdaterGammel = () => gammel && (gammel.hidden = !!inp.files[0] || !!fjern?.checked);
	let url;
	inp.addEventListener("change", () => {
		if (url) URL.revokeObjectURL(url);
		const f = inp.files[0];
		img.hidden = !f;
		if (f) img.src = url = URL.createObjectURL(f);
		oppdaterGammel();
	});
	fjern?.addEventListener("change", oppdaterGammel);
	$("#skjema").addEventListener("close", () => url && URL.revokeObjectURL(url), { once: true });
}

/**
 * Bildet som skal lagres: nytt bilde, ingen bilde (ved «Fjern bildet») eller det gamle.
 * `slett` er det gamle bildet som kan slettes etter at raden er lagret.
 */
async function bildeVedLagring(form, rad, prefiks) {
	const gammel = rad?.bilde_filnavn ?? null;
	const fil = form.bilde.files[0];
	if (fil) return { bilde: await lagreBilde(fil, prefiks), nytt: true, slett: gammel };
	if (form.fjern_bilde?.checked) return { bilde: null, nytt: false, slett: gammel };
	return { bilde: gammel, nytt: false, slett: null };
}

function åpneDialog(html) {
	$("#skjema-innhold").innerHTML = html;
	$("#skjema").showModal();
	skjemaBilder.fyll($("#skjema-innhold"));
	const form = $("#skjema form");
	$("[data-avbryt]", form).addEventListener("click", () => $("#skjema").close());
	return form;
}

/** «+ Logg fangst», eller «Rediger fangst» når rad er gitt. vann kan være null (fra Min logg). */
export function åpneFangstSkjema(vann, rad = null) {
	const redigerer = !!rad;
	const verdi = (k) => esc(rad?.[k] ?? "");
	const form = åpneDialog(`<form class="skjema" novalidate>
		<h2>${redigerer ? "Rediger fangst" : "Logg fangst"}</h2>
		<label class="felt">Vann ${vannValg(vann?.id, rad)}</label>
		<label class="felt">Tidspunkt <input type="datetime-local" name="dato" value="${redigerer ? verdi("dato") : lokalNå()}" required></label>
		<label class="felt">Art <input name="art" list="arter" required autocomplete="off" placeholder="f.eks. Ørret" value="${verdi("art")}"></label>
		${datalist("arter", ARTER)}
		<div class="to-felt">
			<label class="felt">Vekt (gram) <input type="number" name="vekt_gram" inputmode="numeric" min="1" step="1" placeholder="450" value="${verdi("vekt_gram")}"></label>
			<label class="felt">Lengde (cm) <input type="number" name="lengde_cm" inputmode="decimal" min="1" step="0.5" placeholder="32" value="${verdi("lengde_cm")}"></label>
		</div>
		<label class="felt">Redskap <input name="redskap" list="redskap" autocomplete="off" placeholder="f.eks. Sluk" value="${verdi("redskap")}"></label>
		${datalist("redskap", REDSKAP)}
		<label class="felt">Vær og vind <input name="vaer_vind" placeholder="f.eks. Overskyet, svak vind fra sørvest" value="${verdi("vaer_vind")}"></label>
		<div class="felt">Fiskeplass
			<div class="gps">
				<button type="button" data-gps>📍 ${redigerer && rad.lat != null ? "Bruk min posisjon i stedet" : "Bruk min posisjon"}</button>
				<span class="gps-status muted">Valgfritt – merker nøyaktig hvor du tok fisken.</span>
			</div>
			<input type="hidden" name="lat" value="${verdi("lat")}"><input type="hidden" name="lng" value="${verdi("lng")}">
		</div>
		${bildeFelt(rad)}
		<label class="felt">Notat <textarea name="notat" rows="3" placeholder="Agn, dybde, hvor i vannet …">${verdi("notat")}</textarea></label>
		<p class="skjema-feil" role="alert" hidden></p>
		<div class="skjema-knapper"><button type="button" data-avbryt class="sekundær">Avbryt</button><button type="submit">${redigerer ? "Lagre endringer" : "Lagre fangst"}</button></div>
	</form>`);
	kobleBildeForhåndsvisning(form);

	const status = $(".gps-status", form);
	/** Vis lagret posisjon med «Fjern»-knapp. nøyaktighet (meter) kjennes bare for en ny GPS-måling. */
	const visPosisjon = (lat, lng, nøyaktighet) => {
		const pos = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
		status.innerHTML = `Lagret: ${pos}${nøyaktighet != null ? ` (±${Math.round(nøyaktighet)} m)` : ""} <button type="button" data-fjern-gps class="lenkeknapp">Fjern</button>`;
		$("[data-fjern-gps]", form).addEventListener("click", () => {
			form.lat.value = form.lng.value = "";
			status.textContent = "Ingen posisjon lagres.";
		});
	};
	if (redigerer && rad.lat != null && rad.lng != null) visPosisjon(rad.lat, rad.lng, null);

	$("[data-gps]", form).addEventListener("click", () => {
		if (!("geolocation" in navigator)) return (status.textContent = "Nettleseren støtter ikke posisjon.");
		status.textContent = "Henter posisjon …";
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				form.lat.value = pos.coords.latitude.toFixed(6);
				form.lng.value = pos.coords.longitude.toFixed(6);
				visPosisjon(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
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
		const knappTekst = knapp.textContent;
		knapp.disabled = true;
		knapp.textContent = "Lagrer …";
		let bildeInfo = null;
		try {
			bildeInfo = await bildeVedLagring(form, rad, "fangst");
			const v = vannFraSkjema(form, rad);
			const verdier = [
				v.id,
				v.navn,
				form.dato.value,
				art,
				tall(form.vekt_gram.value) ? Math.round(tall(form.vekt_gram.value)) : null,
				tall(form.lengde_cm.value) || null,
				form.redskap.value.trim() || null,
				form.vaer_vind.value.trim() || null,
				tall(form.lat.value),
				tall(form.lng.value),
				bildeInfo.bilde,
				form.notat.value.trim() || null,
			];
			if (redigerer) {
				await run(
					`UPDATE fangster SET vann_id = ?, vann_navn = ?, dato = ?, art = ?, vekt_gram = ?, lengde_cm = ?, redskap = ?, vaer_vind = ?,
					 lat = ?, lng = ?, bilde_filnavn = ?, notat = ? WHERE id = ?`,
					[...verdier, rad.id],
				);
			} else {
				await run(
					`INSERT INTO fangster (vann_id, vann_navn, dato, art, vekt_gram, lengde_cm, redskap, vaer_vind, lat, lng, bilde_filnavn, notat)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					verdier,
				);
				beOmVarigLagring();
			}
			await merkEndret();
			await slettBilde(bildeInfo.slett).catch(() => {});
			$("#skjema").close();
			ctx.toast(redigerer ? "Fangsten er oppdatert." : `Fangst lagret: ${art}${v.navn ? ` i ${v.navn}` : ""}.`);
			await ctx.påEndring({ fane: "fangster" });
		} catch (err) {
			if (bildeInfo?.nytt) await slettBilde(bildeInfo.bilde).catch(() => {}); // ikke la et bilde bli liggende uten rad
			feil.textContent = `Klarte ikke lagre: ${err.message}`;
			feil.hidden = false;
			knapp.disabled = false;
			knapp.textContent = knappTekst;
		}
	});
}

/** «+ Ny erfaring», eller «Rediger erfaring» når rad er gitt. */
export function åpneErfaringSkjema(vann, rad = null) {
	const redigerer = !!rad;
	const verdi = (k) => esc(rad?.[k] ?? "");
	const form = åpneDialog(`<form class="skjema" novalidate>
		<h2>${redigerer ? "Rediger erfaring" : "Ny erfaring"}</h2>
		<label class="felt">Vann ${vannValg(vann?.id, rad)}</label>
		<label class="felt">Dato <input type="date" name="dato" value="${redigerer ? verdi("dato") : lokalNå().slice(0, 10)}" required></label>
		<label class="felt">Tittel <input name="tittel" required placeholder="f.eks. Best fra odden på østsiden" value="${verdi("tittel")}"></label>
		<label class="felt">Beste vindretning <input name="vindretning_tips" list="vindretning" autocomplete="off" placeholder="f.eks. Sørvest" value="${verdi("vindretning_tips")}"></label>
		${datalist("vindretning", VINDRETNING)}
		<label class="felt">Tips <textarea name="tekst" rows="5" placeholder="Fiskeplasser, adkomst, parkering, dybde, agn …">${verdi("tekst")}</textarea></label>
		${bildeFelt(rad)}
		<p class="skjema-feil" role="alert" hidden></p>
		<div class="skjema-knapper"><button type="button" data-avbryt class="sekundær">Avbryt</button><button type="submit">${redigerer ? "Lagre endringer" : "Lagre erfaring"}</button></div>
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
		const knappTekst = knapp.textContent;
		knapp.disabled = true;
		knapp.textContent = "Lagrer …";
		let bildeInfo = null;
		try {
			bildeInfo = await bildeVedLagring(form, rad, "erfaring");
			const v = vannFraSkjema(form, rad);
			const verdier = [v.id, v.navn, form.dato.value, tittel, form.tekst.value.trim() || null, form.vindretning_tips.value.trim() || null, bildeInfo.bilde];
			if (redigerer) {
				await run(
					`UPDATE erfaringer SET vann_id = ?, vann_navn = ?, dato = ?, tittel = ?, tekst = ?, vindretning_tips = ?, bilde_filnavn = ? WHERE id = ?`,
					[...verdier, rad.id],
				);
			} else {
				await run(`INSERT INTO erfaringer (vann_id, vann_navn, dato, tittel, tekst, vindretning_tips, bilde_filnavn) VALUES (?, ?, ?, ?, ?, ?, ?)`, verdier);
				beOmVarigLagring();
			}
			await merkEndret();
			await slettBilde(bildeInfo.slett).catch(() => {});
			$("#skjema").close();
			ctx.toast(redigerer ? "Erfaringen er oppdatert." : "Erfaringen er lagret.");
			await ctx.påEndring({ fane: "erfaringer" });
		} catch (err) {
			if (bildeInfo?.nytt) await slettBilde(bildeInfo.bilde).catch(() => {});
			feil.textContent = `Klarte ikke lagre: ${err.message}`;
			feil.hidden = false;
			knapp.disabled = false;
			knapp.textContent = knappTekst;
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
						.map((f) => `<li class="rekord">${artSvg(f.art, 64)}<div><strong>${esc(f.art)}</strong> ${esc(mål(f) || "–")}<small>${esc(visDato(f.dato))}${f.vann_navn ? ` · ${esc(f.vann_navn)}` : ""}</small></div></li>`)
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
			<div class="backup-status"></div>
			<p class="muted">Loggen og bildene ligger bare i denne nettleseren på denne enheten. Ta backup jevnlig – sletter du nettleserdata, forsvinner de.</p>
			<div class="logg-knapper">
				<button type="button" class="knapp-stor sekundær" data-eksporter>⬇ Eksporter backup (.zip)</button>
				<label class="knapp-stor sekundær filknapp">⬆ Gjenopprett fra backup<input type="file" accept=".zip,application/zip" data-importer hidden></label>
			</div>
			<p class="muted lagring-info"></p>
			<h3>Varig lagring</h3>
			<div class="varig-lagring"></div>
		</section>`;
	loggBilder.fyll(el);
	visLagringsinfo($(".lagring-info", el));
	visBackupStatus($(".backup-status", el));
	visVarigLagring($(".varig-lagring", el));
}

async function visBackupStatus(el) {
	const { sistBackup, trengerBackup, sistEndret } = await backupStatus();
	if (!sistEndret && !sistBackup) return (el.innerHTML = "");
	el.innerHTML = trengerBackup
		? `<p class="backup-varsel" role="status"><span class="varsel-ikon" aria-hidden="true">!</span>
			Du har endringer som ikke er tatt backup av.${sistBackup ? ` Siste backup: ${esc(siden(sistBackup))}.` : " Du har ikke tatt backup ennå."}</p>`
		: `<p class="backup-ok">✓ Backup er oppdatert (${esc(siden(sistBackup))}).</p>`;
}

/** Knapp som ber nettleseren om varig lagring, og viser svaret. */
async function visVarigLagring(el) {
	if (!navigator.storage?.persist || ctx.lagring === "minne") {
		el.innerHTML = `<p class="muted">Denne nettleseren støtter ikke varig lagring${ctx.lagring === "minne" ? " (privat vindu?)" : ""}. Ta backup jevnlig.</p>`;
		return;
	}
	const på = await navigator.storage.persisted().catch(() => false);
	if (på) {
		el.innerHTML = `<p class="backup-ok">✓ Varig lagring er på – nettleseren sletter ikke loggen når det blir lite plass.</p>`;
		return;
	}
	el.innerHTML = `<p class="muted">Uten varig lagring kan nettleseren slette loggen og bildene hvis telefonen får lite plass.</p>
		<button type="button" class="knapp-stor sekundær" data-varig-lagring>🔒 Slå på varig lagring</button>
		<p class="varig-svar muted" role="status"></p>`;
	$("[data-varig-lagring]", el).addEventListener("click", async () => {
		const ok = await navigator.storage.persist().catch(() => false);
		if (ok) {
			ctx.toast("Varig lagring er slått på.");
			return visVarigLagring(el);
		}
		$(".varig-svar", el).innerHTML =
			"Nettleseren sa nei. Den avgjør selv – ofte sier den ja når appen er lagt til på hjemskjermen " +
			"(iPhone: Del → «Legg til på Hjem-skjerm»; Android: meny → «Installer app»). Prøv igjen etterpå, og ta backup i mellomtiden.";
	});
}

async function visLagringsinfo(el) {
	const deler = [];
	deler.push(ctx.lagring === "minne" ? "⚠ Data lagres ikke i denne nettleseren (privat vindu?)." : "Lagret lokalt i nettleseren (OPFS).");
	try {
		const { usage, quota } = await navigator.storage.estimate();
		deler.push(`Bruker ${(usage / 1e6).toLocaleString("nb", { maximumFractionDigits: 1 })} MB av ${(quota / 1e9).toLocaleString("nb", { maximumFractionDigits: 1 })} GB.`);
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
	const [fangster, erfaringer, egneSoner, bilder, dbBytes] = await Promise.all([
		query("SELECT * FROM fangster ORDER BY id"),
		query("SELECT * FROM erfaringer ORDER BY id"),
		query("SELECT * FROM egne_soner ORDER BY vann_id"),
		alleBilder(),
		eksporterDb(),
	]);
	const zip = new JSZip();
	const nå = new Date();
	zip.file(
		"fiskedagbok.json",
		JSON.stringify({ app: "Karmøy Fiskevann", format: 2, eksportert: nå.toISOString(), fangster, erfaringer, egneSoner }, null, 2),
	);
	zip.file("karmoy.sqlite3", dbBytes);
	const mappe = zip.folder("bilder");
	for (const b of bilder) mappe.file(b.navn, b.fil);
	zip.file(
		"LES-MEG.txt",
		[
			"Backup av fiskedagboka fra Karmøy Fiskevann.",
			"",
			"fiskedagbok.json – fangster, erfaringer og egne sonemerkinger (brukes ved gjenoppretting i appen)",
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
	await settMeta("sist_backup", new Date().toISOString());
	await oppdaterBackupVarsel();
	if (!$("#logg").hidden) await visMinLogg();
	ctx.toast(`Backup laget: ${fangster.length} fangster, ${erfaringer.length} erfaringer, ${egneSoner.length} egne sonemerkinger, ${bilder.length} bilder.`, 6000);
}

const FANGST_KOL = ["id", "vann_id", "vann_navn", "dato", "art", "vekt_gram", "lengde_cm", "redskap", "vaer_vind", "lat", "lng", "bilde_filnavn", "notat", "opprettet"];
const EGEN_SONE_KOL = ["vann_id", "sone", "kilde", "opprettet"];
const ERFARING_KOL = ["id", "vann_id", "vann_navn", "dato", "tittel", "tekst", "vindretning_tips", "bilde_filnavn", "opprettet"];
const TRYGT_FILNAVN = /^[a-z0-9_-]+\.(jpe?g|png|webp)$/i;

export async function importerBackup(fil) {
	const JSZip = await lastJSZip();
	const zip = await JSZip.loadAsync(fil);
	const json = zip.file("fiskedagbok.json");
	if (!json) throw new Error("Fila er ikke en backup fra denne appen (mangler fiskedagbok.json).");
	const data = JSON.parse(await json.async("string"));
	if (!Array.isArray(data.fangster) || !Array.isArray(data.erfaringer)) throw new Error("Ugyldig backup.");
	// Backup fra før sonemerkinger fantes (format 1) har ikke egneSoner – da beholdes dagens merkinger
	const egneSoner = Array.isArray(data.egneSoner) ? data.egneSoner : null;
	const [{ n }] = await query(
		"SELECT (SELECT COUNT(*) FROM fangster) + (SELECT COUNT(*) FROM erfaringer)" + (egneSoner ? " + (SELECT COUNT(*) FROM egne_soner)" : "") + " AS n",
	);
	if (
		!confirm(
			`Gjenopprette ${data.fangster.length} fangster, ${data.erfaringer.length} erfaringer` +
				(egneSoner ? ` og ${egneSoner.length} egne sonemerkinger` : "") +
				` fra ${visDato(data.eksportert?.slice(0, 10))}?` +
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
		...(egneSoner ? [{ sql: "DELETE FROM egne_soner" }, ...egneSoner.map((r) => ins("egne_soner", EGEN_SONE_KOL, r))] : []),
	]);
	// Rydd bort bilder som ikke hører til den gjenopprettede loggen
	for (const b of await alleBilder()) if (!iBackup.has(b.navn)) await slettBilde(b.navn).catch(() => {});
	beOmVarigLagring();
	const nå = new Date().toISOString();
	await settMeta("sist_endret", nå);
	await settMeta("sist_backup", nå);
	await oppdaterBackupVarsel();
	ctx.toast(
		`Gjenopprettet ${data.fangster.length} fangster, ${data.erfaringer.length} erfaringer` + (egneSoner ? ` og ${egneSoner.length} sonemerkinger.` : "."),
		6000,
	);
	await ctx.påEndring();
}
