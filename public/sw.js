// Service worker for Karmøy Fiskevann.
// - App-filene (HTML/JS/CSS) hentes fra nettet først, så en ny versjon vises med
//   en gang etter publisering. Lagret kopi brukes bare uten nett (eller hvis nettet
//   bruker mer enn NETT_TIDSFRIST ms – dårlig dekning ved vannene).
// - Fiskevann-data ligger i SQLite/OPFS (db-worker.js), så /data/seed.sql går
//   rett til nettet; uten nett bruker workeren det som allerede er lagret.
// - Kartfliser fra Kartverket: lagres etter hvert som du ser på dem (maks MAX_TILES).
const VERSION = "v6";
const NETT_TIDSFRIST = 4000;
const SHELL = `shell-${VERSION}`;
const TILES = "tiles-v1"; // uavhengig av appversjonen, så kartflisene beholdes ved oppdatering
const MAX_TILES = 800;

const SHELL_FILES = [
	"/",
	"/index.html",
	"/style.css",
	"/app.js",
	"/db.js",
	"/bilder.js",
	"/logg.js",
	"/arter.js",
	"/vendor/jszip/jszip.min.js",
	"/db-worker.js",
	"/vendor/sqlite/index.mjs",
	"/vendor/sqlite/sqlite3.wasm",
	// SQLite starter hjelpe-workeren med ?vfs=… og leser parameteren fra sin egen URL,
	// så disse må lagres og matches med query
	"/vendor/sqlite/sqlite3-opfs-async-proxy.js?vfs=opfs",
	"/vendor/sqlite/sqlite3-opfs-async-proxy.js?vfs=opfs-wl",
	"/manifest.webmanifest",
	"/vendor/leaflet/leaflet.css",
	"/vendor/leaflet/leaflet.js",
	"/icons/icon.svg",
	"/icons/icon-192.png",
];

self.addEventListener("install", (e) => {
	// cache: "reload" – ikke ta med gamle filer fra nettleserens HTTP-cache inn i den nye versjonen
	e.waitUntil(
		caches
			.open(SHELL)
			.then((c) => c.addAll(SHELL_FILES.map((u) => new Request(u, { cache: "reload" }))))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (e) => {
	const keep = new Set([SHELL, TILES]);
	e.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (e) => {
	const req = e.request;
	if (req.method !== "GET") return;
	const url = new URL(req.url);

	if (url.hostname === "cache.kartverket.no") {
		e.respondWith(tile(req));
		return;
	}
	if (url.origin !== self.location.origin) return;

	if (url.pathname.startsWith("/data/")) return;

	e.respondWith(nettFørst(req));
});

/** App-filer: nettet først (ny versjon med en gang), lagret kopi uten nett. */
async function nettFørst(req) {
	const cache = await caches.open(SHELL);
	try {
		const res = await Promise.race([
			fetch(req),
			new Promise((_, avvis) => setTimeout(() => avvis(new Error("tidsfrist")), NETT_TIDSFRIST)),
		]);
		if (res.ok) await cache.put(req, res.clone());
		return res;
	} catch {
		const hit =
			(await cache.match(req, { ignoreSearch: req.mode === "navigate" })) ||
			(req.mode === "navigate" ? await cache.match("/index.html") : undefined);
		return hit || Response.error();
	}
}

async function tile(req) {
	const cache = await caches.open(TILES);
	const hit = await cache.match(req);
	if (hit) return hit;
	try {
		const res = await fetch(req);
		if (res.ok || res.type === "opaque") {
			await cache.put(req, res.clone());
			trim(cache);
		}
		return res;
	} catch {
		return Response.error();
	}
}

async function trim(cache) {
	const keys = await cache.keys();
	for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}
