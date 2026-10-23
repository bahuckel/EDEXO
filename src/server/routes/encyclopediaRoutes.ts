/** The Encyclopedia and the field guide (moved out of httpServer.ts, audit 2026-10-22). */
import type express from "express";
import type { HttpServerOptions, RouteContext } from "../httpServerTypes.js";
import { perfBytes } from "../perf.js";
import type { EstimatedSurfaceTempBand, PlanetScan, SpeciesMatchContext } from "../../shared/types.js";
import { sendJson } from "./httpHelpers.js";

export function registerEncyclopediaRoutes(
  app: express.Express,
  opts: HttpServerOptions,
  _ctx: RouteContext,
): void {
  app.get("/api/species-encyclopedia", (req, res) => {
    if (typeof opts.getEncyclopedia !== "function") {
      res.status(501).json({ error: "Not available" });
      return;
    }
    try {
      sendJson(req, res, JSON.stringify({ species: opts.getEncyclopedia() }), (raw, sent) => {
        perfBytes("http.encyclopedia.bytes", raw);
        perfBytes("http.encyclopedia.sent", sent);
      });
    } catch {
      res.status(500).json({ error: "Could not load species database." });
    }
  });

  /*
    Every species' standing in one region, for the Encyclopedia's region marks and filter (guild tester
    report, 2026-09-30: "have it default to or at least highlight the current region").
  */
  app.get("/api/encyclopedia-region", (req, res) => {
    const name = typeof req.query.name === "string" ? req.query.name.trim().slice(0, 80) : "";
    if (!name || typeof opts.getEncyclopediaRegion !== "function") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    res.json({ region: name, species: opts.getEncyclopediaRegion(name) });
  });

  /*
    The body comes from the client, which already holds it (the Encyclopedia's "vs this body"), so the
    route needs no lookup and grades exactly the scan the cards are drawn from.
  */
  app.post("/api/encyclopedia/card-verdicts", (req, res) => {
    const b = (req.body ?? {}) as { scan?: unknown; est?: unknown; ctx?: unknown };
    if (typeof opts.getCardVerdicts !== "function" || !b.scan || typeof b.scan !== "object") {
      res.status(400).json({ error: "scan is required" });
      return;
    }
    try {
      res.json({
        verdicts: opts.getCardVerdicts(
          b.scan as PlanetScan,
          (b.est && typeof b.est === "object" ? b.est : null) as EstimatedSurfaceTempBand | null,
          (b.ctx && typeof b.ctx === "object" ? b.ctx : null) as SpeciesMatchContext | null,
        ),
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/field-guide", (req, res) => {
    if (typeof opts.getFieldGuide !== "function") {
      res.status(501).json({ error: "Not available" });
      return;
    }
    try {
      sendJson(req, res, JSON.stringify(opts.getFieldGuide()), (raw, sent) => {
        perfBytes("http.fieldGuide.bytes", raw);
        perfBytes("http.fieldGuide.sent", sent);
      });
    } catch {
      res.status(500).json({ error: "Could not build the field guide." });
    }
  });

  app.get("/api/encyclopedia-exomastery/:genusDir/:speciesEntryId", (req, res) => {
    if (typeof opts.getEncyclopediaExomastery !== "function") {
      res.status(501).json({ error: "Not available" });
      return;
    }
    const genusDir = decodeURIComponent(String(req.params.genusDir));
    const speciesEntryId = decodeURIComponent(String(req.params.speciesEntryId));
    const fq = req.query?.force;
    const force =
      fq === "1" ||
      (typeof fq === "string" && fq.toLowerCase() === "true") ||
      (Array.isArray(fq) && fq.some((x) => x === "1" || String(x).toLowerCase() === "true"));
    const rawFocus = req.query?.focusBodyKey;
    const focusBodyKey = typeof rawFocus === "string" && rawFocus.trim().length > 0 ? rawFocus.trim() : null;
    if (force && typeof opts.clearExomasteryProfileCache === "function") {
      opts.clearExomasteryProfileCache();
    }
    try {
      const payload = opts.getEncyclopediaExomastery(genusDir, speciesEntryId, focusBodyKey);
      if (!payload) {
        res
          .status(404)
          .json({ error: "No exomastery data for this species (feeder profile or at least one EDSM row)." });
        return;
      }
      res.json(payload);
    } catch {
      res.status(500).json({ error: "Could not load exomastery encyclopedia data." });
    }
  });
}
