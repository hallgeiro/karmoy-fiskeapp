/**
 * Karmøy Fiskeapp – API
 *
 *   GET    /api/spots              alle fiskeplasser
 *   GET    /api/spots/:id          én plass med siste fangster
 *   GET    /api/spots/:id/weather  værvarsel neste 24 timer (MET)
 *   GET    /api/species            arter man kan logge
 *   GET    /api/catches            fangster (?spot=, ?species=, ?limit=)
 *   POST   /api/catches            logg en fangst
 *   DELETE /api/catches/:id        slett en fangst
 *   GET    /api/stats              fangster per art og per plass
 *
 * Alt annet serveres som statiske filer fra ./public.
 */
import { SPECIES, SPOTS, findSpot } from "./spots";
import { getForecast } from "./weather";

interface CatchRow {
	id: number;
	spot_id: string;
	species: string;
	weight_kg: number | null;
	length_cm: number | null;
	caught_at: string;
	note: string | null;
	created_at: string;
}

const json = (data: unknown, status = 200) =>
	Response.json(data, {
		status,
		headers: { "Cache-Control": "no-store" },
	});

const error = (message: string, status = 400) => json({ error: message }, status);

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname.replace(/\/+$/, "");
		const method = request.method;

		if (!path.startsWith("/api")) {
			return env.ASSETS.fetch(request);
		}

		try {
			if (path === "/api/spots" && method === "GET") {
				return json(SPOTS);
			}

			if (path === "/api/species" && method === "GET") {
				return json(SPECIES);
			}

			let m = path.match(/^\/api\/spots\/([a-z0-9-]+)(\/weather)?$/);
			if (m && method === "GET") {
				const spot = findSpot(m[1]);
				if (!spot) return error("Fant ikke fiskeplassen", 404);

				if (m[2]) {
					try {
						const forecast = await getForecast(spot.lat, spot.lon, ctx);
						return json({ spotId: spot.id, source: "MET Norge", forecast });
					} catch (e) {
						console.error("MET-feil", e);
						return error("Værvarselet er ikke tilgjengelig akkurat nå. Prøv igjen senere.", 502);
					}
				}

				const { results } = await env.DB.prepare(
					"SELECT * FROM catches WHERE spot_id = ? ORDER BY caught_at DESC LIMIT 10",
				)
					.bind(spot.id)
					.all<CatchRow>();
				return json({ ...spot, recentCatches: results.map(toCatch) });
			}

			if (path === "/api/catches" && method === "GET") {
				return listCatches(url, env);
			}

			if (path === "/api/catches" && method === "POST") {
				return createCatch(request, env);
			}

			m = path.match(/^\/api\/catches\/(\d+)$/);
			if (m && method === "DELETE") {
				const { meta } = await env.DB.prepare("DELETE FROM catches WHERE id = ?")
					.bind(Number(m[1]))
					.run();
				if (meta.changes === 0) return error("Fant ikke fangsten", 404);
				return new Response(null, { status: 204 });
			}

			if (path === "/api/stats" && method === "GET") {
				const [bySpecies, bySpot] = await env.DB.batch([
					env.DB.prepare(
						"SELECT species, COUNT(*) AS count, MAX(weight_kg) AS max_weight_kg FROM catches GROUP BY species ORDER BY count DESC",
					),
					env.DB.prepare(
						"SELECT spot_id, COUNT(*) AS count FROM catches GROUP BY spot_id ORDER BY count DESC",
					),
				]);
				return json({ bySpecies: bySpecies.results, bySpot: bySpot.results });
			}

			return error("Ukjent API-adresse", 404);
		} catch (e) {
			console.error(e);
			return error("Noe gikk galt på serveren", 500);
		}
	},
} satisfies ExportedHandler<Env>;

function toCatch(r: CatchRow) {
	return {
		id: r.id,
		spotId: r.spot_id,
		spotName: findSpot(r.spot_id)?.name ?? r.spot_id,
		species: r.species,
		weightKg: r.weight_kg,
		lengthCm: r.length_cm,
		caughtAt: r.caught_at,
		note: r.note,
		createdAt: r.created_at,
	};
}

async function listCatches(url: URL, env: Env): Promise<Response> {
	const where: string[] = [];
	const params: (string | number)[] = [];

	const spot = url.searchParams.get("spot");
	if (spot) {
		where.push("spot_id = ?");
		params.push(spot);
	}
	const species = url.searchParams.get("species");
	if (species) {
		where.push("species = ?");
		params.push(species);
	}
	const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);

	const sql = `SELECT * FROM catches ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY caught_at DESC, id DESC LIMIT ?`;
	const { results } = await env.DB.prepare(sql)
		.bind(...params, limit)
		.all<CatchRow>();
	return json(results.map(toCatch));
}

async function createCatch(request: Request, env: Env): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return error("Ugyldig JSON");
	}
	if (!body || typeof body !== "object") return error("Ugyldig JSON");

	const spotId = String(body.spotId ?? "");
	if (!findSpot(spotId)) return error("Ukjent fiskeplass");

	const species = String(body.species ?? "").trim().toLowerCase();
	if (!(SPECIES as readonly string[]).includes(species)) return error("Ukjent fiskeart");

	const weightKg = optionalNumber(body.weightKg, 0, 100);
	if (weightKg === undefined) return error("Vekt må være et tall mellom 0 og 100 kg");
	const lengthCm = optionalNumber(body.lengthCm, 0, 300);
	if (lengthCm === undefined) return error("Lengde må være et tall mellom 0 og 300 cm");

	let caughtAt = new Date().toISOString();
	if (body.caughtAt != null && body.caughtAt !== "") {
		const d = new Date(String(body.caughtAt));
		if (Number.isNaN(d.getTime())) return error("Ugyldig tidspunkt");
		if (d.getTime() > Date.now() + 60 * 60 * 1000) return error("Tidspunktet kan ikke være i fremtiden");
		caughtAt = d.toISOString();
	}

	const note = body.note == null ? null : String(body.note).trim().slice(0, 500) || null;

	const row = await env.DB.prepare(
		"INSERT INTO catches (spot_id, species, weight_kg, length_cm, caught_at, note) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
	)
		.bind(spotId, species, weightKg, lengthCm, caughtAt, note)
		.first<CatchRow>();

	return json(toCatch(row!), 201);
}

/** null = ikke oppgitt, undefined = ugyldig */
function optionalNumber(v: unknown, min: number, max: number): number | null | undefined {
	if (v == null || v === "") return null;
	const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
	if (!Number.isFinite(n) || n < min || n > max) return undefined;
	return n;
}
