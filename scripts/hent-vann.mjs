#!/usr/bin/env node
/**
 * Henter alle navngitte ferskvann/innsjøer i Karmøy kommune (kommunenr. 1149)
 * fra OpenStreetMap via Overpass API og skriver public/data/seed.sql.
 *
 * Appen kjører kun i nettleseren: public/db-worker.js laster seed.sql inn i
 * SQLite (WASM, lagret i OPFS) når versjonslinja øverst i fila endrer seg.
 * Fila inneholder både skjema og data for tabellen `ferskvann`.
 *
 *   npm run vann:hent                         # hent fra Overpass, skriv seed.sql
 *   node scripts/hent-vann.mjs --lagre-rå osm.json   # lagre Overpass-svaret også
 *   node scripts/hent-vann.mjs --fra-fil osm.json    # bruk lagret svar (ingen nettverk)
 *   node scripts/hent-vann.mjs --ut annen.sql --med-unavngitte
 *
 * Alle vann får status `ukjent_grunneier`, unntatt de som står i
 * GODKJENTE_VANN (→ `fiskekort`) eller FORBUDSVANN (→ `forbud_*`) nedenfor.
 *
 * Kartdata © OpenStreetMap-bidragsytere, ODbL 1.0 (https://www.openstreetmap.org/copyright).
 */

// ============================================================================
// KONFIGURASJON – rediger her
// ============================================================================

export const SONER = ["Vest-Karmøy", "Øst-Karmøy", "Avaldsnes", "Fastlandet/Fosen"];

/**
 * Utsalgssteder for fiskekort. `lenke` er valgfri: uten lenke viser kartet en
 * kartsøk-lenke til utsalgsstedet (butikk) eller en kopier-knapp (Vipps).
 */
export const UTSALG = {
	vippsVest: { type: "vipps", navn: "Vipps", nummer: "629636" },
	mxSportKopervik: { type: "butikk", navn: "MX Sport Kopervik", sted: "Kopervik" },
	basenRedskaper: { type: "butikk", navn: "Basen Redskaper AS" },
	salarSportsfiske: { type: "butikk", navn: "Salar Sportsfiske" },
};

/** Kilder som vises i appen. */
export const KILDER = {
	fritidsfiske: "https://www.karmoy.kommune.no/innbygger/kultur-og-fritid/tur-og-friluftsliv/jeg-vil-ut-pa-tur/fritidsfiske/",
	fiskekart: "https://www.karmoy.kommune.no/_f/p1/i62e78360-4026-41be-8709-f2ca6d82222c/tur-og-fiskekart-for-karmoy-kommune.pdf",
};

/**
 * Hvor man kjøper fiskekort i hver sone. Gjelder alle godkjente vann i sonen,
 * med mindre vannet har egen `salg` i GODKJENTE_VANN. Er lista tom, viser appen
 * de lokale utsalgsstedene i UTSALG som «bl.a.» og ber brukeren spørre etter
 * kort for riktig sone.
 *
 * TODO: Legg inn hvilke utsalgssteder (UTSALG.mxSportKopervik, .basenRedskaper,
 * .salarSportsfiske) som selger kort for hvilken sone – sjekk kommunens fiskekart.
 */
export const SALG_PER_SONE = {
	"Vest-Karmøy": [UTSALG.vippsVest],
	"Øst-Karmøy": [],
	Avaldsnes: [],
	"Fastlandet/Fosen": [],
};

/**
 * De 43 godkjente fiskevannene fra Karmøy kommunes fiskekart.
 *
 *   navn         navnet slik det står i fiskekartet (matches mot OSM-navnet;
 *                «-vatnet/-vatn/-vannet/-vann» kan utelates eller variere)
 *   sone         én av SONER
 *   osm          valgfri OSM-id ('w123' / 'r456') hvis navnet finnes flere steder
 *   salg         valgfri: overstyrer SALG_PER_SONE for dette vannet
 *   arter        valgfri: 'ørret, røye'
 *   beskrivelse  valgfri
 *
 * Skriptet varsler om navn som ikke finnes i OSM eller som matcher flere vann.
 */
export const GODKJENTE_VANN = [
	// { navn: "Eksempelvatnet", sone: "Vest-Karmøy" },
	// { navn: "Storavatnet", sone: "Øst-Karmøy", osm: "w12345678", arter: "ørret" },
];

export const STANDARD_ADVARSEL = {
	forbud_vasspest:
		"Vasspest er påvist i dette vannet. Ikke fisk her, og ikke flytt båt, utstyr, vann eller planter til andre vassdrag – vasspest sprer seg lett med plantebiter.",
	forbud_drikkevann:
		"Dette vannet er drikkevannskilde. Fiske, bading og ferdsel med båt er ikke tillatt.",
};

/**
 * Vann med fiskeforbud.
 *
 *   navn, osm    som over
 *   status       'forbud_vasspest' eller 'forbud_drikkevann'
 *   advarsel     valgfri: overstyrer STANDARD_ADVARSEL
 *   sone         valgfri
 */
export const FORBUDSVANN = [
	// { navn: "Eksempelvatnet", status: "forbud_vasspest" },
	// { navn: "Drikkevatnet", status: "forbud_drikkevann", advarsel: "Drikkevann for …. Fiske forbudt." },
];

// ============================================================================
// Overpass
// ============================================================================

const KOMMUNENR = "1149";

export const OVERPASS_QUERY = `[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="7"]["ref"="${KOMMUNENR}"]->.kommune;
(
  way["natural"="water"](area.kommune);
  relation["natural"="water"](area.kommune);
  way["landuse"="reservoir"](area.kommune);
  relation["landuse"="reservoir"](area.kommune);
);
out geom;`;

const OVERPASS_URLER = [
	globalThis.process?.env?.OVERPASS_URL,
	"https://overpass-api.de/api/interpreter",
	"https://overpass.kumi.systems/api/interpreter",
].filter(Boolean);

/** Vanntyper som ikke er innsjøer/tjern. */
const IKKE_INNSJO = new Set([
	"river", "stream", "canal", "ditch", "drain", "wastewater", "stream_pool", "moat", "lock",
	"fishpass", "harbour", "lagoon", "reflecting_pool", "fountain", "swimming_pool", "basin",
]);

async function hentOverpass() {
	let sisteFeil;
	for (const url of OVERPASS_URLER) {
		try {
			console.error(`Henter fra ${url} …`);
			const res = await fetch(url, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "karmoy-fiskeapp-import/1.0" },
				body: new URLSearchParams({ data: OVERPASS_QUERY }),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
			return await res.json();
		} catch (e) {
			sisteFeil = e;
			console.error(`  feilet: ${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ""}`);
		}
	}
	throw new Error(`Ingen Overpass-server svarte. Siste feil: ${sisteFeil?.message}`);
}

// ============================================================================
// Geometri
// ============================================================================

const toLngLat = (pts) => pts.map((p) => [p.lon, p.lat]);
const samme = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Grovt, men godt nok for innsjøer: meter per grad ved breddegrad lat0. */
function meterPerGrad(lat0) {
	return [111320 * Math.cos((lat0 * Math.PI) / 180), 110540];
}

function signertAreal(ring, mx, my) {
	let s = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		s += (ring[j][0] * mx) * (ring[i][1] * my) - (ring[i][0] * mx) * (ring[j][1] * my);
	}
	return s / 2;
}

/** Sett sammen åpne way-biter (fra en relation) til lukkede ringer. */
export function settSammenRinger(biter) {
	const igjen = biter.filter((b) => b.length >= 2).map((b) => b.slice());
	const ringer = [];
	let åpne = 0;
	while (igjen.length) {
		let ring = igjen.shift();
		let fant = true;
		while (!samme(ring[0], ring[ring.length - 1]) && fant) {
			fant = false;
			const slutt = ring[ring.length - 1];
			for (let i = 0; i < igjen.length; i++) {
				const b = igjen[i];
				if (samme(b[0], slutt)) ring = ring.concat(b.slice(1));
				else if (samme(b[b.length - 1], slutt)) ring = ring.concat(b.slice(0, -1).reverse());
				else continue;
				igjen.splice(i, 1);
				fant = true;
				break;
			}
		}
		if (samme(ring[0], ring[ring.length - 1]) && ring.length >= 4) ringer.push(ring);
		else åpne++;
	}
	return { ringer, åpne };
}

export function punktIRing([x, y], ring) {
	let inne = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inne = !inne;
	}
	return inne;
}

/** Douglas–Peucker i meter. Beholder alltid første og siste punkt. */
export function forenkleLinje(pts, tolMeter, mx, my) {
	if (pts.length <= 2) return pts;
	const keep = new Uint8Array(pts.length);
	keep[0] = keep[pts.length - 1] = 1;
	const stack = [[0, pts.length - 1]];
	const tol2 = tolMeter * tolMeter;
	while (stack.length) {
		const [a, b] = stack.pop();
		const ax = pts[a][0] * mx, ay = pts[a][1] * my;
		const dx = pts[b][0] * mx - ax, dy = pts[b][1] * my - ay;
		const len2 = dx * dx + dy * dy;
		let maxD = -1, idx = -1;
		for (let i = a + 1; i < b; i++) {
			const px = pts[i][0] * mx - ax, py = pts[i][1] * my - ay;
			let d2;
			if (len2 === 0) d2 = px * px + py * py;
			else {
				const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
				const ex = px - t * dx, ey = py - t * dy;
				d2 = ex * ex + ey * ey;
			}
			if (d2 > maxD) [maxD, idx] = [d2, i];
		}
		if (maxD > tol2) {
			keep[idx] = 1;
			stack.push([a, idx], [idx, b]);
		}
	}
	return pts.filter((_, i) => keep[i]);
}

function forenkleRing(ring, tol, mx, my) {
	// Del ringen i to så Douglas–Peucker har to ulike endepunkter
	const mid = Math.floor(ring.length / 2);
	const a = forenkleLinje(ring.slice(0, mid + 1), tol, mx, my);
	const b = forenkleLinje(ring.slice(mid), tol, mx, my);
	const r = a.concat(b.slice(1));
	return r.length >= 4 ? r : null;
}

const rund = (n) => Math.round(n * 1e5) / 1e5; // ~1 m

/**
 * Lag polygoner av et Overpass-element (out geom).
 * Returnerer [{ ytre: ring, indre: ring[] }] i [lng, lat], eller null.
 */
export function polygonerFraElement(el) {
	if (el.type === "way") {
		const ring = toLngLat(el.geometry ?? []);
		if (ring.length < 4 || !samme(ring[0], ring[ring.length - 1])) return null;
		return [{ ytre: ring, indre: [] }];
	}
	if (el.type === "relation") {
		const medlemmer = (el.members ?? []).filter((m) => m.type === "way" && m.geometry);
		const ytre = settSammenRinger(medlemmer.filter((m) => m.role !== "inner").map((m) => toLngLat(m.geometry))).ringer;
		const indre = settSammenRinger(medlemmer.filter((m) => m.role === "inner").map((m) => toLngLat(m.geometry))).ringer;
		if (!ytre.length) return null;
		const polys = ytre.map((r) => ({ ytre: r, indre: [] }));
		for (const r of indre) polys.find((p) => punktIRing(r[0], p.ytre))?.indre.push(r);
		return polys;
	}
	return null;
}

/** Punkt for markøren: tyngdepunkt hvis det ligger i vannet, ellers midt på bredeste tverrsnitt. */
export function merkepunkt(poly) {
	const { ytre, indre } = poly;
	const iVann = (p) => punktIRing(p, ytre) && !indre.some((r) => punktIRing(p, r));
	let cx = 0, cy = 0, a = 0;
	for (let i = 0, j = ytre.length - 1; i < ytre.length; j = i++) {
		const f = ytre[j][0] * ytre[i][1] - ytre[i][0] * ytre[j][1];
		cx += (ytre[j][0] + ytre[i][0]) * f;
		cy += (ytre[j][1] + ytre[i][1]) * f;
		a += f;
	}
	if (a !== 0) {
		const c = [cx / (3 * a), cy / (3 * a)];
		if (iVann(c)) return c;
	}
	const ys = ytre.map((p) => p[1]);
	const [ymin, ymax] = [Math.min(...ys), Math.max(...ys)];
	let best = null, bestW = -1;
	for (let k = 1; k < 20; k++) {
		const y = ymin + ((ymax - ymin) * k) / 20;
		const xs = [];
		for (const ring of [ytre, ...indre]) {
			for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
				const [xi, yi] = ring[i], [xj, yj] = ring[j];
				if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
			}
		}
		xs.sort((p, q) => p - q);
		for (let i = 0; i + 1 < xs.length; i += 2) {
			if (xs[i + 1] - xs[i] > bestW) [bestW, best] = [xs[i + 1] - xs[i], [(xs[i] + xs[i + 1]) / 2, y]];
		}
	}
	return best ?? ytre[0];
}

/** Bygg rad-data (uten status) fra ett Overpass-element. */
export function vannFraElement(el, { tolMeter = 4 } = {}) {
	const polys = polygonerFraElement(el);
	if (!polys) return null;
	const lat0 = polys[0].ytre[0][1];
	const [mx, my] = meterPerGrad(lat0);
	const arealAv = (p) => Math.abs(signertAreal(p.ytre, mx, my)) - p.indre.reduce((s, r) => s + Math.abs(signertAreal(r, mx, my)), 0);
	const areal = polys.reduce((s, p) => s + arealAv(p), 0);
	const størst = polys.reduce((a, b) => (arealAv(b) > arealAv(a) ? b : a));
	const [lng, lat] = merkepunkt(størst);

	// GeoJSON: ytre ring mot klokka, indre med klokka (RFC 7946)
	const orienter = (ring, mot) => ((signertAreal(ring, mx, my) > 0) === mot ? ring : ring.slice().reverse());
	const lag = (tol) => {
		const ps = [];
		for (const p of polys) {
			const ytre = forenkleRing(p.ytre, tol, mx, my);
			if (!ytre) continue;
			const indre = p.indre.map((r) => forenkleRing(r, tol, mx, my)).filter(Boolean);
			ps.push([orienter(ytre, true), ...indre.map((r) => orienter(r, false))].map((r) => r.map(([x, y]) => [rund(x), rund(y)])));
		}
		if (!ps.length) return null;
		return ps.length === 1 ? { type: "Polygon", coordinates: ps[0] } : { type: "MultiPolygon", coordinates: ps };
	};
	// D1 tåler maks 100 kB per SQL-setning – forenkle mer for svært store vann
	let tol = tolMeter, geometri = lag(tol);
	while (geometri && JSON.stringify(geometri).length > 80_000) geometri = lag((tol *= 2));

	return {
		id: `${el.type[0]}${el.id}`,
		navn: el.tags?.name?.trim() || null,
		lat: rund(lat),
		lng: rund(lng),
		areal_m2: Math.round(areal),
		geometri,
	};
}

/** Er elementet en innsjø/tjern/magasin (ikke elv, kanal, basseng …)? */
export function erInnsjo(el) {
	const t = el.tags ?? {};
	if (t.natural !== "water" && t.landuse !== "reservoir") return false;
	if (IKKE_INNSJO.has(t.water)) return false;
	if (t.salt === "yes") return false;
	return true;
}

// ============================================================================
// Kobling mot konfigurasjonen
// ============================================================================

export function normaliserNavn(navn) {
	return navn
		.normalize("NFC")
		.toLowerCase()
		.replace(/\(.*?\)/g, " ")
		.replace(/[\s\-–.]+/g, "");
}
/** «Stiklevatnet», «Stiklevatn» og «Stiklevannet» → «stikle». */
const navnestamme = (navn) => normaliserNavn(navn).replace(/(vatnet|vatna|vatn|vannet|vann)$/, "");

/** Finn OSM-vann for en konfig-oppføring. Returnerer { treff: vann[], feil?: string }. */
export function finnVann(oppf, vann) {
	if (oppf.osm) {
		const v = vann.find((x) => x.id === oppf.osm);
		return v ? { treff: [v] } : { treff: [], feil: `OSM-id ${oppf.osm} finnes ikke i datasettet` };
	}
	let treff = vann.filter((v) => normaliserNavn(v.navn) === normaliserNavn(oppf.navn));
	if (!treff.length) treff = vann.filter((v) => navnestamme(v.navn) === navnestamme(oppf.navn));
	if (!treff.length) return { treff, feil: "fant ikke vannet i OSM – sjekk navnet eller oppgi osm-id" };
	if (treff.length > 1)
		return { treff: [], feil: `navnet matcher ${treff.length} vann (${treff.map((v) => `${v.id} «${v.navn}»`).join(", ")}) – oppgi osm-id` };
	return { treff };
}

/**
 * Sett status, sone, salg og advarsel på hvert vann.
 * Returnerer { rader, advarsler }.
 */
export function kobleStatus(vann, { godkjente = GODKJENTE_VANN, forbud = FORBUDSVANN, salgPerSone = SALG_PER_SONE } = {}) {
	const advarsler = [];
	const rader = new Map(
		vann.map((v) => [v.id, { ...v, status: "ukjent_grunneier", sone: null, salg: null, advarsel: null, arter: null, beskrivelse: null }]),
	);

	for (const g of godkjente) {
		if (!SONER.includes(g.sone)) {
			advarsler.push(`Godkjent «${g.navn}»: ukjent sone «${g.sone}». Gyldige: ${SONER.join(", ")}`);
			continue;
		}
		const { treff, feil } = finnVann(g, vann);
		if (feil) {
			advarsler.push(`Godkjent «${g.navn}»: ${feil}`);
			continue;
		}
		const r = rader.get(treff[0].id);
		Object.assign(r, {
			status: "fiskekort",
			sone: g.sone,
			salg: g.salg ?? salgPerSone[g.sone] ?? [],
			arter: g.arter ?? null,
			beskrivelse: g.beskrivelse ?? null,
		});
		if (!r.salg.length) advarsler.push(`Godkjent «${g.navn}»: ingen salgsinfo for sone ${g.sone} (SALG_PER_SONE)`);
	}

	for (const f of forbud) {
		if (!STANDARD_ADVARSEL[f.status]) {
			advarsler.push(`Forbud «${f.navn}»: ugyldig status «${f.status}» (forbud_vasspest / forbud_drikkevann)`);
			continue;
		}
		const { treff, feil } = finnVann(f, vann);
		if (feil) {
			advarsler.push(`Forbud «${f.navn}»: ${feil}`);
			continue;
		}
		const r = rader.get(treff[0].id);
		if (r.status === "fiskekort") advarsler.push(`«${r.navn}» står både som godkjent og med forbud – forbudet gjelder`);
		Object.assign(r, {
			status: f.status,
			sone: f.sone ?? r.sone,
			salg: null,
			advarsel: f.advarsel ?? STANDARD_ADVARSEL[f.status],
		});
	}
	return { rader: [...rader.values()], advarsler };
}

// ============================================================================
// SQL
// ============================================================================

export function sqlVerdi(v) {
	if (v === null || v === undefined) return "NULL";
	if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
	if (typeof v === "object") v = JSON.stringify(v);
	return `'${String(v).replace(/'/g, "''").replace(/[\r\n]+/g, " ")}'`;
}

/** Skjema. Tabellen er avledet data og lages på nytt ved hver import. */
export const SKJEMA = `DROP TABLE IF EXISTS ferskvann;
CREATE TABLE ferskvann (
	id          TEXT PRIMARY KEY,  -- OSM-id: 'w123' (way) eller 'r456' (relation)
	navn        TEXT NOT NULL,
	status      TEXT NOT NULL DEFAULT 'ukjent_grunneier'
	            CHECK (status IN ('fiskekort', 'ukjent_grunneier', 'forbud_vasspest', 'forbud_drikkevann')),
	sone        TEXT CHECK (sone IS NULL OR sone IN ('Vest-Karmøy', 'Øst-Karmøy', 'Avaldsnes', 'Fastlandet/Fosen')),
	lat         REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),    -- markørpunkt inne i vannet
	lng         REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
	areal_m2    REAL,
	geometri    TEXT,  -- GeoJSON Polygon/MultiPolygon (forenklet)
	salg        TEXT,  -- JSON: [{ "type": "vipps"|"butikk", "navn": "...", "nummer"?, "sted"?, "lenke"? }]
	advarsel    TEXT,  -- vises øverst i infoboksen for forbudsvann
	arter       TEXT,  -- kommaseparert, f.eks. 'ørret, røye'
	beskrivelse TEXT,
	CHECK (status <> 'fiskekort' OR sone IS NOT NULL),
	CHECK (status NOT LIKE 'forbud_%' OR advarsel IS NOT NULL)
);
CREATE INDEX idx_ferskvann_status ON ferskvann (status);`;

const KOLONNER = ["id", "navn", "status", "sone", "lat", "lng", "areal_m2", "geometri", "salg", "advarsel", "arter", "beskrivelse"];

/** Kort, stabil hash (FNV-1a) – brukes som versjon av datasettet. */
export function hash(tekst) {
	let h = 0x811c9dc5;
	for (let i = 0; i < tekst.length; i++) h = Math.imul(h ^ tekst.charCodeAt(i), 0x01000193) >>> 0;
	return h.toString(16).padStart(8, "0");
}

/**
 * Lag seed.sql. Første linje er «-- versjon: <hash>»; db-worker.js importerer
 * fila på nytt bare når den endrer seg.
 */
export function lagSeedSql(rader, { hentet = new Date() } = {}) {
	const antall = (s) => rader.filter((r) => r.status === s).length;
	const kropp = [
		SKJEMA,
		...[...rader]
			.sort((a, b) => a.navn.localeCompare(b.navn, "nb") || a.id.localeCompare(b.id))
			.map((r) => `INSERT INTO ferskvann (${KOLONNER.join(", ")}) VALUES (${KOLONNER.map((k) => sqlVerdi(r[k])).join(", ")});`),
	].join("\n");
	return (
		[
			`-- versjon: ${hash(kropp)}`,
			"-- GENERERT av scripts/hent-vann.mjs – ikke rediger for hånd.",
			"-- Endre konfigurasjonen i skriptet og kjør `npm run vann:hent` på nytt.",
			"--",
			`-- Ferskvann i Karmøy kommune (${KOMMUNENR}) fra OpenStreetMap, data per ${hentet.toISOString().slice(0, 10)}.`,
			"-- Kartdata © OpenStreetMap-bidragsytere, ODbL 1.0.",
			`-- ${rader.length} vann: ${antall("fiskekort")} fiskekort, ${antall("forbud_vasspest")} forbud (vasspest), ` +
				`${antall("forbud_drikkevann")} forbud (drikkevann), ${antall("ukjent_grunneier")} ukjent grunneier.`,
			kropp,
		].join("\n") + "\n"
	);
}

// ============================================================================
// Hovedprogram
// ============================================================================

export function behandle(overpass, { medUnavngitte = false, ...koble } = {}) {
	const els = overpass.elements ?? [];
	// Way som også er ytre medlem av en vann-relation skal ikke telle dobbelt
	const iRelasjon = new Set(
		els.filter((e) => e.type === "relation" && erInnsjo(e)).flatMap((e) => (e.members ?? []).filter((m) => m.type === "way").map((m) => m.ref)),
	);
	const vann = [];
	let utenNavn = 0, ugyldig = 0;
	for (const el of els) {
		if (!erInnsjo(el) || (el.type === "way" && iRelasjon.has(el.id))) continue;
		const v = vannFraElement(el);
		if (!v?.geometri) {
			ugyldig++;
			continue;
		}
		if (!v.navn) {
			utenNavn++;
			if (!medUnavngitte) continue;
			v.navn = "Navnløst vann";
		}
		vann.push(v);
	}
	return { ...kobleStatus(vann, koble), utenNavn, ugyldig };
}

function argVerdi(args, navn) {
	const i = args.indexOf(navn);
	return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
	const fs = await import("node:fs/promises");
	const path = await import("node:path");
	const args = process.argv.slice(2);
	const rot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
	const ut = path.resolve(argVerdi(args, "--ut") ?? path.join(rot, "public", "data", "seed.sql"));
	await fs.mkdir(path.dirname(ut), { recursive: true });
	const fraFil = argVerdi(args, "--fra-fil");
	const lagreRå = argVerdi(args, "--lagre-rå");

	const overpass = fraFil ? JSON.parse(await fs.readFile(fraFil, "utf8")) : await hentOverpass();
	if (lagreRå) await fs.writeFile(lagreRå, JSON.stringify(overpass));
	if (!overpass.elements?.length) throw new Error("Overpass ga ingen vann. Finnes kommunegrensen (ref=1149, admin_level=7) i OSM?");

	const { rader, advarsler, utenNavn, ugyldig } = behandle(overpass, { medUnavngitte: args.includes("--med-unavngitte") });
	await fs.writeFile(ut, lagSeedSql(rader, { hentet: new Date(overpass.osm3s?.timestamp_osm_base ?? Date.now()) }));

	const antall = (s) => rader.filter((r) => r.status === s).length;
	console.error(`\nSkrev ${rader.length} vann til ${path.relative(process.cwd(), ut)}`);
	console.error(`  fiskekort: ${antall("fiskekort")} av ${GODKJENTE_VANN.length} i GODKJENTE_VANN`);
	console.error(`  forbud: ${antall("forbud_vasspest") + antall("forbud_drikkevann")} av ${FORBUDSVANN.length} i FORBUDSVANN`);
	console.error(`  ukjent grunneier: ${antall("ukjent_grunneier")}`);
	console.error(`  hoppet over: ${utenNavn} uten navn${args.includes("--med-unavngitte") ? " (tatt med)" : ""}, ${ugyldig} uten gyldig polygon`);
	if (advarsler.length) {
		console.error(`\n${advarsler.length} advarsel(er):`);
		for (const a of advarsler) console.error(`  ⚠ ${a}`);
		process.exitCode = 2;
	}
}

const erHovedprogram = typeof process !== "undefined" && process.argv?.[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (erHovedprogram) {
	main().catch((e) => {
		console.error(`Feil: ${e.message}`);
		process.exit(1);
	});
}
