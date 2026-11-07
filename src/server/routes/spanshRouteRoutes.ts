/**
 * `/api/spansh-route` — a route planned on Spansh (plan 1.3.6 S-1, server/spanshRoute.ts): `GET ?q=<link or job id>`
 * reads it from Spansh once and keeps it on disk (server/spanshRouteFile.ts: Spansh deletes results within hours),
 * `POST /api/spansh-route/import { name, text }` reads one from a file saved from Spansh (JSON or CSV,
 * server/spanshRouteImport.ts) and keeps it the same way, `GET /api/spansh-route/saved` lists the kept ones, `DELETE /api/spansh-route/saved?job=` forgets one, and
 * `POST /api/spansh-route/fly { job, keep, kind, stops }` flies it as the live route, the stops in `keep` (indexes; all when
 * absent); `kind` and `stops` stand in for a route no longer kept on disk.
 */
import type express from "express";
import { localOnly } from "../lanAuth.js";
import { fetchSpanshRoute, spanshJobFromText, spanshRouteHops } from "../spanshRoute.js";
import { openSpanshRouteFile, resolveSpanshRoutesPath, type SpanshRouteFile } from "../spanshRouteFile.js";
import type { HttpServerOptions } from "../httpServerTypes.js";
import { carrierHereOf } from "../carrierRouteFollow.js";
import { importSpanshRouteFile } from "../spanshRouteImport.js";
import { resolveCoordMapForSystems } from "../colonize/galaxySystemCoords.js";
import { normSystemName } from "../../shared/colonize/stationFilter.js";
import type { SpanshRouteDTO, SpanshRouteKind, SpanshRouteStopDTO } from "../../shared/dto/spanshRoute.js";

const KINDS: readonly SpanshRouteKind[] = ["exobiology", "riches", "neutron", "plotter", "carrier"];
const MAX_STOPS = 5000;

/**
 * The route the drawer shows, sent with Fly (review P13, 2026-11-05): a route forgotten from the kept list, or pushed
 * out of it by newer ones, still flies. Only what flying reads is taken; null when it is not a route.
 */
function routeFromStops(kind: unknown, stops: unknown): SpanshRouteDTO | undefined {
  if (!KINDS.includes(kind as SpanshRouteKind) || !Array.isArray(stops) || stops.length < 2 || stops.length > MAX_STOPS) return undefined;
  const out: SpanshRouteStopDTO[] = [];
  for (const raw of stops) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
    const [x, y, z, jumps] = [num(s.x), num(s.y), num(s.z), num(s.jumps)];
    if (typeof s.name !== "string" || !s.name.trim() || s.name.length > 200 || [x, y, z].some(Number.isNaN)) return undefined;
    out.push({
      name: s.name,
      id64: null,
      x,
      y,
      z,
      jumps: Number.isNaN(jumps) ? 0 : Math.max(0, Math.min(10_000, Math.round(jumps))),
      neutron: s.neutron === true,
      refuel: s.refuel === true,
      inject: s.inject === true,
      valueCr: 0,
      bodies: [],
    });
  }
  return { job: "", kind: kind as SpanshRouteKind, from: null, to: null, rangeLy: null, stops: out, totalJumps: 0, totalValueCr: 0, url: "" };
}

export function registerSpanshRouteRoutes(app: express.Express, opts: HttpServerOptions, file?: SpanshRouteFile): void {
  // Opened on first use (nothing is read until the drawer asks), and again when the commander's folder changes.
  let open: { path: string; file: SpanshRouteFile } | null = null;
  const routes = (): SpanshRouteFile => {
    if (file) return file;
    const p = resolveSpanshRoutesPath();
    if (open?.path !== p) open = { path: p, file: openSpanshRouteFile(p) };
    return open.file;
  };

  app.get("/api/spansh-route", async (req, res) => {
    const q = String(req.query.q ?? "").slice(0, 500);
    const job = spanshJobFromText(q);
    const have = job ? routes().get(job) : undefined;
    if (have) return void res.json({ state: "ok", route: have, saved: true });
    const answer = await fetchSpanshRoute(q);
    if (answer.state === "ok") routes().put(answer.route);
    res.json(answer);
  });

  app.post("/api/spansh-route/import", async (req, res) => {
    const body = (req.body ?? {}) as { name?: unknown; text?: unknown };
    if (typeof body.text !== "string") return void res.status(400).json({ state: "error", error: "text: the file's content" });
    const answer = await importSpanshRouteFile(typeof body.name === "string" ? body.name.slice(0, 200) : "", body.text, resolveCoordMapForSystems, normSystemName);
    if (answer.state === "ok") routes().put(answer.route);
    res.json(answer);
  });

  app.get("/api/spansh-route/saved", (_req, res) => {
    res.json({ routes: routes().list() });
  });

  app.delete("/api/spansh-route/saved", localOnly, (req, res) => {
    const job = spanshJobFromText(String(req.query.job ?? ""));
    if (!job) return void res.status(400).json({ error: "job: a Spansh job id" });
    res.json({ removed: routes().remove(job), routes: routes().list() });
  });

  app.post("/api/spansh-route/fly", (req, res) => {
    const live = opts.neutronLive;
    if (!live) return void res.status(501).json({ error: "Not available in this build." });
    const body = (req.body ?? {}) as { job?: unknown; keep?: unknown; kind?: unknown; stops?: unknown };
    const route = (typeof body.job === "string" ? routes().get(body.job.toUpperCase()) : undefined) ?? routeFromStops(body.kind, body.stops);
    if (!route) return void res.status(400).json({ error: "Read the route from Spansh first." });
    const keep = Array.isArray(body.keep)
      ? new Set(body.keep.filter((i): i is number => Number.isInteger(i) && i > 0 && i < route.stops.length))
      : null;
    const hops = spanshRouteHops(route, keep);
    if (!hops) return void res.status(400).json({ error: "Keep at least one stop after the start." });
    // A carrier route follows his carrier: where it is now is the stop reached (owner, 2026-11-02).
    const carrier = route.kind === "carrier";
    const store = opts.getJournalStore?.() ?? null;
    const here = (carrier ? (store ? carrierHereOf(store) : null) : opts.shipHere?.()) ?? { name: null, pos: null };
    const next = live.start(hops, here, null, carrier ? "carrier" : "ship");
    opts.scheduleBroadcast?.();
    res.json({ ok: true, next, stops: hops.length - 1 });
  });
}
