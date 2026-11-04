/**
 * Where a composition-scanned plant really is (owner, 2026-11-04: "check if we can have the comp scan at the plant's
 * location instead of saving the ship location", and his sketch of two heading lines crossing at the plant).
 *
 * A biological `CodexEntry` carries the scanner's position, not the plant's: on foot that is the plant (median 0 m from
 * a sample of it, 78 entries in his journals), from the ship it is where the ship was (median 78 m, p75 768 m from the
 * nearest sample of that species, 41 entries; plan-02112026-1.3.6.md). The scanner points where the nose points, so:
 *
 * - two scans of one plant from two places: it stands where the two heading lines cross ("crossing");
 * - one scan, with the ship's altitude and its nose-down angle known: straight ahead at altitude / tan(angle)
 *   ("ahead");
 * - one scan, no angle (hovering, no flight-path estimate): the ship's position, as before ("scanned-from"), with the
 *   heading so the radar can say which way from there.
 *
 * Status.json gives heading and altitude but no pitch. {@link FlightPathPitch} estimates it as the flight-path angle,
 * the climb over the ground covered in the last second or two: with flight assist on the ship flies where its nose
 * points, which is also where the camera looks (owner: "camera almost always points directly at where the ship is
 * pointed").
 *
 * Distances are a flat plane around the first scan (east, north in metres): over the few kilometres a scanner reaches
 * the error is far below a plant's size.
 */

/** One composition scan of a plant: where the scanner was and how it was pointed. */
export interface CompScan {
  latDeg: number;
  lonDeg: number;
  /** Degrees clockwise from north; null when the game was not reporting one (or the scan was read from history). */
  headingDeg: number | null;
  /** Metres above the ground (Status.json Altitude, in the ship); null on foot or unknown. */
  altitudeM: number | null;
  /** The nose's angle, degrees, negative down (a flight-path estimate); null when not known. */
  pitchDeg: number | null;
  atIso: string;
  /** True when `pitchDeg` was read off the game's HUD (the launcher's pitch reader), not estimated. */
  pitchFromHud?: boolean;
  /** The ship's eye above the reported altitude when scanned, metres (server/eyeHeight.ts); 0 when not known. */
  eyeAboveM?: number;
}

export type PlantLocated = "crossing" | "ahead" | "scanned-from";

export interface PlantFix {
  latDeg: number;
  lonDeg: number;
  how: PlantLocated;
  /** "scanned-from": the heading of that scan, for the radar's tick. */
  headingDeg?: number;
}

/** How far ahead a composition scan is believed (a crossing or an estimate further out is not this plant). */
export const SCAN_REACH_M = 1500;
/** Two heading lines must meet at least this wide: a shallower crossing smears along the lines. */
export const MIN_CROSSING_DEG = 15;
/** Below this nose-down angle the altitude / tan estimate runs off to the horizon. */
const MIN_DEPRESSION_DEG = 3;

const RAD = Math.PI / 180;

/** East / north metres of a point from an origin, on a sphere of radius `r` (flat around the origin). */
export function toLocal(origin: { latDeg: number; lonDeg: number }, p: { latDeg: number; lonDeg: number }, r: number): { e: number; n: number } {
  let dLon = p.lonDeg - origin.lonDeg;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  return { e: dLon * RAD * r * Math.cos(origin.latDeg * RAD), n: (p.latDeg - origin.latDeg) * RAD * r };
}

/** The point `e`, `n` metres from the origin, back to latitude and longitude. */
export function fromLocal(origin: { latDeg: number; lonDeg: number }, e: number, n: number, r: number): { latDeg: number; lonDeg: number } {
  const latDeg = origin.latDeg + n / r / RAD;
  const cos = Math.cos(origin.latDeg * RAD);
  let lonDeg = origin.lonDeg + (cos > 1e-9 ? e / (r * cos) / RAD : 0);
  if (lonDeg > 180) lonDeg -= 360;
  if (lonDeg < -180) lonDeg += 360;
  return { latDeg, lonDeg };
}

/** Bearing, degrees clockwise from north, of a local offset. */
export function bearingDeg(e: number, n: number): number {
  const b = Math.atan2(e, n) / RAD;
  return b < 0 ? b + 360 : b;
}

/** A bearing minus a heading, folded to -180..180 (negative: to the left). */
export function relativeDeg(bearing: number, heading: number): number {
  let d = (bearing - heading) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Where two heading lines cross, as distances along each; null when parallel or nearly so. */
function crossing(
  a: { e: number; n: number; h: number },
  b: { e: number; n: number; h: number },
): { ta: number; tb: number; e: number; n: number } | null {
  const ax = Math.sin(a.h * RAD);
  const ay = Math.cos(a.h * RAD);
  const bx = Math.sin(b.h * RAD);
  const by = Math.cos(b.h * RAD);
  const det = ax * -by - ay * -bx;
  if (Math.abs(det) < 1e-9) return null;
  const dx = b.e - a.e;
  const dy = b.n - a.n;
  const ta = (dx * -by - dy * -bx) / det;
  const tb = (ax * dy - ay * dx) / det;
  return { ta, tb, e: a.e + ta * ax, n: a.n + ta * ay };
}

/** Where the plant the scans name stands, best first: a crossing, straight ahead, or where it was scanned from. */
export function locatePlant(scans: readonly CompScan[], radiusM: number): PlantFix | null {
  if (!scans.length) return null;
  const origin = scans[0]!;
  if (!(radiusM > 0)) return { latDeg: origin.latDeg, lonDeg: origin.lonDeg, how: "scanned-from", ...(origin.headingDeg != null ? { headingDeg: origin.headingDeg } : {}) };
  const rays = scans
    .filter((s) => s.headingDeg != null && Number.isFinite(s.headingDeg))
    .map((s) => ({ ...toLocal(origin, s, radiusM), h: s.headingDeg! }));

  // Every pair of lines that meets ahead of both scans, within reach, wide enough.
  const hits: { e: number; n: number }[] = [];
  for (let i = 0; i < rays.length; i++)
    for (let j = i + 1; j < rays.length; j++) {
      const a = rays[i]!;
      const b = rays[j]!;
      const angle = Math.abs(relativeDeg(a.h, b.h));
      if (angle < MIN_CROSSING_DEG || angle > 180 - MIN_CROSSING_DEG) continue;
      const c = crossing(a, b);
      if (!c || c.ta <= 0 || c.tb <= 0 || c.ta > SCAN_REACH_M || c.tb > SCAN_REACH_M) continue;
      hits.push({ e: c.e, n: c.n });
    }
  if (hits.length) {
    // More than one pair: the crossings that agree (within 150 m of their median), averaged.
    const med = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]!;
    const me = med(hits.map((h) => h.e));
    const mn = med(hits.map((h) => h.n));
    const near = hits.filter((h) => Math.hypot(h.e - me, h.n - mn) <= 150);
    const e = near.reduce((s, h) => s + h.e, 0) / near.length;
    const n = near.reduce((s, h) => s + h.n, 0) / near.length;
    return { ...fromLocal(origin, e, n, radiusM), how: "crossing" };
  }

  // One scan: straight ahead when the altitude and the nose-down angle say how far.
  for (let i = scans.length - 1; i >= 0; i--) {
    const s = scans[i]!;
    if (s.headingDeg == null || s.altitudeM == null || s.pitchDeg == null || !(s.altitudeM > 0)) continue;
    const down = -s.pitchDeg;
    if (down < MIN_DEPRESSION_DEG || down >= 90) continue;
    // From the eye, not the reported altitude (the cockpit sits above it: eyeHeight.ts).
    const dist = (s.altitudeM + (s.eyeAboveM ?? 0)) / Math.tan(down * RAD);
    if (dist > SCAN_REACH_M) continue;
    const p = toLocal(origin, s, radiusM);
    return {
      ...fromLocal(origin, p.e + dist * Math.sin(s.headingDeg * RAD), p.n + dist * Math.cos(s.headingDeg * RAD), radiusM),
      how: "ahead",
    };
  }

  // Where it was scanned from (the owner's fallback): the latest scan, with its heading for the radar's tick.
  const last = scans[scans.length - 1]!;
  return { latDeg: last.latDeg, lonDeg: last.lonDeg, how: "scanned-from", ...(last.headingDeg != null ? { headingDeg: last.headingDeg } : {}) };
}

/** A second scan pairs with a plant's open scan only this soon after it: scan, fly round it, scan again. */
export const PAIR_WINDOW_MS = 180_000;
/** A scan joins a plant placed by two scans when its heading line passes this close to it. */
export const ON_LINE_M = 30;
/** A scan from where a plant already is (on foot, the scan's spot is the plant) is that plant. */
const SAME_SPOT_M = 10;

const timeOf = (s: CompScan) => {
  const t = Date.parse(s.atIso);
  return Number.isFinite(t) ? t : 0;
};

/**
 * Which plant each scan of one species on one body named (owner, 2026-11-04: two Tubers scanned twice each were
 * averaged into one dot between them). Every heading line crosses every other somewhere, so the geometry alone cannot
 * tell; in time order, a scan joins:
 * 1. a plant two scans already placed, when its line passes within {@link ON_LINE_M} of it, ahead and within reach;
 * 2. else a plant whose newest scan is within {@link PAIR_WINDOW_MS} and whose line it crosses validly (the second scan
 *    of the plant just scanned);
 * 3. else it is a new plant. A scan without a heading (on foot, or from before headings were kept) joins only a plant
 *    at its own spot (within {@link SAME_SPOT_M}).
 */
export function clusterScans(scans: readonly CompScan[], radiusM: number): CompScan[][] {
  const plants: CompScan[][] = [];
  const sorted = [...scans].sort((a, b) => timeOf(a) - timeOf(b));
  for (const s of sorted) {
    let best = -1;
    let bestScore = Infinity;
    if (radiusM > 0)
      plants.forEach((p, i) => {
        const at = locatePlant(p, radiusM)!;
        const o = toLocal(s, at, radiusM);
        const d = Math.hypot(o.e, o.n);
        if (s.headingDeg == null && d <= SAME_SPOT_M && d < bestScore) {
          best = i;
          bestScore = d;
        }
      });
    if (s.headingDeg != null && radiusM > 0) {
      plants.forEach((p, i) => {
        const at = locatePlant(p, radiusM)!;
        if (at.how === "crossing") {
          const o = toLocal(s, at, radiusM);
          const h = s.headingDeg! * RAD;
          const along = o.e * Math.sin(h) + o.n * Math.cos(h);
          const off = Math.abs(o.e * Math.cos(h) - o.n * Math.sin(h));
          if (along > 0 && along <= SCAN_REACH_M && off <= ON_LINE_M && off < bestScore) {
            best = i;
            bestScore = off;
          }
          return;
        }
        const last = [...p].reverse().find((x) => x.headingDeg != null);
        if (!last || timeOf(s) - timeOf(last) > PAIR_WINDOW_MS) return;
        if (locatePlant([last, s], radiusM)!.how !== "crossing") return;
        const score = ON_LINE_M + (timeOf(s) - timeOf(last)) / 1000;
        if (score < bestScore) {
          best = i;
          bestScore = score;
        }
      });
    }
    if (best >= 0) plants[best]!.push(s);
    else plants.push([s]);
  }
  return plants;
}

/**
 * The ship's nose angle from its path: the climb over the ground covered in the last `windowMs`. Null when hovering or
 * crawling (under `minSpeedMs` over the ground) or without altitude: then nothing says where the nose points.
 */
export class FlightPathPitch {
  private readonly pts: { t: number; latDeg: number; lonDeg: number; altM: number }[] = [];
  private last: number | null = null;

  constructor(
    private readonly windowMs = 3000,
    private readonly minSpeedMs = 5,
  ) {}

  /** A new fix; the pitch estimate after it. */
  push(fix: { latDeg: number; lonDeg: number; planetRadiusM: number; altitudeM?: number | null }, tMs: number): number | null {
    if (fix.altitudeM == null || !(fix.planetRadiusM > 0)) {
      this.reset();
      return null;
    }
    // The file is read far more often than the game rewrites it: an unchanged fix is not a new point.
    const prev = this.pts[this.pts.length - 1];
    if (prev && prev.latDeg === fix.latDeg && prev.lonDeg === fix.lonDeg && prev.altM === fix.altitudeM) {
      if (tMs - prev.t > this.windowMs) this.reset();
      return this.last;
    }
    this.pts.push({ t: tMs, latDeg: fix.latDeg, lonDeg: fix.lonDeg, altM: fix.altitudeM });
    while (this.pts.length > 2 && tMs - this.pts[0]!.t > this.windowMs) this.pts.shift();
    const first = this.pts[0]!;
    const dt = (tMs - first.t) / 1000;
    if (this.pts.length < 2 || dt < 0.3) return (this.last = null);
    const d = toLocal(first, fix, fix.planetRadiusM);
    const ground = Math.hypot(d.e, d.n);
    if (ground / dt < this.minSpeedMs) return (this.last = null);
    return (this.last = Math.atan2(fix.altitudeM - first.altM, ground) / RAD);
  }

  reset(): void {
    this.pts.length = 0;
    this.last = null;
  }
}
