/*
  The commander's own maps and lists (split out of galaxyRoutes.ts, discuss item 30, 1.3.1): discoveries, the
  first-discovery backlog map, achievements, the codex by region (gaps, nearest), the region and sector maps.
*/

import path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import express from "express";
import { getProjectRoot } from "../paths.js";
import { perfCount } from "../perf.js";
import { codexMapRegion, codexMapRegions, codexRegionsData } from "../codexMap.js";
import { codexRegionGaps, nearestInRegion } from "../codexVariantCounts.js";
import type { HttpServerOptions, RouteContext } from "../httpServerTypes.js";


export function registerDiscoveriesRoutes(
  app: express.Express,
  opts: HttpServerOptions,
  _ctx: RouteContext,
): void {
  app.get("/api/discoveries", (_req, res) => {
    perfCount("http.discoveries");
    if (!opts.getDiscoveries) {
      res.status(404).json({ error: "discoveries not available in this build" });
      return;
    }
    res.json(opts.getDiscoveries());
  });

  app.get("/api/backlog-map", (_req, res) => {
    perfCount("http.backlogMap");
    if (!opts.getBacklogMap) {
      res.status(404).json({ error: "no journal store behind this build" });
      return;
    }
    Promise.resolve(opts.getBacklogMap())
      .then((dto) => res.json(dto))
      .catch((e: unknown) => {
        console.warn(`ED Exo Compare — backlog map failed: ${String(e)}`);
        res.status(500).json({ error: "the backlog map failed" });
      });
  });

  app.get("/api/achievements", (_req, res) => {
    perfCount("http.achievements");
    if (!opts.getAchievements) {
      res.status(501).json({ error: "Not available" });
      return;
    }
    res.json(opts.getAchievements());
  });

  app.get("/api/achievements/detail", (req, res) => {
    const id = typeof req.query.id === "string" ? req.query.id : "";
    const out = id && opts.getAchievementDetail ? opts.getAchievementDetail(id) : null;
    if (!out) {
      res.status(404).json({ error: "no such achievement" });
      return;
    }
    res.json(out);
  });

  /** POST { id: string | null } — track one achievement, or none. */
  app.post("/api/achievements/track", (req, res) => {
    if (!opts.trackAchievement) {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const id = (req.body as { id?: unknown } | undefined)?.id;
    if (id !== null && typeof id !== "string") {
      res.status(400).json({ ok: false, error: 'JSON body must include "id": string or null.' });
      return;
    }
    if (!opts.trackAchievement(id)) {
      res.status(404).json({ ok: false, error: "no such achievement" });
      return;
    }
    opts.scheduleBroadcast?.();
    res.json({ ok: true });
  });

  app.get("/api/codex/regions", (_req, res) => {
    perfCount("http.codexRegions");
    res.json(codexMapRegions(getProjectRoot(), opts.getCodexMapLogged?.() ?? new Set()));
  });

  app.get("/api/codex/region", (req, res) => {
    perfCount("http.codexRegion");
    const name = typeof req.query.name === "string" ? req.query.name : "";
    const kind = req.query.kind === "bodies" || req.query.kind === "bio" ? req.query.kind : null;
    if (!name || !kind) {
      res.status(400).json({ error: "name and kind (bodies|bio) are required" });
      return;
    }
    const out = codexMapRegion(getProjectRoot(), opts.getCodexMapLogged?.() ?? new Set(), name, kind);
    if (!out) {
      res.status(404).json({ error: "no codex data for that region" });
      return;
    }
    res.json(out);
  });

  // The colours logged in a region that are not in the commander's codex there, rarest first (1.2.19).
  app.get("/api/codex/gaps", (req, res) => {
    perfCount("http.codexGaps");
    const name = typeof req.query.region === "string" ? req.query.region : "";
    if (!name) {
      res.status(400).json({ error: "region is required" });
      return;
    }
    const root = getProjectRoot();
    const names = new Map((codexRegionsData(root)?.types ?? []).map(([id, n]) => [id, n] as [string, string]));
    const out = codexRegionGaps(root, opts.getCodexMapLogged?.() ?? new Set(), name, names);
    if (!out) {
      res.status(404).json({ error: "no codex data for that region" });
      return;
    }
    res.json(out);
  });

  // The nearest system IN THAT REGION known to have a codex entry, from the given position (1.2.19).
  app.get("/api/codex/nearest", (req, res) => {
    perfCount("http.codexNearest");
    const region = typeof req.query.region === "string" ? req.query.region : "";
    const key = typeof req.query.key === "string" ? req.query.key : "";
    const num = (v: unknown) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
    if (!region || !key) {
      res.status(400).json({ error: "region and key are required" });
      return;
    }
    const out = nearestInRegion(getProjectRoot(), region, key, { x: num(req.query.x), y: num(req.query.y), z: num(req.query.z) });
    if (!out) {
      res.status(404).json({ error: "no known system with it in that region" });
      return;
    }
    res.json(out);
  });

  app.get("/api/region-map", (_req, res) => {
    perfCount("http.regionMap");
    const file = path.join(getProjectRoot(), "data", "exomastery", "region-map.json");
    if (!existsSync(file)) {
      res.status(404).json({ error: "no region map vendored in this build" });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.type("application/json").send(readFileSync(file, "utf8"));
  });

  app.get("/api/first-discovery-backlog", (_req, res) => {
    perfCount("http.firstDiscoveryBacklog");
    if (!opts.getFirstDiscoveryBacklog) {
      res.status(404).json({ error: "no journal store behind this build" });
      return;
    }
    Promise.resolve(opts.getFirstDiscoveryBacklog())
      .then((dto) => res.json(dto))
      .catch((e: unknown) => {
        console.warn(`ED Exo Compare — first-discovery backlog failed: ${String(e)}`);
        res.status(500).json({ error: "the first-discovery backlog failed" });
      });
  });

  app.get("/api/sector-map", (_req, res) => {
    perfCount("http.sectorMap");
    const file = path.join(getProjectRoot(), "data", "exomastery", "sector-map.json");
    if (!existsSync(file)) {
      res.status(404).json({ error: "no sector map built yet — run: npm run feeder -- sector-map --write" });
      return;
    }
    res.type("application/json").send(readFileSync(file, "utf8"));
  });

  /**
   * One sector's systems (Phase 10 step 4).
   *
   * The file is 935 kB for 3,015 systems and would be far larger once the Spansh export lands, so
   * the client never downloads it — it asks for the cell it just clicked. The file is parsed once
   * and held; it changes only when the feeder runs, and re-reading 935 kB per hover would be silly.
   *
   * The cell key arrives as a query parameter rather than a path segment because it contains colons.
   */
  let sectorSystemsCache: { mtimeMs: number; cells: Record<string, unknown[]> } | null = null;
  app.get("/api/sector-systems", (req, res) => {
    perfCount("http.sectorSystems");
    const cell = String(req.query.cell ?? "").trim();
    if (!/^-?\d+:-?\d+:-?\d+$/.test(cell)) {
      res.status(400).json({ error: "cell must look like x:y:z" });
      return;
    }
    const file = path.join(getProjectRoot(), "data", "exomastery", "sector-systems.json");
    if (!existsSync(file)) {
      res
        .status(404)
        .json({ error: "no sector systems built yet — run: npm run feeder -- sector-map --write" });
      return;
    }
    const mtimeMs = statSync(file).mtimeMs;
    if (!sectorSystemsCache || sectorSystemsCache.mtimeMs !== mtimeMs) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { cells?: Record<string, unknown[]> };
      sectorSystemsCache = { mtimeMs, cells: parsed.cells ?? {} };
    }
    res.json({ cell, systems: sectorSystemsCache.cells[cell] ?? [] });
  });
}
