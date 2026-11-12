/*
  The commander's own on the map: carrier and colonies, his systems, visited, the session route (split out of
  galaxyRoutes.ts, plan 2026-11-10 Phase 7.2; registered from it in the same order).
*/
import type express from "express";
import { perfCount } from "../perf.js";
import { loadBioIndexAsync } from "../bioIndex.js";
import { ownCarrierNow } from "../../shared/ownAssets.js";
import { id64Boxel } from "../../shared/id64.js";
import type { HttpServerOptions, RouteContext } from "../httpServerTypes.js";

export function registerGalaxyMineRoutes(app: express.Express, opts: HttpServerOptions, ctx: RouteContext): void {
  /** The commander's own systems with what they did there (G3; flags in galaxyMine.ts). */
  /*
    The commander's own carrier and colonised systems, for the map's badges (owner, 2026-10-13; shared/ownAssets.ts):
    where each is from the journals' StarPos, else the boxel's centre from its address (within a boxel of it).
  */
  const ownAssets = () => {
    const store = opts.getJournalStore?.() ?? null;
    if (!store) return { carrier: null, colonies: [] };
    const place = (s: { name: string; addr: number } | null) => {
      if (!s) return null;
      const p = store.systemPositions.get(s.addr);
      if (p) return { name: s.name, x: p.x, y: p.y, z: p.z, exact: true };
      // Above 2^53 the journal's number has lost the low bits the mass code is in: no guess (review 1.2.16).
      const b = Number.isSafeInteger(s.addr) ? id64Boxel(s.addr) : null;
      return b ? { name: s.name, ...b.center, exact: false } : null;
    };
    return {
      carrier: place(ownCarrierNow(store.ownAssets)),
      colonies: store.ownAssets.colonies.map(place).filter((c) => c != null),
    };
  };
  app.get("/api/galaxy/own", (_req, res) => res.json(ownAssets()));
  // The map's badges follow a carrier jump or a new colony when this changes (R2: was a poll every minute).
  ctx.watchTopic("galaxy-own", ownAssets);

  app.get("/api/galaxy/mine", (_req, res) => {
    if (!opts.getMySystems) return void res.status(404).json({ error: "no journal store behind this build" });
    res.json(opts.getMySystems());
  });

  /** One of them, body by body: `?addr=<SystemAddress>`. */
  app.get("/api/galaxy/mine/system", async (req, res) => {
    const addr = Number(req.query.addr);
    if (!Number.isFinite(addr)) return void res.status(400).json({ error: "addr must be a SystemAddress" });
    // The middleware does not read the index for it, and getMySystem reads it synchronously: read it here first.
    await loadBioIndexAsync();
    const dto = opts.getMySystem?.(addr) ?? null;
    if (!dto) return void res.status(404).json({ error: "not one of your systems" });
    res.json(dto);
  });

  /** The systems you have been to, newest first: `?days=1|7|30|90|365`, or 0 / absent for all. */
  app.get("/api/galaxy/visited", (req, res) => {
    if (!opts.getVisitedSystems)
      return void res.status(404).json({ error: "no journal store behind this build" });
    const days = Math.max(0, Math.min(100_000, Math.floor(Number(req.query.days) || 0)));
    res.json(opts.getVisitedSystems(days));
  });

  /** Where the ship is and this session's jumps with positions. */
  app.get("/api/galaxy/route", (_req, res) => {
    if (!opts.getSessionRoute)
      return void res.status(404).json({ error: "no journal store behind this build" });
    res.json(opts.getSessionRoute());
  });
  // The ship, the session's jumps and the plotted route (R2: the map asked every 15-30 s, the Next panel every 3 s).
  if (opts.getSessionRoute) ctx.watchTopic("galaxy-route", opts.getSessionRoute);

  app.get("/api/galaxy/my-sectors", (_req, res) => {
    perfCount("http.commanderSectors");
    if (!opts.getCommanderSectors) {
      res.status(404).json({ error: "no journal store behind this build" });
      return;
    }
    res.json(opts.getCommanderSectors());
  });
}
