/**
 * Karmøy Fiskeapp – Worker
 *
 *   GET /api/vann            alle fiskevann (?omrade=Vest-Karmøy …)
 *   GET /api/vann/:id        ett fiskevann
 *
 * Eldre endepunkter for sjøfiske og fangstdagbok (/api/spots, /api/catches,
 * /api/stats …) håndteres av src/legacy.ts.
 *
 * Alt utenfor /api serveres som statiske filer fra ./public.
 */
import { Hono } from "hono";
import { legacyApi } from "./legacy";
import { vann } from "./vann";

const app = new Hono<{ Bindings: Env }>();

app.route("/api/vann", vann);

// Resten av /api går til den eldre håndtereren
app.all("/api/*", (c) => legacyApi.fetch(c.req.raw, c.env, c.executionCtx));

// Statiske filer (skjer normalt før Workeren, men greit å ha som fallback)
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((err, c) => {
	console.error(err);
	return c.json({ error: "Noe gikk galt på serveren" }, 500);
});

export default app;
