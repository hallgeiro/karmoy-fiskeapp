// SQLite (WASM) i egen worker, lagret i nettleserens OPFS.
//
// Lagring, i prioritert rekkefølge:
//   1. "opfs"          – krever COOP/COEP-headerne i public/_headers (SharedArrayBuffer)
//   2. "opfs-sahpool"  – OPFS uten SharedArrayBuffer
//   3. minne           – ingen lagring (f.eks. privat vindu); data hentes på nytt hver gang
//
// Ved oppstart sammenlignes versjonslinja i /data/seed.sql med den som sist ble
// importert. Er den ny, importeres fila i én transaksjon. Uten nett brukes det
// som allerede ligger i databasen.
//
// Brukerens egne data (fangster, erfaringer) ligger i egne tabeller som seed.sql
// aldri rører: seed.sql erstatter bare tabellen ferskvann, og workeren nekter å
// kjøre en seed-fil som nevner brukertabellene. Bildene ligger som filer i
// OPFS-mappa /bilder; databasen lagrer bare filnavnet.
//
// Meldinger inn:  { id, type: "query", sql, bind? }        → { id, rader }
//                 { id, type: "run", sql, bind? }          → { id, endringer, sisteId }
//                 { id, type: "batch", setninger: [{sql, bind}] } (én transaksjon) → { id }
//                 { id, type: "lagre-bilde", navn, blob }  → { id }
//                 { id, type: "slett-bilde", navn }        → { id }
//                 { id, type: "eksporter-db" }             → { id, bytes }  (Uint8Array)
// Meldinger ut:   { type: "klar", lagring, sqlite, dataVersjon, importert, frakoblet }
//                 { id, feil } ved feil
import sqlite3InitModule from "/vendor/sqlite/index.mjs";

const DB_FIL = "/karmoy.sqlite3";
const SEED_URL = "/data/seed.sql";

let db;
let sqlite3;

/** Brukerens tabeller. Opprettes hvis de mangler – slettes eller endres aldri automatisk. */
const BRUKERSKJEMA = `
CREATE TABLE IF NOT EXISTS fangster (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	vann_id       TEXT,              -- ferskvann.id (OSM-id); kan bli foreldreløs hvis vannet forsvinner fra datasettet
	vann_navn     TEXT,              -- navnet da fangsten ble logget, så den kan vises uansett
	dato          TEXT NOT NULL,     -- lokal tid, 'YYYY-MM-DDTHH:MM'
	art           TEXT NOT NULL,
	vekt_gram     INTEGER CHECK (vekt_gram IS NULL OR vekt_gram > 0),
	lengde_cm     REAL    CHECK (lengde_cm IS NULL OR lengde_cm > 0),
	redskap       TEXT,
	vaer_vind     TEXT,
	lat           REAL,              -- fiskeplass fra GPS, hvis brukeren ville
	lng           REAL,
	bilde_filnavn TEXT,              -- fil i OPFS-mappa /bilder
	notat         TEXT,
	opprettet     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_fangster_vann ON fangster (vann_id, dato DESC);
CREATE INDEX IF NOT EXISTS idx_fangster_dato ON fangster (dato DESC);
CREATE TABLE IF NOT EXISTS erfaringer (
	id               INTEGER PRIMARY KEY AUTOINCREMENT,
	vann_id          TEXT,
	vann_navn        TEXT,
	dato             TEXT NOT NULL,  -- 'YYYY-MM-DD'
	tittel           TEXT NOT NULL,
	tekst            TEXT,
	vindretning_tips TEXT,
	bilde_filnavn    TEXT,
	opprettet        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_erfaringer_vann ON erfaringer (vann_id, dato DESC);`;
const BRUKERTABELLER = /\b(fangster|erfaringer|meta)\b/i;

// Feil i SQLites hjelpe-workere håndteres av SQLite selv (den faller tilbake til
// annen lagring). Ikke la dem boble opp til siden som «databasen feilet».
addEventListener("error", (e) => {
	console.warn("Feil i SQLite-worker:", e.message);
	e.preventDefault();
});

async function åpne() {
	const sqlite3 = await sqlite3InitModule();
	// sqlite3.oo1.OpfsDb finnes bare når "opfs"-VFS-en ble installert
	if (sqlite3.oo1.OpfsDb) {
		try {
			return { db: new sqlite3.oo1.OpfsDb(DB_FIL, "c"), lagring: "opfs", sqlite3 };
		} catch (e) {
			console.warn("OPFS-VFS feilet, prøver opfs-sahpool", e);
		}
	}
	try {
		// sahpool låser filene eksklusivt; venter vi på en annen fane, gi opp etter litt
		const pool = await Promise.race([
			sqlite3.installOpfsSAHPoolVfs({ name: "karmoy-sahpool" }),
			new Promise((_, avvis) => setTimeout(() => avvis(new Error("tidsavbrudd")), 4000)),
		]);
		return { db: new pool.OpfsSAHPoolDb(DB_FIL), lagring: "opfs-sahpool", sqlite3 };
	} catch (e) {
		console.warn("OPFS er ikke tilgjengelig – bruker minne", e);
	}
	return { db: new sqlite3.oo1.DB(":memory:", "c"), lagring: "minne", sqlite3 };
}

const versjonAv = (sql) => sql.match(/^-- versjon: (\S+)/)?.[1] ?? null;

function lagretVersjon() {
	return db.selectValue("SELECT verdi FROM meta WHERE nokkel = 'data_versjon'") ?? null;
}

async function oppdaterData() {
	db.exec("CREATE TABLE IF NOT EXISTS meta (nokkel TEXT PRIMARY KEY, verdi TEXT)");
	const før = lagretVersjon();
	let sql;
	try {
		// no-cache: revaliderer mot serveren (ETag), så uendret fil koster lite
		const res = await fetch(SEED_URL, { cache: "no-cache" });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		sql = await res.text();
	} catch (e) {
		// Uten nett og uten lagrede vann: fangstloggen skal likevel virke
		return { dataVersjon: før, importert: false, frakoblet: true, ingenVann: !før };
	}
	const ny = versjonAv(sql);
	// En vann-fil som ikke kan brukes skal aldri stoppe appen: behold forrige vann-data
	const avvis = (grunn) => {
		console.error(`Vann-data ble ikke importert: ${grunn}`);
		return { dataVersjon: før, importert: false, frakoblet: false, ingenVann: !før, importFeil: grunn };
	};
	if (!ny) return avvis("seed.sql mangler versjonslinje");
	// Sikring: vann-data skal aldri kunne røre brukerens fangster og erfaringer
	if (BRUKERTABELLER.test(sql.replace(/^--.*$/gm, ""))) return avvis("seed.sql nevner brukertabellene – stoppet for å beskytte dine data");
	if (ny === før) return { dataVersjon: før, importert: false, frakoblet: false };

	try {
		// Én transaksjon: feiler noe, rulles alt tilbake og forrige vann-data beholdes
		db.transaction((t) => {
			t.exec(sql);
			t.exec({ sql: "INSERT OR REPLACE INTO meta (nokkel, verdi) VALUES ('data_versjon', ?)", bind: [ny] });
		});
	} catch (e) {
		return avvis(e.message);
	}
	return { dataVersjon: ny, importert: true, frakoblet: false };
}

const klar = (async () => {
	const åpnet = await åpne();
	db = åpnet.db;
	sqlite3 = åpnet.sqlite3;
	db.exec(BRUKERSKJEMA);
	const status = await oppdaterData();
	return { lagring: åpnet.lagring, sqlite: åpnet.sqlite3.version.libVersion, ...status };
})();

klar.then(
	(info) => postMessage({ type: "klar", ...info }),
	(e) => postMessage({ type: "klar", feil: e.message }),
);

// ---------- Bilder i OPFS (/bilder) ----------
const TRYGT_FILNAVN = /^[a-z0-9_-]+\.(jpe?g|png|webp)$/i;

async function bildemappe() {
	const rot = await navigator.storage.getDirectory();
	return rot.getDirectoryHandle("bilder", { create: true });
}

async function lagreBilde(navn, blob) {
	if (!TRYGT_FILNAVN.test(navn)) throw new Error("Ugyldig filnavn");
	const fil = await (await bildemappe()).getFileHandle(navn, { create: true });
	const data = new Uint8Array(await blob.arrayBuffer());
	if (fil.createSyncAccessHandle) {
		// Støttes i workere i alle moderne nettlesere (også Safari)
		const h = await fil.createSyncAccessHandle();
		try {
			h.truncate(0);
			h.write(data, { at: 0 });
			h.flush();
		} finally {
			h.close();
		}
	} else {
		const w = await fil.createWritable();
		await w.write(data);
		await w.close();
	}
}

async function slettBilde(navn) {
	if (!TRYGT_FILNAVN.test(navn)) throw new Error("Ugyldig filnavn");
	try {
		await (await bildemappe()).removeEntry(navn);
	} catch (e) {
		if (e.name !== "NotFoundError") throw e;
	}
}

onmessage = async ({ data }) => {
	const { id, type, sql, bind } = data;
	try {
		await klar;
		if (type === "query") {
			postMessage({ id, rader: db.exec({ sql, bind, rowMode: "object", returnValue: "resultRows" }) });
		} else if (type === "run") {
			db.exec({ sql, bind });
			postMessage({ id, endringer: db.changes(), sisteId: Number(db.selectValue("SELECT last_insert_rowid()")) });
		} else if (type === "batch") {
			db.transaction((t) => {
				for (const s of data.setninger) t.exec({ sql: s.sql, bind: s.bind });
			});
			postMessage({ id });
		} else if (type === "lagre-bilde") {
			await lagreBilde(data.navn, data.blob);
			postMessage({ id });
		} else if (type === "slett-bilde") {
			await slettBilde(data.navn);
			postMessage({ id });
		} else if (type === "eksporter-db") {
			const bytes = sqlite3.capi.sqlite3_js_db_export(db);
			postMessage({ id, bytes }, [bytes.buffer]);
		} else {
			throw new Error(`Ukjent meldingstype: ${type}`);
		}
	} catch (e) {
		postMessage({ id, feil: e.message });
	}
};
