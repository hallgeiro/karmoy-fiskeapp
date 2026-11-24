#!/usr/bin/env node
// Kopierer SQLite WASM fra node_modules til public/vendor/sqlite (appen har ikke byggesteg).
// Kjør etter oppgradering av @sqlite.org/sqlite-wasm: npm run vendor:sqlite
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fra = join(rot, "node_modules/@sqlite.org/sqlite-wasm");
const til = join(rot, "public/vendor/sqlite");
await mkdir(til, { recursive: true });
for (const f of ["index.mjs", "sqlite3.wasm", "sqlite3-opfs-async-proxy.js"]) await copyFile(join(fra, "dist", f), join(til, f));
const { version } = JSON.parse(await readFile(join(fra, "package.json"), "utf8"));
await writeFile(join(til, "VERSION"), `@sqlite.org/sqlite-wasm ${version} (Apache-2.0, https://github.com/sqlite/sqlite-wasm)\n`);
console.log(`Kopierte SQLite WASM ${version} til public/vendor/sqlite`);
