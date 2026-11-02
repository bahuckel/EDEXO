/**
 * `/api/spansh-route` — a route planned on Spansh (plan 1.3.6 S-1, server/spanshRoute.ts): `GET ?q=<link or job id>`
 * reads it from Spansh once (kept for the session), `POST /api/spansh-route/fly { job, keep }` flies it as the live
 * route, the stops in `keep` (indexes; all when absent).
 */
import type express from "express";
import { fetchSpanshRoute, spanshJobFromText, spanshRouteHops, type SpanshRouteDTO } from "../spanshRoute.js";
import type { HttpServerOptions } from "../httpServerTypes.js";

/** Routes read this session, newest last; a few dozen at most. */
const KEPT = 20;

export function registerSpanshRouteRoutes(app: express.Express, opts: HttpServerOptions): void {
  const kept = new Map<string, SpanshRouteDTO>();

  app.get("/api/spansh-route", async (req, res) => {
    const q = String(req.query.q ?? "").slice(0, 500);
    const job = spanshJobFromText(q);
    const have = job ? kept.get(job) : undefined;
    if (have) return void res.json({ state: "ok", route: have });
    const answer = await fetchSpanshRoute(q);
    if (answer.state === "ok") {
      kept.set(answer.route.job, answer.route);
      while (kept.size > KEPT) kept.delete(kept.keys().next().value!);
    }
    res.json(answer);
  });

  app.post("/api/spansh-route/fly", (req, res) => {
    const live = opts.neutronLive;
    if (!live) return void res.status(501).json({ error: "Not available in this build." });
    const body = (req.body ?? {}) as { job?: unknown; keep?: unknown };
    const route = typeof body.job === "string" ? kept.get(body.job.toUpperCase()) : undefined;
    if (!route) return void res.status(400).json({ error: "Read the route from Spansh first." });
    const keep = Array.isArray(body.keep)
      ? new Set(body.keep.filter((i): i is number => Number.isInteger(i) && i > 0 && i < route.stops.length))
      : null;
    const hops = spanshRouteHops(route, keep);
    if (!hops) return void res.status(400).json({ error: route.kind === "carrier" ? "A carrier route is not flown by the ship." : "Keep at least one stop after the start." });
    const next = live.start(hops, opts.shipHere?.() ?? { name: null, pos: null }, null);
    opts.scheduleBroadcast?.();
    res.json({ ok: true, next, stops: hops.length - 1 });
  });
}
