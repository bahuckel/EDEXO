/**
 * `/api/galaxy/finder*` — the galaxy map's system finder (plan docs/plan-finder-1.2.20.md): the data file's status
 * and download, and the search. Under /api/galaxy, so a search keeps the map's memory alive like any map request and
 * the decoded blocks go with the map's other caches when it idles.
 */
import type express from "express";
import { localOnly } from "../lanAuth.js";
import { registerGalaxyCache, touchGalaxyMemory } from "../galaxyMemory.js";
import {
  clearFinderIndex,
  downloadFinder,
  finderStatus,
  loadFinderIndex,
  probeFinderRelease,
  type FinderIndex,
} from "../finderIndex.js";
import { colonisedRefs, findInFinder, searchFinder, type FinderRef } from "../finderSearch.js";
import { normaliseFinderQuery, type FinderQuery, type FinderResult } from "../../shared/finder.js";
import { id64Boxel } from "../../shared/id64.js";
import type { HttpServerOptions, RouteContext } from "../httpServer.js";

/** "All colonised" read once per file (every block), then kept with the file. */
const colonisedOf = new WeakMap<FinderIndex, Promise<FinderRef[]>>();

export function registerFinderRoutes(app: express.Express, opts: HttpServerOptions, _ctx: RouteContext): void {
  registerGalaxyCache("finder", () => void clearFinderIndex());

  app.get("/api/galaxy/finder/status", async (_req, res) => {
    await probeFinderRelease();
    res.json(finderStatus());
  });

  app.post("/api/galaxy/finder/download", localOnly, (_req, res) => {
    void downloadFinder(() => opts.scheduleBroadcast?.());
    res.json({ ok: true, status: finderStatus() });
  });

  /** The commander's colonies, placed as /api/galaxy/own places them (StarPos, else the boxel's centre). */
  const myColonies = (): FinderRef[] => {
    const store = opts.getJournalStore?.() ?? null;
    if (!store) return [];
    const out: FinderRef[] = [];
    for (const c of store.ownAssets.colonies) {
      const p = store.systemPositions.get(c.addr);
      if (p) out.push({ name: c.name, x: p.x, y: p.y, z: p.z });
      else if (Number.isSafeInteger(c.addr)) {
        const b = id64Boxel(c.addr);
        if (b) out.push({ name: c.name, ...b.center });
      }
    }
    return out;
  };

  /** A system typed by name: the journals first (where he has been), then the finder file itself. */
  const lookUp = async (index: FinderIndex, name: string): Promise<FinderRef | null> => {
    const store = opts.getJournalStore?.() ?? null;
    const want = name.toLowerCase();
    if (store) {
      for (const [addr, n] of store.visitedSystems) {
        if (n.toLowerCase() !== want) continue;
        const p = store.systemPositions.get(addr);
        if (p) return { name: n, x: p.x, y: p.y, z: p.z };
      }
    }
    return findInFinder(index, name);
  };

  app.post("/api/galaxy/finder", async (req, res) => {
    touchGalaxyMemory();
    const q: FinderQuery = normaliseFinderQuery((req.body ?? {}) as Partial<FinderQuery>);
    const empty = (problem: string, extra: Partial<FinderResult> = {}): FinderResult => ({
      hits: [],
      matched: 0,
      references: [],
      partial: false,
      problem,
      dump: null,
      builtAt: null,
      ...extra,
    });
    let index: FinderIndex | null;
    try {
      index = loadFinderIndex();
    } catch (e) {
      return void res.json(empty(`The search data could not be read: ${e instanceof Error ? e.message : String(e)}`));
    }
    if (!index) return void res.json(empty("no-data"));
    const dates = { dump: index.meta.dump ?? null, builtAt: index.meta.builtAt ?? null };

    const mine = myColonies();
    let refs: FinderRef[];
    if (q.reference === "colonised") {
      let p = colonisedOf.get(index);
      if (!p) {
        p = colonisedRefs(index);
        colonisedOf.set(index, p);
      }
      refs = await p;
    } else if (q.reference === "picked") {
      if (q.pickedAt) refs = [{ name: q.picked || "Picked system", ...q.pickedAt }];
      else if (q.picked) {
        const found = await lookUp(index, q.picked);
        if (!found) return void res.json(empty(`"${q.picked}" is not in the search data or your journals.`, dates));
        refs = [found];
      } else return void res.json(empty("Pick a system on the map or type its name.", dates));
    } else {
      refs = mine;
      if (!refs.length) return void res.json(empty("Your journals have no colonised systems of yours yet.", dates));
    }

    const result = await searchFinder(index, q, refs, {
      knownClaimed: { ids: new Set(), names: new Set(mine.map((c) => c.name.toLowerCase())) },
      precomputedColonised: q.reference === "colonised",
    });
    if (q.reference === "picked" && result.matched === 0) {
      const r2 = q.radiusLy * q.radiusLy;
      const p = refs[0]!;
      const reachable = index.blocks.some((b) => index.blockDist2(b, p.x, p.y, p.z) <= r2);
      if (!reachable)
        result.problem = `${p.name} is outside the search's area (systems within ${index.meta.radius ?? 150} ly of inhabited space).`;
    }
    res.json(result);
  });
}
