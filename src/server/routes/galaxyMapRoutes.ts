/*
  The 3D map's cells, names, system panel, next target, search, sectors and tiles (split out of galaxyRoutes.ts,
  plan 2026-11-10 Phase 7.2; registered from it in the same order).
*/
import type express from "express";
import { getProjectRoot } from "../paths.js";
import type { HttpServerOptions } from "../httpServerTypes.js";
import { encodeCells, encodeTile, parseCellParam, sectorNames, tileIndex } from "../galaxyTiles.js";
import { loadBioIndexAsync, TIER_BODIES_KNOWN, TIER_CODEX, TIER_DSS, TIER_FSS } from "../bioIndex.js";
import { galaxySystemSpecies, galaxySystemValues } from "../galaxyValueSearch.js";
import { findPlottedSystems } from "../navRouteLog.js";
import { plottedTag } from "../../shared/plottedTag.js";
import { loadRegionMap } from "../regionMapData.js";
import { galaxyFind, galaxySector } from "../galaxyFind.js";
import { doneAddresses, MAX_PLAN_STOPS, nextTarget, ordinalsOf } from "../galaxyNext.js";
import type { GalaxyFindDTO, GalaxySystemDTO } from "../../shared/dto/galaxy.js";
import { loadStationsIndex, stationsStatus } from "../stationsIndex.js";
import { noIndex, sendBinary } from "./galaxyHttp.js";

export function registerGalaxyMapRoutes(app: express.Express, opts: HttpServerOptions): void {
  /** The non-empty 1,280 ly cells and their system counts (layout in galaxyTiles.ts). */
  app.get("/api/galaxy/cells", (_req, res) => {
    const t = tileIndex();
    if (!t) return void noIndex(res);
    sendBinary(res, encodeCells(t));
  });

  /** Each cell's sector name, same order as `/api/galaxy/cells` ("" where none). */
  app.get("/api/galaxy/sector-names", (_req, res) => {
    const t = tileIndex();
    if (!t) return void noIndex(res);
    res.json(sectorNames(t));
  });

  /** Names by system ordinal, for the map's labels: `?i=1,2,3` (at most 400). */
  app.get("/api/galaxy/names", async (req, res) => {
    const index = await loadBioIndexAsync();
    if (!index) return void noIndex(res);
    const ids = String(req.query.i ?? "")
      .split(",")
      .slice(0, 400)
      .map(Number)
      .filter((i) => Number.isInteger(i) && i >= 0 && i < index.systemCount);
    const out: Record<number, string> = {};
    for (const i of ids) out[i] = index.nameOf(i);
    res.json(out);
  });

  /** One system for the map's panel: `?i=<ordinal>`, or `?addr=<id64>` (a search hit, a journal system). */
  app.get("/api/galaxy/system", async (req, res) => {
    const index = await loadBioIndexAsync();
    if (!index) return void noIndex(res);
    let i = Number(req.query.i);
    if (req.query.addr != null) {
      try {
        i = index.ordinalOf(BigInt(String(req.query.addr)));
      } catch {
        i = -1;
      }
      if (i < 0) return void res.status(404).json({ ok: false, error: "not in the galaxy index" });
    }
    if (!Number.isInteger(i) || i < 0 || i >= index.systemCount) {
      return void res.status(400).json({ ok: false, error: "i must be a system ordinal" });
    }
    const s = index.systemAt(i);
    const species = galaxySystemSpecies(index, s.species);
    const regions = loadRegionMap(getProjectRoot())?.regions;
    const dto: GalaxySystemDTO = {
      ordinal: i,
      id64: s.id64.toString(),
      name: s.name,
      x: s.x,
      y: s.y,
      z: s.z,
      region: (s.regionId && regions?.[s.regionId]) || null,
      bodyCount: s.bodyCount || null,
      evidence: {
        fss: (s.tiers & TIER_FSS) !== 0,
        dss: (s.tiers & TIER_DSS) !== 0,
        codex: (s.tiers & TIER_CODEX) !== 0,
        bodiesKnown: (s.tiers & TIER_BODIES_KNOWN) !== 0,
      },
      species,
      valueCr: species.reduce((a, sp) => a + (sp.baseCr ?? 0), 0),
      distanceFromSolLy: Math.hypot(s.x, s.y, s.z),
    };
    res.json(dto);
  });

  /**
   * Next target: the nearest system to the ship worth at least `min` (100 k CR units, 1×) that the
   * commander has not analysed (DSS or foot scans; `skipVisited=1` also skips anything visited), not
   * counting `exclude` (ordinals skipped this session, at most 2,000). `plan=N` (≤ 20) adds a plan of
   * N stops from the ship (G5.3): chosen by a greedy chain, ordered by 2-opt (5.8); `loop=1` returns
   * to the ship.
   */
  app.get("/api/galaxy/next", async (req, res) => {
    const index = await loadBioIndexAsync();
    if (!index) return void noIndex(res);
    const store = opts.getJournalStore?.() ?? null;
    const exclude = new Set(
      String(req.query.exclude ?? "")
        .split(",")
        .slice(0, 2000)
        .map(Number)
        .filter((i) => Number.isInteger(i) && i >= 0),
    );
    if (store) {
      const done = doneAddresses(store);
      for (const i of ordinalsOf(index, done.analysed)) exclude.add(i);
      if (req.query.skipVisited === "1") for (const i of ordinalsOf(index, done.visited)) exclude.add(i);
    }
    const min = Math.max(0, Math.min(65535, Number(req.query.min) || 0));
    const plan = Math.max(0, Math.min(MAX_PLAN_STOPS, Math.floor(Number(req.query.plan) || 0)));
    const from = store?.commanderPos ?? opts.getCommanderPosition?.() ?? null;
    res.json(
      nextTarget(index, galaxySystemValues(index), from, min, exclude, 6, plan, req.query.loop === "1"),
    );
  });

  // The boxels (boxelRoutes.ts) and the discoveries, achievements and codex maps (discoveriesRoutes.ts) were here
  // (split out, discuss item 30, 1.3.1); registered in the same order, from httpServer.ts.

  /** Regions are the client's; this finds sectors and systems by name: `?q=`. */
  app.get("/api/galaxy/find", (req, res) => {
    const t = tileIndex();
    const q = String(req.query.q ?? "").slice(0, 80);
    const store = opts.getJournalStore?.() ?? null;
    // Without the galaxy index downloaded his own and the plotted systems below are still found (plan 1.3.3 R-2).
    const found: GalaxyFindDTO = galaxyFind(t, store, q, opts.getImportedSystems?.() ?? []);
    // Systems only a plotted route knows (plan 1.3.3 R-2): after the index's and his own, tagged.
    const have = new Set(found.systems.map((s) => s.name.toLowerCase()));
    for (const p of findPlottedSystems(q)) {
      if (have.has(p.name.toLowerCase())) continue;
      const visited = !!store?.visitedSystems.has(p.address);
      found.systems.push({
        name: p.name,
        x: p.pos[0],
        y: p.pos[1],
        z: p.pos[2],
        ordinal: null,
        addr: String(p.address),
        mine: false,
        plotted: plottedTag({ visited, edsm: p.edsm }) ?? "Plotted in-game, visited",
      });
    }
    // Stations by name, when they are downloaded (owner, 2026-10-13); a duplicated name says its system.
    let stations: NonNullable<GalaxyFindDTO["stations"]> = [];
    if (stationsStatus().present) {
      const mine = new Set((opts.getJournalStore?.()?.ownAssets.colonies ?? []).map((c) => c.name.toLowerCase()));
      try {
        stations = (loadStationsIndex()?.search(q) ?? []).map((r) => ({
          own: mine.has(r.system.toLowerCase()),
          name: r.name,
          system: r.system,
          label: r.dup ? `${r.name} (${r.system})` : r.name,
          type: r.type,
          pad: r.pad,
          x: r.x,
          y: r.y,
          z: r.z,
          layerId: r.sys,
        }));
      } catch {
        stations = [];
      }
    }
    res.json({ ...found, stations });
  });

  /** A sector column's panel: `?c=cx:cz` (every height together, as the map's rings are). */
  app.get("/api/galaxy/sector", (req, res) => {
    const m = /^(-?\d{1,3}):(-?\d{1,3})$/.exec(String(req.query.c ?? ""));
    if (!m) return void res.status(400).json({ ok: false, error: "c must be cx:cz" });
    const t = tileIndex();
    if (!t) return void noIndex(res);
    const dto = galaxySector(t, Number(m[1]), Number(m[2]));
    if (!dto) return void res.status(404).json({ ok: false, error: "empty sector" });
    res.json(dto);
  });

  /** One cell's systems at 0.02 ly: `?c=cx:cy:cz`. An empty cell is a 404, not an error. */
  app.get("/api/galaxy/tile", (req, res) => {
    const c = parseCellParam(req.query.c);
    if (!c) return void res.status(400).json({ ok: false, error: "c must be cx:cy:cz" });
    const t = tileIndex();
    if (!t) return void noIndex(res);
    const buf = encodeTile(t, c);
    if (!buf) return void res.status(404).json({ ok: false, error: "empty cell" });
    sendBinary(res, buf);
  });
}
