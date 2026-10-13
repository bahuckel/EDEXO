/**
 * Expedition planner routes (plan 2.4, 2026-10-11): `/api/expedition/field`, `/plan`, `/boxel`. The work is
 * in `expeditionService.ts`; this file reads the query and finds the ship.
 *
 * `field`: `?x&y&z` (default the ship), `radius` (ly, at most 3,000), `species` (a species id: target-species
 * mode), `minEv`, `limit`, `codes` (mass codes, default c–h). `plan`: `?stops=<key>;<key>…` (at most 20; a
 * key holds commas, so the stops are split on semicolons).
 * `boxel`: `?key=<key>`: the score and the system names nobody has recorded. `light=1` on `field` (the header's
 * "Next boxel", plan 2.7) uses the galaxy index only when it is already in memory, and never reads it.
 *
 * Plan 5.2 (owner, 2026-10-12): `field` also takes `target` (`exobio` | `body:<elw|ww|aw|hrgg|gg>` |
 * `star:<type>` | `value:<millions>`) and a route, `toX&toY&toZ` with `width` (ly, the corridor, at most
 * 1,000). `targets`: the body kinds and every main star type. `ends?distance=`: end systems to offer, eight
 * directions round the ship, each the nearest system of the galaxy index.
 */
import type express from "express";
import { getProjectRoot } from "../paths.js";
import { loadBioIndexAsync, peekBioIndex } from "../bioIndex.js";
import { loadPriceList, type PriceIndex } from "../priceList.js";
import { loadRegionMap } from "../regionMapData.js";
import { loadSpatialCatalogue } from "../spatialCatalogue.js";
import { getCachedSpeciesDatabase } from "../snapshot.js";
import { fullJumpRange } from "../../shared/jumpRange.js";
import { boxelSystems } from "../boxel.js";
import { tileIndexAsync } from "../galaxyTiles.js";
import { touchGalaxyMemory } from "../galaxyMemory.js";
import { massCodeOfSystem } from "../../shared/id64.js";
import type { MassCode } from "../../shared/boxelAdvice.js";
import { systemPrefixOf } from "../expedition.js";
import { expeditionCandidates, expeditionField, expeditionPlan, parseCodes, type ExpeditionDeps } from "../expeditionService.js";
import { BODY_KINDS, circleSuggestions, loadFeatureTable, parseTarget, starTypes } from "../expeditionTargets.js";
import type { HttpServerOptions, RouteContext } from "../httpServer.js";

type Xyz = { x: number; y: number; z: number };

let prices: { root: string; idx: PriceIndex } | null = null;
function priceIndex(root: string): PriceIndex {
  if (prices?.root !== root) prices = { root, idx: loadPriceList(root) };
  return prices.idx;
}

export function registerExpeditionRoutes(app: express.Express, opts: HttpServerOptions, _ctx: RouteContext): void {
  // The planner reads the galaxy map's caches (bio index, tiles, the barren table): keep their idle clock running.
  app.use("/api/expedition", (_req, _res, next) => {
    touchGalaxyMemory();
    next();
  });
  /** An async handler's throw answered as a 500, never an unhandled rejection (which ends the server process). */
  const safe =
    (h: (req: express.Request, res: express.Response) => Promise<void>) =>
    (req: express.Request, res: express.Response): void => {
      h(req, res).catch((e: unknown) => {
        if (!res.headersSent) res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
      });
    };
  const ship = (): { from: Xyz | null; jumpRangeLy: number | null } => {
    const store = opts.getJournalStore?.() ?? null;
    return {
      from: store?.commanderPos ?? opts.getCommanderPosition?.() ?? null,
      jumpRangeLy: store ? fullJumpRange(store.jumpRange) : null,
    };
  };
  const pointOf = (q: express.Request["query"], fallback: Xyz | null): Xyz | null => {
    const x = Number(q.x);
    const y = Number(q.y);
    const z = Number(q.z);
    return [x, y, z].every(Number.isFinite) && q.x !== undefined ? { x, y, z } : fallback;
  };
  const deps = async (withIndex: boolean | "peek"): Promise<ExpeditionDeps> => {
    const root = getProjectRoot();
    return {
      root,
      index: withIndex === "peek" ? peekBioIndex() : withIndex ? await loadBioIndexAsync() : null,
      prices: priceIndex(root),
      species: getCachedSpeciesDatabase().species,
      regionMap: loadRegionMap(root),
      catalogue: loadSpatialCatalogue(root),
    };
  };

  app.get("/api/expedition/field", async (req, res) => {
    const s = ship();
    const from = pointOf(req.query, s.from);
    if (!from) return void res.status(400).json({ error: "No position: give x, y, z, or fly a jump so the journals have one." });
    try {
      const radius = Number(req.query.radius);
      const species = typeof req.query.species === "string" && req.query.species.trim() ? req.query.species.trim().slice(0, 80) : null;
      res.json(
        await expeditionField(
          {
            from,
            radiusLy: Number.isFinite(radius) ? radius : 0,
            jumpRangeLy: s.jumpRangeLy,
            speciesId: species,
            minEv: Math.max(0, Number(req.query.minEv) || 0),
            limit: Number(req.query.limit) || undefined,
            codes: parseCodes(req.query.codes),
            // Each in its own mass code's boxel (the name's letter, or the address when it is exact).
            visitedPoints: (opts.getMySystems?.().systems ?? []).map((v) => ({
              x: v.x,
              y: v.y,
              z: v.z,
              code: (v.code as MassCode | undefined) ?? massCodeOfSystem(v.addr, v.name),
            })),
            target: parseTarget(req.query.target),
            to: pointOf({ x: req.query.toX, y: req.query.toY, z: req.query.toZ }, null),
            widthLy: Number(req.query.width) || undefined,
          },
          await deps(req.query.light === "1" ? "peek" : true),
        ),
      );
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/expedition/targets", (_req, res) => {
    try {
      const t = loadFeatureTable(getProjectRoot());
      res.json({ bodies: BODY_KINDS, stars: starTypes(t), valueEdgesM: t.valueEdgesM, builtAt: t.builtAt });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/expedition/ends", safe(async (req, res) => {
    const s = ship();
    const from = pointOf(req.query, s.from);
    if (!from) return void res.status(400).json({ error: "No position: give x, y, z, or fly a jump so the journals have one." });
    const distance = Math.max(200, Math.min(20_000, Number(req.query.distance) || 2000));
    const index = await loadBioIndexAsync();
    if (!index) return void res.json({ from, distanceLy: distance, ends: [] });
    // The nearest galaxy-index system to each of the eight points, in one pass.
    const pts = Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      return { x: from.x - Math.sin(a) * distance, y: from.y, z: from.z + Math.cos(a) * distance };
    });
    const best = pts.map(() => ({ i: -1, d: Infinity }));
    index.forEachPoint((i, x, y, z) => {
      for (let k = 0; k < 8; k++) {
        const p = pts[k]!;
        const d = (x - p.x) ** 2 + (y - p.y) ** 2 + (z - p.z) ** 2;
        if (d < best[k]!.d) best[k] = { i, d };
      }
    });
    const near = (p: Xyz) => {
      const k = pts.findIndex((q) => q.x === p.x && q.z === p.z);
      const b = best[k];
      if (!b || b.i < 0) return null;
      const [x, y, z] = index.pointAt(b.i);
      return { name: index.nameOf(b.i), x, y, z };
    };
    res.json({ from, distanceLy: distance, ends: circleSuggestions(from, distance, near) });
  }));

  app.get("/api/expedition/plan", safe(async (req, res) => {
    const s = ship();
    const from = pointOf(req.query, s.from);
    if (!from) return void res.status(400).json({ error: "No position: give x, y, z, or fly a jump so the journals have one." });
    const keys = String(req.query.stops ?? "").split(";").map((k) => k.trim()).filter(Boolean);
    if (!keys.length) return void res.status(400).json({ error: "stops is required: boxel keys, separated by semicolons." });
    res.json(expeditionPlan(keys, { from, jumpRangeLy: s.jumpRangeLy }, await deps(false)));
  }));

  app.get("/api/expedition/boxel", safe(async (req, res) => {
    const s = ship();
    const from = pointOf(req.query, s.from) ?? { x: 0, y: 0, z: 0 };
    const key = String(req.query.key ?? "");
    const store = opts.getJournalStore?.() ?? null;
    // Built off the request's thread: the header's Next boxel card asks for this before the map has built it.
    const tiles = await tileIndexAsync();
    // The names the journals or the galaxy index already know, as the Boxels screen lists them.
    const knownNames = (boxelName: string) => {
      const dto = boxelSystems({
        query: `${systemPrefixOf(boxelName)}0`,
        end: null,
        index: tiles,
        visited: store ? store.visitedSystems.entries() : [],
        speciesName: (id) => id,
      });
      return new Set((dto?.rows ?? []).filter((r) => r.visited || r.known).map((r) => r.name.toLowerCase()));
    };
    const out = expeditionCandidates(key, { from, jumpRangeLy: s.jumpRangeLy, knownNames }, await deps(false));
    if (!out) return void res.status(400).json({ error: "Not a boxel key: <code>:<cx,cy,cz>:<position>." });
    res.json(out);
  }));
}
