/**
 * What an expedition looks for besides exobiology (plan 5.2, owner 2026-10-12: "some people are not looking
 * for exobio but for rare stars and planets"), and the route between two points (plan 5.2: "from point A to
 * point B, not a large sphere").
 *
 * Bodies, stars and system worth come from `data/boxel/boxel-features.json` (docs/perf/boxel_features.py), per
 * region x mass code over the systems Spansh holds whole: how many of them carry a water world, an Earth-like,
 * an ammonia world, a helium-rich gas giant, how many gas giants in all, the main star's type, and what a
 * system pays a first discoverer who scans and maps it all (a histogram). A boxel's unflown systems are
 * expected to be like its cell's.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { boxelsWithin, type ExpeditionBoxel, type SectorNames } from "./expedition.js";
import { boxelCubeLy, type MassCode } from "../shared/boxelAdvice.js";

export type BodyKind = "ww" | "elw" | "aw" | "hrgg" | "gg";

export type ExpeditionTarget =
  | { kind: "exobio" }
  | { kind: "body"; body: BodyKind }
  | { kind: "star"; star: string }
  | { kind: "value"; minM: number };

export const BODY_KINDS: { key: BodyKind; label: string; unit: string }[] = [
  { key: "elw", label: "Earth-like worlds", unit: "systems with one" },
  { key: "ww", label: "Water worlds", unit: "systems with one" },
  { key: "aw", label: "Ammonia worlds", unit: "systems with one" },
  { key: "hrgg", label: "Helium-rich gas giants", unit: "systems with one" },
  { key: "gg", label: "Gas giants (dense boxels)", unit: "gas giants" },
];

export interface FeatureCell {
  complete: number;
  value: { mean: number; p90: number; bins: number[] };
  bodies: Record<string, { n: number; with: number }>;
  stars: Record<string, number>;
}
export interface FeatureTable {
  builtAt: string;
  valueEdgesM: number[];
  kinds: string[];
  byMass: Record<string, FeatureCell>;
  cells: Record<string, FeatureCell>;
}

/** A region's cell is used when it holds this many complete systems, else the mass code's over the galaxy. */
export const MIN_COMPLETE = 2000;

let cache: { root: string; table: FeatureTable } | null = null;
export function loadFeatureTable(root: string): FeatureTable {
  if (cache?.root === root) return cache.table;
  const table = JSON.parse(
    readFileSync(path.join(root, "data", "boxel", "boxel-features.json"), "utf8"),
  ) as FeatureTable;
  cache = { root, table };
  return table;
}

export function featureCellFor(
  table: FeatureTable,
  region: string | null,
  code: MassCode,
): FeatureCell | null {
  const c = region ? table.cells[`${region}|${code}`] : undefined;
  if (c && c.complete >= MIN_COMPLETE) return c;
  return table.byMass[code] ?? null;
}

/**
 * The share of systems worth at least `minM` million credits, read off the histogram: whole bands above it,
 * and of the band it falls in the part above it on a log scale (worth spreads over orders of magnitude).
 */
export function shareAtLeast(cell: FeatureCell, edgesM: readonly number[], minM: number): number {
  const n = cell.complete;
  if (n <= 0) return 0;
  if (minM <= 0) return 1;
  const lows = [0, ...edgesM];
  const highs = [...edgesM, Infinity];
  let above = 0;
  for (let i = 0; i < cell.value.bins.length; i++) {
    const lo = lows[i]!;
    const hi = highs[i]!;
    const count = cell.value.bins[i] ?? 0;
    if (lo >= minM) above += count;
    else if (hi > minM && count > 0) {
      // the part of [lo, hi) above minM; the open top band and a band from 0 count by its upper or lower edge
      const a = Math.log(Math.max(lo, 0.05));
      const b = Math.log(Number.isFinite(hi) ? hi : lo * 2);
      const f = b > a ? Math.max(0, Math.min(1, (b - Math.log(minM)) / (b - a))) : 0;
      above += count * f;
    }
  }
  return above / n;
}

/** Which of the main star types a target names: every type whose name starts with it ("White Dwarf" = all). */
function starShare(cell: FeatureCell, star: string): number {
  const total = Object.values(cell.stars).reduce((a, x) => a + x, 0);
  if (!total) return 0;
  const want = star.toLowerCase();
  let n = 0;
  for (const [k, v] of Object.entries(cell.stars)) if (k.toLowerCase().startsWith(want)) n += v;
  return n / total;
}

/**
 * What the boxel's unflown systems should hold of the target: systems (a body kind, a star type, a worth), or
 * gas giants for the dense-boxel kind. A system's worth "after scanning all exobio and planetary bodies" is
 * its scan worth plus its biology, and biology is all or nothing per system: with chance `bio.p` it carries
 * `bio.perBioSystem` credits (first footfall), else none. So the share worth at least X is
 * (1 - p) x share(scan >= X) + p x share(scan >= X - perBioSystem).
 */
export function expectedMatches(
  target: ExpeditionTarget,
  cell: FeatureCell | null,
  table: FeatureTable,
  remaining: number,
  bio: { p: number; perBioSystem: number } = { p: 0, perBioSystem: 0 },
): number {
  if (!cell || remaining <= 0 || target.kind === "exobio") return 0;
  if (target.kind === "body") {
    const b = cell.bodies[target.body];
    if (!b || cell.complete <= 0) return 0;
    return (remaining * (target.body === "gg" ? b.n : b.with)) / cell.complete;
  }
  if (target.kind === "star") return remaining * starShare(cell, target.star);
  const p = Math.max(0, Math.min(1, bio.p));
  const plain = shareAtLeast(cell, table.valueEdgesM, target.minM);
  const withBio = shareAtLeast(cell, table.valueEdgesM, Math.max(0, target.minM - bio.perBioSystem / 1e6));
  return remaining * ((1 - p) * plain + p * withBio);
}

/** Every main star type the table knows, commonest first: the Stars filter's list. */
export function starTypes(table: FeatureTable): { name: string; systems: number }[] {
  const sum = new Map<string, number>();
  for (const c of Object.values(table.byMass))
    for (const [k, v] of Object.entries(c.stars)) sum.set(k, (sum.get(k) ?? 0) + v);
  return [...sum]
    .filter(([k]) => k !== "Star")
    .map(([name, systems]) => ({ name, systems }))
    .sort((a, b) => b.systems - a.systems);
}

export function parseTarget(raw: unknown): ExpeditionTarget {
  const s = typeof raw === "string" ? raw.trim() : "";
  const [kind, rest] = [
    s.slice(0, s.indexOf(":") < 0 ? s.length : s.indexOf(":")),
    s.indexOf(":") < 0 ? "" : s.slice(s.indexOf(":") + 1),
  ];
  if (kind === "body" && BODY_KINDS.some((b) => b.key === rest))
    return { kind: "body", body: rest as BodyKind };
  if (kind === "star" && rest) return { kind: "star", star: rest.slice(0, 60) };
  if (kind === "value" && Number(rest) > 0) return { kind: "value", minM: Math.min(1000, Number(rest)) };
  return { kind: "exobio" };
}

/* ------------------------------------------------------------------ the route from A to B */

type Xyz = { x: number; y: number; z: number };
const sub = (a: Xyz, b: Xyz): Xyz => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Xyz, b: Xyz) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Xyz) => Math.sqrt(dot(a, a));

/** Where a point lies against the segment A→B: its distance from the line and how far along (0-1). */
export function alongSegment(p: Xyz, a: Xyz, b: Xyz): { offLy: number; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  const q = { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
  return { offLy: len(sub(p, q)), t };
}

/** The extra distance of going A → p → B instead of A → B. */
export function detourLy(p: Xyz, a: Xyz, b: Xyz): number {
  return Math.max(0, len(sub(p, a)) + len(sub(b, p)) - len(sub(b, a)));
}

/**
 * Every boxel of the codes that can reach within `widthLy` of the segment A→B (its centre within the width
 * plus its half-diagonal): spheres strung along it, each boxel once. A code that would give more than `maxPerCode` boxels along the whole
 * route is left out and named in `skipped`, as the sphere does.
 */
export function boxelsAlong(
  a: Xyz,
  b: Xyz,
  widthLy: number,
  codes: readonly MassCode[],
  names: SectorNames | null,
  maxPerCode = 40_000,
): { boxels: (ExpeditionBoxel & { offLy: number; t: number; detourLy: number })[]; skipped: MassCode[] } {
  const total = len(sub(b, a));
  const steps = Math.max(1, Math.ceil(total / widthLy));
  const seen = new Set<string>();
  const out: (ExpeditionBoxel & { offLy: number; t: number; detourLy: number })[] = [];
  const skipped = new Set<MassCode>();
  // How many a code gives along the route: the tube's volume over its cube.
  const tube = Math.PI * widthLy * widthLy * total + (4 / 3) * Math.PI * widthLy ** 3;
  const use = codes.filter((c) => {
    const n = tube / boxelCubeLy(c) ** 3;
    if (n > maxPerCode) skipped.add(c);
    return n <= maxPerCode;
  });
  for (const code of use) {
    // A boxel is on the route when its cube can reach the tube: its centre within the width plus its
    // half-diagonal (a 1,280 ly h-boxel crossing the line may have its centre far off it).
    const reach = widthLy + (boxelCubeLy(code) * Math.sqrt(3)) / 2;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const c = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
      const { boxels } = boxelsWithin(c, reach, [code], names, Number.MAX_SAFE_INTEGER);
      for (const bx of boxels) {
        const k = `${bx.code}:${bx.cell.join(",")}:${bx.position}`;
        if (seen.has(k)) continue;
        const along = alongSegment(bx.center, a, b);
        if (along.offLy > reach) continue;
        seen.add(k);
        out.push({
          ...bx,
          distanceLy: len(sub(bx.center, a)),
          offLy: along.offLy,
          t: along.t,
          detourLy: detourLy(bx.center, a, b),
        });
      }
    }
  }
  out.sort((x, y) => x.t - y.t);
  return { boxels: out, skipped: [...skipped] };
}

/**
 * End points to offer around the ship (plan 5.2: "a few suggestions for an end system in a circle around
 * them"): eight directions in the galactic plane at `distanceLy`, each the nearest named point the caller
 * has (`nearest`), so every suggestion is a real system.
 */
export function circleSuggestions(
  from: Xyz,
  distanceLy: number,
  nearest: (p: Xyz) => { name: string; x: number; y: number; z: number } | null,
): { direction: string; name: string; x: number; y: number; z: number; distanceLy: number }[] {
  const dirs = [
    "coreward",
    "coreward-spinward",
    "spinward",
    "rimward-spinward",
    "rimward",
    "rimward-antispinward",
    "antispinward",
    "coreward-antispinward",
  ];
  // Galactic frame: Sagittarius A* lies towards +z from Sol; spinward is -x.
  const out: { direction: string; name: string; x: number; y: number; z: number; distanceLy: number }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    const ang = (i * Math.PI) / 4;
    const p = { x: from.x - Math.sin(ang) * distanceLy, y: from.y, z: from.z + Math.cos(ang) * distanceLy };
    const s = nearest(p);
    if (!s || seen.has(s.name)) continue;
    seen.add(s.name);
    out.push({ direction: dirs[i]!, ...s, distanceLy: Math.round(len(sub(s, from))) });
  }
  return out;
}
