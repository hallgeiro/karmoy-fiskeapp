// Service worker for Karmøy Fiskevann.
// - App-skallet lagres ved installasjon (fungerer offline).
// - Fiskevann-data ligger i SQLite/OPFS (db-worker.js), så /data/seed.sql går
//   rett til nettet; uten nett bruker workeren det som allerede er lagret.
// - Kartfliser fra Kartverket: lagres etter hvert som du ser på dem (maks MAX_TILES).
const VERSION = "v4";
const SHELL = `shell-${VERSION}`;
const TILES = `tiles-${VERSION}`;
const MAX_TILES = 800;

const SHELL_FILES = [
	"/",
	"/index.html",
	"/style.css",
	"/app.js",
	"/db.js",
	"/bilder.js",
	"/logg.js",
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
	e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
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

	// App-skall: lagret først, oppdater i bakgrunnen
	e.respondWith(
		caches.match(req, { ignoreSearch: req.mode === "navigate" }).then((hit) => {
			const net = fetch(req)
				.then((res) => {
					if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
					return res;
				})
				.catch(() => hit || (req.mode === "navigate" ? caches.match("/index.html") : Response.error()));
			return hit || net;
		}),
	);
});

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
