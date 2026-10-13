/*
  Jumponium on the galaxy map (1.2.16): bodies rich in the FSD injection materials near a point, from the commander's
  own scans (every landable body he scanned) and the optional galaxy file (docs/perf/build_jumponium.py), filtered by
  element, how much counts, gravity and distance from arrival, nearest first.
*/
import type express from "express";
import type { HttpServerOptions } from "../httpServer.js";
import { touchGalaxyMemory } from "../galaxyMemory.js";
import {
  filterKeep,
  loadJumponiumIndex,
  ownJumpBodies,
  type JumpBody,
  type JumpFilter,
  type JumpLevel,
} from "../jumponiumIndex.js";
import { isJumpElement, jumponiumView, type JumpElement, type JumponiumDTO } from "../../shared/jumponium.js";

export interface JumponiumNearDTO {
  from: { x: number; y: number; z: number };
  bodies: (JumpBody & { distLy: number })[];
  /** The galaxy file is there (else only his own scans were searched). */
  galaxyFile: boolean;
  ownScanned: number;
  /** What is aboard and what each injection makes (null without a journal store). */
  stock: JumponiumDTO | null;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : null;
};

export function parseJumpFilter(q: Record<string, unknown>): JumpFilter {
  const els = String(q.els ?? "")
    .split(/[|,]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is JumpElement => isJumpElement(s) && s !== "carbon");
  const level: JumpLevel = q.level === "any" || q.level === "top" ? q.level : "rich";
  const maxG = num(q.maxG);
  const maxLs = num(q.maxLs);
  return {
    els: [...new Set(els)],
    all: q.all === "1",
    level,
    maxG: maxG != null && maxG > 0 ? maxG : null,
    maxLs: maxLs != null && maxLs > 0 ? maxLs : null,
  };
}

let ownMemo: { store: object; key: string; bodies: JumpBody[] } | null = null;

export function registerJumponiumRoutes(app: express.Express, opts: HttpServerOptions): void {
  app.get("/api/jumponium/near", (req, res) => {
    touchGalaxyMemory();
    const q = req.query as Record<string, unknown>;
    const x = num(q.x);
    const y = num(q.y);
    const z = num(q.z);
    const from = x != null && y != null && z != null ? { x, y, z } : (opts.getCommanderPosition?.() ?? null);
    if (!from)
      return void res
        .status(400)
        .json({ error: "No position: give x, y, z, or fly a jump so the journals have one." });
    const f = parseJumpFilter(q);
    const keep = filterKeep(f);
    const maxLy = Math.min(5000, Math.max(10, num(q.maxLy) ?? 1000));
    const limit = Math.min(500, Math.max(1, Math.floor(num(q.limit) ?? 100)));
    const d = (b: { x: number; y: number; z: number }) =>
      Math.hypot(b.x - from.x, b.y - from.y, b.z - from.z);

    const store = opts.getJournalStore?.() ?? null;
    let own: JumpBody[] = [];
    if (store) {
      // Every scan is read once per change of the scans, not per request (review 1.2.16: 100+ ms at 200 k scans).
      const key = `${store.explorationScansRevision}:${store.explorationScans.size}:${store.soldExplorationScans.size}:${store.systemPositions.size}`;
      if (ownMemo?.store !== store || ownMemo.key !== key)
        ownMemo = {
          store,
          key,
          bodies: ownJumpBodies(
            [...store.explorationScans.values(), ...store.soldExplorationScans.values()],
            (a) => store.systemPositions.get(a),
          ),
        };
      own = ownMemo.bodies;
    }
    const seen = new Set<string>();
    const out: (JumpBody & { distLy: number })[] = [];
    for (const b of own) {
      const k = b.body.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      const dl = d(b);
      if (dl <= maxLy && keep(b)) out.push({ ...b, distLy: dl });
    }
    let galaxyFile = false;
    const ownOnly = q.own === "1";
    try {
      const index = loadJumponiumIndex();
      if (index) galaxyFile = true;
      if (index && !ownOnly) {
        for (const b of index.near(from, maxLy, keep, limit)) {
          const k = b.body.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ ...b, distLy: d(b) });
        }
      }
    } catch (e) {
      return void res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
    out.sort((a, b) => a.distLy - b.distLy);
    const body: JumponiumNearDTO = {
      from,
      bodies: out.slice(0, limit),
      galaxyFile,
      ownScanned: own.length,
      stock: store ? jumponiumView(store.jumponium) : null,
    };
    res.json(body);
  });
}
