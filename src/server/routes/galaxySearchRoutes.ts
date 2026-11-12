/*
  The map's searches: species catalogue, regions, possible bodies, worth (split out of galaxyRoutes.ts, plan
  2026-11-10 Phase 7.2; registered from it in the same order).
*/
import type express from "express";
import { perfCount } from "../perf.js";
import { loadBioIndexAsync } from "../bioIndex.js";
import type { HttpServerOptions } from "../httpServerTypes.js";

export function registerGalaxySearchRoutes(app: express.Express, opts: HttpServerOptions): void {
  app.get("/api/galaxy/species", async (_req, res) => {
    perfCount("http.galaxySpecies");
    if (!opts.getGalaxySpecies) {
      res.status(404).json({ error: "no galaxy index in this build" });
      return;
    }
    await loadBioIndexAsync();
    res.json(opts.getGalaxySpecies());
  });

  app.get("/api/galaxy/regions", (_req, res) => {
    perfCount("http.galaxyRegions");
    if (!opts.getGalaxyRegions) {
      res.status(404).json({ error: "no galaxy body file on this machine" });
      return;
    }
    res.json(opts.getGalaxyRegions());
  });

  /**
   * Bodies that could hold a species, in places nobody has looked.
   *
   * The evidence ticks arrive as three independent booleans rather than a mode, because that is
   * what they are: FSS-only, already probed, and already walked are separate questions and the
   * commander may want any combination. Defaults match the panel's — untouched bodies only.
   */
  app.get("/api/galaxy/possible", (req, res) => {
    perfCount("http.galaxyPossible");
    if (!opts.scanGalaxyBodies) {
      res.status(404).json({ error: "no galaxy body file on this machine" });
      return;
    }
    const regionId = Number(req.query.regionId ?? 0);
    if (!Number.isFinite(regionId) || regionId <= 0) {
      res.status(400).json({ error: "regionId must be a positive region index" });
      return;
    }
    const limit = Number(req.query.limit ?? 200);
    const list = (v: unknown): string[] | undefined => {
      const raw = String(v ?? "").trim();
      if (!raw) return undefined;
      const parts = raw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      return parts.length ? parts : undefined;
    };
    // Absent means the default, so `fss=0` can turn the default off — `!== "0"` would read a
    // missing parameter as a tick the commander never made.
    const tick = (v: unknown, fallback: boolean): boolean => {
      const raw = String(v ?? "").trim();
      if (!raw) return fallback;
      return raw === "1" || raw.toLowerCase() === "true";
    };
    opts
      .scanGalaxyBodies(
        {
          regionId: Math.trunc(regionId),
          speciesIds: list(req.query.species),
          genusDirs: list(req.query.genus),
          includeUnprobed: tick(req.query.fss, true),
          includeProbed: tick(req.query.dss, false),
          includeWalked: tick(req.query.walked, false),
          // Absent or 0 means no floor, which is the default; see GalaxyBodyScanQueryDTO.
          minGravityOddsPct: Number(req.query.minGravityOdds ?? 0) || 0,
        },
        Number.isFinite(limit) ? limit : 200,
      )
      .then((dto) => res.json(dto))
      .catch((e: unknown) => {
        console.warn(`ED Exo Compare — galaxy body scan failed: ${String(e)}`);
        res.status(500).json({ error: "the galaxy body scan failed" });
      });
  });

  app.get("/api/galaxy/worth", async (req, res) => {
    perfCount("http.galaxyWorth");
    if (!opts.searchGalaxyByValue) {
      res.status(404).json({ error: "no galaxy index in this build" });
      return;
    }
    const minCr = Number(req.query.minCr ?? 0);
    const limit = Number(req.query.limit ?? 200);
    if (!Number.isFinite(minCr) || minCr < 0) {
      res.status(400).json({ error: "minCr must be a non-negative number" });
      return;
    }
    /** Comma-separated so the whole query stays a GET a human can read in a log. */
    const list = (v: unknown): string[] | undefined => {
      const raw = String(v ?? "").trim();
      if (!raw) return undefined;
      const parts = raw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      return parts.length ? parts : undefined;
    };
    const tiers = Number(req.query.tiers ?? 0);
    await loadBioIndexAsync();
    res.json(
      opts.searchGalaxyByValue(
        {
          minCr,
          speciesIds: list(req.query.species),
          genusDirs: list(req.query.genus),
          requireTiers: Number.isFinite(tiers) && tiers > 0 ? tiers : 0,
        },
        Number.isFinite(limit) ? limit : 200,
      ),
    );
  });
}
