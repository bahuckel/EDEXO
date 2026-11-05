/**
 * `/api/route/system-values` — what a discovered system on the route is worth (plan 1.3.3 R-1 / R-3): its notable
 * planets, its biology, the FSS and DSS of the whole system, from Spansh (server/routeSystemValues.ts).
 */
import type express from "express";
import { createRouteSystemValues } from "../routeSystemValues.js";
import { journalScanRoute, journalSystemValues, spanshScanRoute } from "../scanRouteView.js";
import { explorationRecordsForSystem } from "../systemMap.js";
import type { HttpServerOptions } from "../httpServerTypes.js";
import { markScanRouteViewed, scanRouteShip } from "../shipInSystem.js";
import { createNetlogPosition } from "../netlogPosition.js";
import type { RouteSystemValuesDTO } from "../../shared/dto/routeSystem.js";

/** Bodies with biology in a system's values: a signal count or a value for its species. */
const bioBodies = (v: RouteSystemValuesDTO): number => v.bodies.filter((b) => (b.bioSignals ?? 0) > 0 || (b.bioCr ?? 0) > 0).length;

export function registerRouteSystemRoutes(app: express.Express, opts: HttpServerOptions): void {
  const values = createRouteSystemValues(() => opts.getJournalStore?.() ?? null);
  // The netlog switch (plan 1.3.5 R-1): reads only while on.
  const netlog = createNetlogPosition();

  /** `/api/scan-route/ship` — where the ship is in the current system, polled by the Scan route every second or two. */
  app.get("/api/scan-route/ship", (req, res) => {
    const store = opts.getJournalStore?.() ?? null;
    if (!store) return void res.status(503).json({ error: "The journals are not loaded yet." });
    // The Scan route tab showing: the distance reader's trigger (hudReadDistance), pushed to the HUD socket.
    if (req.query.view === "1") markScanRouteViewed(() => opts.scheduleBroadcast?.());
    res.json(scanRouteShip(store, netlog));
  });

  /** `/api/scan-route/netlog` `{ on }` — the switch: sets the game's verbose netlog, or puts back what it changed. */
  app.post("/api/scan-route/netlog", (req, res) => {
    const on = (req.body as { on?: unknown } | undefined)?.on;
    if (typeof on !== "boolean") return void res.status(400).json({ error: "on: true or false" });
    res.json(netlog.setOn(on));
  });

  /** `?addr=<id64>&name=<system>`: waits for Spansh when the system is not cached (one fetch at a time). */
  app.get("/api/route/system-values", async (req, res) => {
    const addr = Number(req.query.addr);
    if (!Number.isSafeInteger(addr) || addr <= 0) return void res.status(400).json({ error: "addr: a system address" });
    const name = String(req.query.name ?? "").slice(0, 80);
    try {
      // His own records first (a system he has been to, or EDSM filled in), else Spansh.
      const store = opts.getJournalStore?.() ?? null;
      const own = store ? journalSystemValues(store, addr, name) : null;
      /*
        His records can know fewer bodies with biology than Spansh: none (a jump through, or EDSM's bodies, which carry
        no signals; plan 1.3.6 S-1: Stein 2051 said 0 where Spansh's route has 15.9 M), or only the ones he scanned in a
        system he passed through (2026-11-03: Blatrimpe, one of Spansh's seven, 35 M of 122 M). Spansh's answer when it
        knows more of them. A system he scanned whole (every body of the honk's count) knows them all: no fetch.
      */
      if (own && own.bodyTotal != null && own.missing === 0) return void res.json(own);
      if (own) {
        const sp = await values.values(addr, name).catch(() => null);
        if (sp?.state === "ok" && bioBodies(sp) > bioBodies(own)) return void res.json(sp);
        return void res.json(own);
      }
      res.json(await values.values(addr, name));
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  /**
   * `/api/scan-route?addr=<id64>&name=<system>&min=<cr>` — the scan view of a system (plan 1.3.3 R-4): the current
   * system without `addr`. From the journals when they have it, else Spansh (waits for the fetch).
   */
  app.get("/api/scan-route", async (req, res) => {
    const store = opts.getJournalStore?.() ?? null;
    if (!store) return void res.status(503).json({ error: "The journals are not loaded yet." });
    const asked = req.query.addr != null ? Number(req.query.addr) : null;
    const addr = asked ?? store.currentSystemAddress;
    if (addr == null || !Number.isSafeInteger(addr) || addr <= 0) return void res.status(400).json({ error: "addr: a system address" });
    const name = String(req.query.name ?? (asked == null ? (store.currentSystem ?? "") : "")).slice(0, 80);
    const min = Math.max(0, Number(req.query.min) || 0);
    const settings = { minDssCr: min, bioMinCr: Math.max(0, Number(req.query.bioMin) || 0), codexOn: req.query.codex === "1" };
    const now = Date.now();
    // The ship's body in the current system: the journal's, or the netlog's last near one when newer.
    const hereId = addr === store.currentSystemAddress ? scanRouteShip(store, netlog).atId : null;
    try {
      // His own system: the bodies others discovered fill in what his scans lack (Spansh's, cached for the session).
      const own = explorationRecordsForSystem(store, addr);
      if (own.length && own[0] !== store.remoteSystems.get(addr)?.records[0]) {
        const fetched = await values.system(addr, name).catch(() => null);
        const spansh = fetched && !("none" in fetched) && !("error" in fetched) ? fetched : null;
        const view = journalScanRoute(store, addr, name, settings, now, spansh, hereId);
        if (view) return void res.json(view);
      }
      const sys = await values.system(addr, name);
      if ("none" in sys || "error" in sys) {
        const why = "none" in sys ? sys.none : sys.error;
        return void res.json({
          addr: String(addr), name, source: "spansh", state: "none" in sys ? "none" : "error", error: why, atMs: now, minDssCr: min,
          bioMinCr: settings.bioMinCr, codexOn: settings.codexOn, totals: { scanCr: 0, mappedCr: 0, currentCr: null, codexNew: 0, codexFirst: 0 },
          startId: null, bodies: [], route: { order: [], totalLs: 0 }, bodyCount: { known: 0, total: null, missing: 0 }, routeDssCr: 0, routeBioCr: 0,
        });
      }
      res.json(spanshScanRoute(store, sys, settings, now, hereId));
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}
