import { Hono } from "hono";

export interface FiskevannRow {
	id: number;
	navn: string;
	omrade: string;
	lat: number;
	lng: number;
	arter: string | null;
	fiskekort_info: string | null;
	parkering_info: string | null;
	forbud_vasspest: number;
	beskrivelse: string | null;
	data_verifisert: number;
}

export const OMRADER = ["Vest-Karmøy", "Øst-Karmøy", "Avaldsnes", "Fastlandet/Fosen"] as const;

/** D1 lagrer boolean som 0/1 og arter som tekst – gjør det om til JSON-vennlige typer. */
export function toVann(r: FiskevannRow) {
	return {
		id: r.id,
		navn: r.navn,
		omrade: r.omrade,
		lat: r.lat,
		lng: r.lng,
		arter: r.arter
			? r.arter
					.split(",")
					.map((a) => a.trim())
					.filter(Boolean)
			: [],
		fiskekortInfo: r.fiskekort_info,
		parkeringInfo: r.parkering_info,
		forbudVasspest: r.forbud_vasspest === 1,
		beskrivelse: r.beskrivelse,
		dataVerifisert: r.data_verifisert === 1,
	};
}

export const vann = new Hono<{ Bindings: Env }>();

vann.get("/", async (c) => {
	const omrade = c.req.query("omrade");
	if (omrade && !(OMRADER as readonly string[]).includes(omrade)) {
		return c.json({ error: `Ukjent område. Gyldige: ${OMRADER.join(", ")}` }, 400);
	}
	const stmt = omrade
		? c.env.DB.prepare("SELECT * FROM fiskevann WHERE omrade = ? ORDER BY navn").bind(omrade)
		: c.env.DB.prepare("SELECT * FROM fiskevann ORDER BY navn");
	const { results } = await stmt.all<FiskevannRow>();
	c.header("Cache-Control", "public, max-age=60");
	return c.json(results.map(toVann));
});

vann.get("/:id{[0-9]+}", async (c) => {
	const row = await c.env.DB.prepare("SELECT * FROM fiskevann WHERE id = ?")
		.bind(Number(c.req.param("id")))
		.first<FiskevannRow>();
	if (!row) return c.json({ error: "Fant ikke vannet" }, 404);
	c.header("Cache-Control", "public, max-age=60");
	return c.json(toVann(row));
});
