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
// Meldinger inn:  { id, type: "query", sql, bind? }
// Meldinger ut:   { type: "klar", lagring, sqlite, dataVersjon, importert, frakoblet }
//                 { id, rader } | { id, feil }
import sqlite3InitModule from "/vendor/sqlite/index.mjs";

const DB_FIL = "/karmoy.sqlite3";
const SEED_URL = "/data/seed.sql";

let db;

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
		if (før) return { dataVersjon: før, importert: false, frakoblet: true };
		throw new Error(`Fikk ikke hentet fiskevann-data (${e.message}), og ingen data er lagret ennå.`);
	}
	const ny = versjonAv(sql);
	if (!ny) throw new Error("seed.sql mangler versjonslinje");
	if (ny === før) return { dataVersjon: før, importert: false, frakoblet: false };

	db.transaction((t) => {
		t.exec(sql);
		t.exec({ sql: "INSERT OR REPLACE INTO meta (nokkel, verdi) VALUES ('data_versjon', ?)", bind: [ny] });
	});
	return { dataVersjon: ny, importert: true, frakoblet: false };
}

const klar = (async () => {
	const åpnet = await åpne();
	db = åpnet.db;
	const status = await oppdaterData();
	return { lagring: åpnet.lagring, sqlite: åpnet.sqlite3.version.libVersion, ...status };
})();

klar.then(
	(info) => postMessage({ type: "klar", ...info }),
	(e) => postMessage({ type: "klar", feil: e.message }),
);

onmessage = async ({ data: { id, type, sql, bind } }) => {
	try {
		await klar;
		if (type !== "query") throw new Error(`Ukjent meldingstype: ${type}`);
		const rader = db.exec({ sql, bind, rowMode: "object", returnValue: "resultRows" });
		postMessage({ id, rader });
	} catch (e) {
		postMessage({ id, feil: e.message });
	}
};
