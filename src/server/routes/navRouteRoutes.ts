/*
  The NavRoute star finder and the map's plotted systems: /api/navroutes (split out of galaxyRoutes.ts, plan
  2026-11-10 Phase 7.2; registered from it in the same order).
*/
import type express from "express";
import { localOnly } from "../lanAuth.js";
import type { HttpServerOptions } from "../httpServerTypes.js";
import {
  checkNavRouteSystemsOnEdsm,
  clearNavRouteLog,
  lastNavRoute,
  navRouteLog,
  plottedSystem,
  plottedRevision,
  plottedSystemsCompact,
} from "../navRouteLog.js";
import { plottedTag } from "../../shared/plottedTag.js";

export function registerNavRouteRoutes(app: express.Express, opts: HttpServerOptions): void {
  /**
   * The NavRoute star finder (owner, 2026-10-04): every plotted route's systems with their star class,
   * EDSM's answer per system once asked, and the check in progress. Not under /api/galaxy's memory
   * clock: it is the commander's own small list.
   */
  app.get("/api/navroutes", (_req, res) => {
    // EDSM's answers for the route plotted now (the finder's Next): the kept systems now run to 200,000.
    const last = lastNavRoute();
    const ids = new Set(last.map((s) => s.address));
    const log = navRouteLog();
    res.json({ ...log, systems: log.systems.filter((s) => ids.has(s.address)), last: last.map((s) => s.address) });
  });
  /**
   * Every system on a route the commander plotted in the game (plan 1.3.3 R-2), for the map's "Plotted systems"
   * layer: compact rows (navRouteLog.ts `plottedSystemsCompact`) with whether the journals have him there.
   */
  /*
    `?since=<rev>&visited=<n>` (review 2026-11-10 F3): the map asks again on every jump, and the list (up to 200,000
    systems) rarely changes then. Same revision and the same count of visited systems: `{unchanged}`. Only more
    visited systems: the visited plotted addresses alone. Otherwise the whole list.
  */
  app.get("/api/navroutes/plotted", (req, res) => {
    const store = opts.getJournalStore?.() ?? null;
    const rev = plottedRevision();
    const visitedCount = store?.visitedSystems.size ?? 0;
    const since = Number(req.query.since);
    if (req.query.since !== undefined && since === rev) {
      if (Number(req.query.visited) === visitedCount) return void res.json({ rev, visitedCount, unchanged: true });
      const visited = plottedSystemsCompact()
        .map((r) => r[0])
        .filter((a) => store?.visitedSystems.has(a));
      return void res.json({ rev, visitedCount, visited });
    }
    res.json({
      rev,
      visitedCount,
      systems: plottedSystemsCompact().map((r) => [...r, store?.visitedSystems.has(r[0]) ? 1 : 0]),
    });
  });
  /** One plotted system with its tag (`?addr=`): the map's panel for a system the galaxy index does not have. */
  app.get("/api/navroutes/system", (req, res) => {
    const s = plottedSystem(Number(req.query.addr));
    if (!s) return void res.status(404).json({ error: "not on a plotted route" });
    const visited = !!opts.getJournalStore?.()?.visitedSystems.has(s.address);
    res.json({ ...s, visited, tag: plottedTag({ visited, edsm: s.edsm }) });
  });
  /** `{ addresses: number[] }` — ask EDSM about these (at most 2,000), in the background. */
  app.post("/api/navroutes/edsm-check", (req, res) => {
    const raw = (req.body as { addresses?: unknown } | undefined)?.addresses;
    const addresses = Array.isArray(raw)
      ? raw.filter((a): a is number => typeof a === "number" && Number.isFinite(a)).slice(0, 2000)
      : [];
    if (!addresses.length) {
      res.status(400).json({ ok: false, error: "addresses: a list of system addresses" });
      return;
    }
    void checkNavRouteSystemsOnEdsm(addresses);
    res.json({ ok: true });
  });
  app.delete("/api/navroutes", localOnly, (_req, res) => {
    clearNavRouteLog();
    res.json({ ok: true });
  });
}
