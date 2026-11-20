import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { SPOTS } from "../src/spots";

beforeAll(async () => {
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS catches (id INTEGER PRIMARY KEY AUTOINCREMENT, spot_id TEXT NOT NULL, species TEXT NOT NULL, weight_kg REAL, length_cm REAL, caught_at TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))",
	);
});

const post = (body: unknown) =>
	SELF.fetch("https://x/api/catches", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

describe("spots", () => {
	it("lists all spots", async () => {
		const res = await SELF.fetch("https://x/api/spots");
		expect(res.status).toBe(200);
		const data = (await res.json()) as unknown[];
		expect(data).toHaveLength(SPOTS.length);
	});

	it("404s on an unknown spot", async () => {
		const res = await SELF.fetch("https://x/api/spots/finnes-ikke");
		expect(res.status).toBe(404);
	});
});

describe("catches", () => {
	it("creates, lists and deletes a catch", async () => {
		const res = await post({ spotId: "akrehamn", species: "Makrell", weightKg: "0,6", note: "  sluk  " });
		expect(res.status).toBe(201);
		const created = (await res.json()) as { id: number; species: string; weightKg: number; note: string; spotName: string };
		expect(created).toMatchObject({ species: "makrell", weightKg: 0.6, note: "sluk", spotName: "Åkrehamn" });

		const list = (await (await SELF.fetch("https://x/api/catches?spot=akrehamn")).json()) as { id: number }[];
		expect(list.map((c) => c.id)).toContain(created.id);

		const stats = (await (await SELF.fetch("https://x/api/stats")).json()) as { bySpecies: { species: string }[] };
		expect(stats.bySpecies.some((r) => r.species === "makrell")).toBe(true);

		expect((await SELF.fetch(`https://x/api/catches/${created.id}`, { method: "DELETE" })).status).toBe(204);
		expect((await SELF.fetch(`https://x/api/catches/${created.id}`, { method: "DELETE" })).status).toBe(404);
	});

	it.each([
		[{ spotId: "nowhere", species: "sei" }, "Ukjent fiskeplass"],
		[{ spotId: "kopervik", species: "hai" }, "Ukjent fiskeart"],
		[{ spotId: "kopervik", species: "sei", weightKg: "tung" }, "Vekt"],
		[{ spotId: "kopervik", species: "sei", caughtAt: "2999-01-01T00:00:00Z" }, "fremtiden"],
	])("rejects invalid input %#", async (body, msg) => {
		const res = await post(body);
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toContain(msg);
	});

	it("rejects malformed JSON", async () => {
		const res = await SELF.fetch("https://x/api/catches", { method: "POST", body: "{nope" });
		expect(res.status).toBe(400);
	});
});

describe("unknown api route", () => {
	it("returns 404 JSON", async () => {
		const res = await SELF.fetch("https://x/api/nope");
		expect(res.status).toBe(404);
	});
});
