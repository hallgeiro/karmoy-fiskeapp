import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getForecast } from "../src/weather";
// Ekte svar fra api.met.no (forkortet), lagret 2026-11-20
import fixture from "./fixtures/met-akrehamn.json";

afterEach(() => vi.restoreAllMocks());

describe("getForecast", () => {
	it("parses a real MET response and sends a User-Agent", async () => {
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(Response.json(fixture));
		const ctx = createExecutionContext();
		// Unike koordinater så cachen fra andre tester ikke slår inn
		const hours = await getForecast(59.262, 5.187, ctx, 24);
		await waitOnExecutionContext(ctx);

		expect(spy).toHaveBeenCalledOnce();
		const [url, init] = spy.mock.calls[0];
		expect(String(url)).toContain("lat=59.2620&lon=5.1870");
		expect(new Headers(init?.headers).get("User-Agent")).toMatch(/karmoy-fiskeapp/);

		expect(hours).toHaveLength(24);
		const first = hours[0];
		expect(first.time).toBe(fixture.properties.timeseries[0].time);
		expect(typeof first.airTemperature).toBe("number");
		expect(typeof first.windSpeed).toBe("number");
		expect(typeof first.windFromDirection).toBe("number");
		expect(first.symbol).toMatch(/^[a-z_]+$/);
	});

	it("uses the longest summary MET provides for each entry", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(fixture));
		const hours = await getForecast(59.2621, 5.1871, createExecutionContext(), 100);
		expect(hours).toHaveLength(fixture.properties.timeseries.length);
		fixture.properties.timeseries.forEach((t, i) => {
			const d = t.data as Record<string, { summary?: { symbol_code?: string } } | undefined>;
			const expected =
				d.next_1_hours?.summary?.symbol_code ??
				d.next_6_hours?.summary?.symbol_code ??
				d.next_12_hours?.summary?.symbol_code ??
				null;
			expect(hours[i].symbol).toBe(expected);
		});
	});

	it("throws when MET errors", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 503 }));
		await expect(getForecast(59.2622, 5.1872, createExecutionContext())).rejects.toThrow("503");
	});
});
