/**
 * Værvarsel fra Meteorologisk institutt (api.met.no, Locationforecast 2.0).
 * MET krever en User-Agent som identifiserer appen, og at klienten cacher svarene.
 * Vilkår: https://api.met.no/doc/TermsOfService
 */
const MET_URL = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
// MET ber om kontaktinfo i User-Agent. Legg til en nettside eller e-post før du publiserer.
const USER_AGENT = "karmoy-fiskeapp/0.1";

export interface ForecastHour {
	time: string;
	airTemperature: number | null;
	windSpeed: number | null;
	windFromDirection: number | null;
	windGust: number | null;
	precipitation: number | null;
	symbol: string | null;
}

interface MetResponse {
	properties: {
		timeseries: Array<{
			time: string;
			data: {
				instant: { details: Record<string, number | undefined> };
				next_1_hours?: {
					summary?: { symbol_code?: string };
					details?: { precipitation_amount?: number };
				};
				next_6_hours?: {
					summary?: { symbol_code?: string };
					details?: { precipitation_amount?: number };
				};
				// Langt frem i tid har MET bare 12-timers sammendrag (uten nedbør)
				next_12_hours?: { summary?: { symbol_code?: string } };
			};
		}>;
	};
}

/** Det eneste vi trenger fra kjørekonteksten. */
export type WaitUntil = Pick<ExecutionContext, "waitUntil">;

export async function getForecast(
	lat: number,
	lon: number,
	ctx: WaitUntil,
	hours = 24,
): Promise<ForecastHour[]> {
	// MET ber om maks 4 desimaler i koordinatene, ellers blir caching dårlig.
	const url = `${MET_URL}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
	const cache = caches.default;
	const cacheKey = new Request(url);

	let res = await cache.match(cacheKey);
	if (!res) {
		const upstream = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
		if (!upstream.ok) {
			throw new Error(`MET svarte ${upstream.status}`);
		}
		// Respekter Expires fra MET, men cache minst 10 minutter.
		res = new Response(upstream.body, upstream);
		res.headers.set("Cache-Control", "public, max-age=600");
		ctx.waitUntil(cache.put(cacheKey, res.clone()));
	}

	const json = (await res.json()) as MetResponse;
	return json.properties.timeseries.slice(0, hours).map((t) => {
		const d = t.data.instant.details;
		const next = t.data.next_1_hours ?? t.data.next_6_hours;
		return {
			time: t.time,
			airTemperature: d.air_temperature ?? null,
			windSpeed: d.wind_speed ?? null,
			windFromDirection: d.wind_from_direction ?? null,
			windGust: d.wind_speed_of_gust ?? null,
			precipitation: next?.details?.precipitation_amount ?? null,
			symbol: next?.summary?.symbol_code ?? t.data.next_12_hours?.summary?.symbol_code ?? null,
		};
	});
}
