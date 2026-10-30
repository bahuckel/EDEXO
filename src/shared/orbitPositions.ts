/**
 * Where a system's bodies are, from their orbits (plan 1.3.3 R-4, the scan route): each body's Kepler orbit around
 * its parent (the first of its `Parents`: a star, a planet or a barycentre), moved on from where the scan saw it to
 * now, and its parent's place added. In light-seconds, the system's root (body 0, a star or a barycentre) at 0.
 *
 * The orbit is the journal's (Scan, ScanBaryCentre: semi-major axis in metres, period in seconds, angles in degrees)
 * or EDSM's / Spansh's in the same units (edsmSystemHydration.ts). A body without its phase (no mean anomaly or no
 * time for it) sits at a fixed angle by its id, at the right distance from its parent.
 */
import type { ExplorationScanRecord } from "./dto/scan.js";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const METRES_PER_LS = 299_792_458;
const DEG = Math.PI / 180;
/** The golden angle: bodies without a phase spread round their parent instead of in a line. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** The journal's `Parents` ([{ Planet: 3 }, { Null: 1 }, { Star: 0 }], nearest first) as ids. */
export function parentIds(parents: unknown): number[] {
  if (!Array.isArray(parents)) return [];
  const out: number[] = [];
  for (const p of parents) {
    if (!p || typeof p !== "object") continue;
    const v = Object.values(p as Record<string, unknown>)[0];
    if (typeof v === "number" && Number.isInteger(v)) out.push(v);
  }
  return out;
}

/** Eccentric anomaly for mean anomaly `m` (radians), Newton's method. */
function eccentricAnomaly(m: number, e: number): number {
  let E = e < 0.8 ? m : Math.PI;
  for (let k = 0; k < 30; k++) {
    const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

/** The body's place relative to its parent (ls) at `nowMs`; null without a semi-major axis. */
export function orbitOffset(r: ExplorationScanRecord, nowMs: number, id: number): Vec3 | null {
  const a = r.semiMajorAxis;
  if (!(typeof a === "number" && a > 0)) return null;
  const aLs = a / METRES_PER_LS;
  const e = Math.min(0.99, Math.max(0, r.eccentricity ?? 0));
  const i = (r.orbitalInclination ?? 0) * DEG;
  const w = (r.periapsis ?? 0) * DEG;
  const node = (r.ascendingNode ?? 0) * DEG;
  let m: number;
  if (typeof r.meanAnomaly === "number" && typeof r.orbitEpochMs === "number" && (r.orbitalPeriod ?? 0) > 0) {
    const turns = (nowMs - r.orbitEpochMs) / 1000 / r.orbitalPeriod!;
    m = r.meanAnomaly * DEG + 2 * Math.PI * (turns - Math.floor(turns));
  } else m = id * GOLDEN;
  const E = eccentricAnomaly(((m % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), e);
  const xp = aLs * (Math.cos(E) - e);
  const yp = aLs * Math.sqrt(1 - e * e) * Math.sin(E);
  const cO = Math.cos(node), sO = Math.sin(node), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i);
  return {
    x: xp * (cO * cw - sO * sw * ci) - yp * (cO * sw + sO * cw * ci),
    y: xp * (sO * cw + cO * sw * ci) + yp * (cO * cw * ci - sO * sw),
    z: xp * (sw * si) + yp * (cw * si),
  };
}

/**
 * Every body's place (ls) by its journal id, barycentres included (by their `Null` id). A parent the records lack
 * stands at its own parent's place, the next one up the body's chain.
 */
export function systemPositions(records: readonly ExplorationScanRecord[], nowMs: number): Map<number, Vec3> {
  return placeBodies(records, nowMs, null);
}

/**
 * The view's places (plan 1.3.3 R-4): each orbit's offset kept in direction, its length compressed by level, flat
 * (seen from above). True distances run from a moon's light-second to a companion star's hundred thousand; on a
 * log scale per level both are on screen. Moons (level 2 and down) on a smaller scale than the root's planets.
 */
export function systemViewPositions(records: readonly ExplorationScanRecord[], nowMs: number): Map<number, Vec3> {
  return placeBodies(records, nowMs, (len, depth) => (depth <= 1 ? 12 * Math.log10(1 + len / 2) : 3.2 * Math.log10(1 + len * 3)));
}

function placeBodies(
  records: readonly ExplorationScanRecord[],
  nowMs: number,
  /** The offset's shown length for its true length (ls) at a depth (1 = orbits the root); null for true places. */
  scale: ((len: number, depth: number) => number) | null,
): Map<number, Vec3> {
  const byId = new Map<number, ExplorationScanRecord>();
  for (const r of records) {
    if (r.isSynthetic) continue;
    const id = r.isBarycentreJournal ? r.journalBarycentreNullId : r.bodyId;
    if (typeof id === "number" && !byId.has(id)) byId.set(id, r);
  }
  // A barycentre's own parents come from its members' chains (ScanBaryCentre has none): the rest after it.
  const chainOf = new Map<number, number[]>();
  for (const r of byId.values()) {
    const chain = parentIds(r.parents);
    for (let k = 0; k < chain.length; k++) if (!chainOf.has(chain[k]!)) chainOf.set(chain[k]!, chain.slice(k + 1));
  }
  const out = new Map<number, Vec3>();
  const depthOf = new Map<number, number>();
  const busy = new Set<number>();
  const place = (id: number): Vec3 => {
    const done = out.get(id);
    if (done) return done;
    if (busy.has(id)) return { x: 0, y: 0, z: 0 };
    busy.add(id);
    const r = byId.get(id);
    const chain = r && !r.isBarycentreJournal ? parentIds(r.parents) : (chainOf.get(id) ?? []);
    // The nearest parent that is known, else the system's root.
    const parentId = chain.find((p) => byId.has(p) || p === 0);
    const base = parentId == null || parentId === id ? { x: 0, y: 0, z: 0 } : place(parentId);
    let off = r && chain.length ? orbitOffset(r, nowMs, id) : null;
    const depth = parentId == null || parentId === id ? 0 : (depthOf.get(parentId) ?? 0) + 1;
    depthOf.set(id, depth);
    if (off && scale) {
      // Flat: the direction seen from above, the length on the level's scale.
      const flat = Math.hypot(off.x, off.y);
      const len = Math.hypot(off.x, off.y, off.z);
      const k = flat > 0 ? scale(len, depth) / flat : 0;
      off = { x: off.x * k, y: off.y * k, z: 0 };
    }
    const p = off ? { x: base.x + off.x, y: base.y + off.y, z: base.z + off.z } : base;
    out.set(id, p);
    busy.delete(id);
    return p;
  };
  for (const id of byId.keys()) place(id);
  return out;
}

export const distLs = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
