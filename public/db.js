// Tynn klient mot public/db-worker.js (SQLite i OPFS).
const worker = new Worker("/db-worker.js", { type: "module" });

let nesteId = 1;
const venter = new Map();
let klarLøs;
/** Løses med { lagring, sqlite, dataVersjon, importert, frakoblet, ingenVann? } når databasen er klar. */
export const klar = new Promise((løs, avvis) => (klarLøs = { løs, avvis }));

worker.onmessage = ({ data }) => {
	if (data.type === "klar") return data.feil ? klarLøs.avvis(new Error(data.feil)) : klarLøs.løs(data);
	const v = venter.get(data.id);
	if (!v) return;
	venter.delete(data.id);
	data.feil ? v.avvis(new Error(data.feil)) : v.løs(data);
};
// Frigjør OPFS-låsene med en gang når siden lukkes eller lastes på nytt
addEventListener("pagehide", (e) => e.persisted || worker.terminate());
worker.onerror = (e) => klarLøs.avvis(new Error(e.message || "Databasen kunne ikke starte"));

function kall(melding) {
	const id = nesteId++;
	return new Promise((løs, avvis) => {
		venter.set(id, { løs, avvis });
		worker.postMessage({ id, ...melding });
	});
}

/** Kjør en SELECT og få radene som objekter. */
export const query = async (sql, bind) => (await kall({ type: "query", sql, bind })).rader;
/** Kjør INSERT/UPDATE/DELETE. Gir { endringer, sisteId }. */
export const run = (sql, bind) => kall({ type: "run", sql, bind });
/** Flere setninger i én transaksjon: [{ sql, bind }]. */
export const batch = (setninger) => kall({ type: "batch", setninger });
/** Lagre en bildefil i OPFS-mappa /bilder (skrives av workeren). */
export const lagreBildefil = (navn, blob) => kall({ type: "lagre-bilde", navn, blob });
export const slettBildefil = (navn) => kall({ type: "slett-bilde", navn });
/** Hele SQLite-databasen som Uint8Array (for backup). */
export const eksporterDb = async () => (await kall({ type: "eksporter-db" })).bytes;
