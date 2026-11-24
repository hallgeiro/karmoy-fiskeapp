#!/usr/bin/env node
// Skriver public/versjon.json før publisering (npm run deploy / npm run dev).
// Versjonsnummer: <major.minor fra package.json>.<antall commits>, så det øker ved hver endring.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rot = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (cmd) => {
	try {
		return execSync(`git ${cmd}`, { cwd: rot, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
	} catch {
		return null;
	}
};
// Byggetjenester (Cloudflare Workers Builds) henter bare siste commit. Da blir commit-tallet 1,
// så hent resten av historikken først. Feiler det, brukes tallet vi har.
if (git("rev-parse --is-shallow-repository") === "true") git("fetch --unshallow --quiet");

const [major = "1", minor = "0"] = JSON.parse(readFileSync(join(rot, "package.json"), "utf8")).version.split(".");
const antall = git("rev-list --count HEAD") ?? "0";
const endret = git("status --porcelain") ? "+" : ""; // ucommitede endringer
const seed = readFileSync(join(rot, "public/data/seed.sql"), "utf8");
const vanndata = seed.match(/hentet (\d{4}-\d{2}-\d{2})|data per (\d{4}-\d{2}-\d{2})/)?.slice(1).find(Boolean) ?? null;

const versjon = {
	versjon: `${major}.${minor}.${antall}${endret}`,
	commit: git("rev-parse --short HEAD"),
	oppdatert: new Date().toISOString(),
	vanndata,
};
writeFileSync(join(rot, "public/versjon.json"), JSON.stringify(versjon, null, "\t") + "\n");
console.log(`Versjon ${versjon.versjon} (${versjon.commit}), oppdatert ${versjon.oppdatert}, vanndata ${vanndata}`);
