import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import schema from "../schema.sql?raw";
import seed from "../seed.sql?raw";

/** Kjør en SQL-fil mot D1 (env.DB.exec takler ikke setninger over flere linjer). */
async function runSql(sql: string) {
	const statements = sql
		.split("\n")
		.filter((l) => !l.trim().startsWith("--"))
		.join("\n")
		.split(/;\s*(?:\n|$)/)
		.map((s) => s.trim())
		.filter(Boolean);
	await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
}

interface Vann {
	id: number;
	navn: string;
	omrade: string;
	lat: number;
	lng: number;
	arter: string[];
	forbudVasspest: boolean;
	dataVerifisert: boolean;
}

beforeAll(async () => {
	await runSql(schema);
	await runSql(seed);
	// Kjør seed to ganger: skal ikke gi duplikater
	await runSql(seed);
});

describe("GET /api/vann", () => {
	it("returns the five seeded lakes with booleans and arrays", async () => {
		const res = await SELF.fetch("https://x/api/vann");
		expect(res.status).toBe(200);
		const vann = (await res.json()) as Vann[];
		expect(vann.map((v) => v.navn).sort()).toEqual([
			"Aksnesvatnet",
			"Buadalsvatnet (Nedre)",
			"Fotvatnet (Stora Fotvatnet)",
			"Hilleslandsvatnet",
			"Stiklevatnet",
		]);
		for (const v of vann) {
			expect(typeof v.forbudVasspest).toBe("boolean");
			expect(Array.isArray(v.arter)).toBe(true);
			// Innenfor Karmøy kommune
			expect(v.lat).toBeGreaterThan(59.1);
			expect(v.lat).toBeLessThan(59.45);
			expect(v.lng).toBeGreaterThan(5.1);
			expect(v.lng).toBeLessThan(5.45);
		}
	});

	it("filters by område and rejects unknown ones", async () => {
		const vann = (await (await SELF.fetch("https://x/api/vann?omrade=Fastlandet%2FFosen")).json()) as Vann[];
		expect(vann.map((v) => v.navn)).toEqual(["Aksnesvatnet"]);
		expect((await SELF.fetch("https://x/api/vann?omrade=Bergen")).status).toBe(400);
	});

	it("parses arter and forbud from the database", async () => {
		await env.DB.prepare(
			"INSERT INTO fiskevann (id, navn, omrade, lat, lng, arter, forbud_vasspest) VALUES (99, 'Testvatnet', 'Avaldsnes', 59.35, 5.28, 'ørret, røye ,', 1)",
		).run();
		const v = (await (await SELF.fetch("https://x/api/vann/99")).json()) as Vann;
		expect(v).toMatchObject({ arter: ["ørret", "røye"], forbudVasspest: true, dataVerifisert: false });
		await env.DB.prepare("DELETE FROM fiskevann WHERE id = 99").run();
	});

	it("404s on an unknown id", async () => {
		expect((await SELF.fetch("https://x/api/vann/12345")).status).toBe(404);
	});

	it("enforces the område constraint in the schema", async () => {
		await expect(
			env.DB.prepare("INSERT INTO fiskevann (navn, omrade, lat, lng) VALUES ('X', 'Oslo', 59, 5)").run(),
		).rejects.toThrow(/CHECK/);
	});
});
