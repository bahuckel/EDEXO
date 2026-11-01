/**
 * `/api/route/system-values` — what a discovered system on the route is worth (plan 1.3.3 R-1 / R-3): its notable
 * planets, its biology, the FSS and DSS of the whole system, from Spansh (server/routeSystemValues.ts).
 */
import type express from "express";
import { createRouteSystemValues } from "../routeSystemValues.js";
import { journalScanRoute, journalSystemValues, spanshScanRoute } from "../scanRouteView.js";
import { explorationRecordsForSystem } from "../systemMap.js";
import type { HttpServerOptions } from "../httpServerTypes.js";
import { scanRouteShip } from "../shipInSystem.js";
import { createNetlogPosition } from "../netlogPosition.js";

export function registerRouteSystemRoutes(app: express.Express, opts: HttpServerOptions): void {
  const values = createRouteSystemValues(() => opts.getJournalStore?.() ?? null);
  // The netlog switch (plan 1.3.5 R-1): reads only while on.
  const netlog = createNetlogPosition();

  /** `/api/scan-route/ship` — where the ship is in the current system, polled by the Scan route every second or two. */
  app.get("/api/scan-route/ship", (_req, res) => {
    const store = opts.getJournalStore?.() ?? null;
    if (!store) return void res.status(503).json({ error: "The journals are not loaded yet." });
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
      res.json(own ?? (await values.values(addr, name)));
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
