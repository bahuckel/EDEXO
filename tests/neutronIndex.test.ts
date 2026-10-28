/**
 * The neutron index's queries (server/neutronIndex.ts) on a small file written here: `within` (stars by sub-cube since
 * 2026-10-28) and `eachToward` (the planner's walk, most promising sub-cubes first) against a plain scan of the stars.
 */
import { closeSync, mkdtempSync, openSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { NeutronIndex } from "../src/server/neutronIndex.js";
import { getProjectRoot } from "../src/server/paths.js";
import { SECTOR_ORIGIN, SECTOR_SIZE_LY } from "../src/shared/sectorName.js";

type P = { x: number; y: number; z: number };

/** A v1 index of `stars`, by sector cell, no stored names. */
function writeIndex(file: string, stars: P[]) {
  const cells = new Map<string, P[]>();
  const cellOf = (s: P) =>
    [s.x - SECTOR_ORIGIN.x, s.y - SECTOR_ORIGIN.y, s.z - SECTOR_ORIGIN.z].map((v) => Math.floor(v / SECTOR_SIZE_LY));
  for (const s of stars) {
    const k = cellOf(s).join(",");
    cells.set(k, [...(cells.get(k) ?? []), s]);
  }
  const meta = Buffer.from(JSON.stringify({ neutrons: stars.length }));
  const head = Buffer.alloc(16);
  head.write("EDEXONEU", 0, "latin1");
  head.writeUInt32LE(1, 8);
  head.writeUInt32LE(meta.length, 12);
  const n = Buffer.alloc(4);
  n.writeUInt32LE(cells.size);
  const cellBuf = Buffer.alloc(cells.size * 14);
  const recs: Buffer[] = [];
  let first = 0;
  [...cells.entries()].forEach(([k, list], c) => {
    const [sx, sy, sz] = k.split(",").map(Number) as [number, number, number];
    cellBuf.writeUInt16LE(sx, c * 14);
    cellBuf.writeUInt16LE(sy, c * 14 + 2);
    cellBuf.writeUInt16LE(sz, c * 14 + 4);
    cellBuf.writeUInt32LE(first, c * 14 + 6);
    cellBuf.writeUInt32LE(list.length, c * 14 + 10);
    for (const s of list) {
      const r = Buffer.alloc(16);
      r.writeUInt16LE(Math.round((s.x - SECTOR_ORIGIN.x - sx * SECTOR_SIZE_LY) * 32), 0);
      r.writeUInt16LE(Math.round((s.y - SECTOR_ORIGIN.y - sy * SECTOR_SIZE_LY) * 32), 2);
      r.writeUInt16LE(Math.round((s.z - SECTOR_ORIGIN.z - sz * SECTOR_SIZE_LY) * 32), 4);
      recs.push(r);
    }
    first += list.length;
  });
  writeFileSync(file, Buffer.concat([head, meta, n, cellBuf, ...recs, Buffer.alloc(4)]));
}

let s = 7;
const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
// Across sector borders round Sol (sectors meet at x -65, y -25 and z 55 nearby).
const stars: P[] = Array.from({ length: 4000 }, () => ({
  x: Math.round((rnd() - 0.5) * 3000 * 32) / 32,
  y: Math.round((rnd() - 0.5) * 3000 * 32) / 32,
  z: Math.round((rnd() - 0.5) * 3000 * 32) / 32,
}));
const dir = mkdtempSync(path.join(tmpdir(), "edexo-neutron-index-"));
const file = path.join(dir, "neutrons.bin");
writeIndex(file, stars);
const fd = openSync(file, "r");
const index = new NeutronIndex(fd, getProjectRoot());
afterAll(() => closeSync(fd));

const d = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const key = (p: P) => `${p.x},${p.y},${p.z}`;
const QUERIES: [P, number][] = [
  [{ x: 0, y: 0, z: 0 }, 240],
  [{ x: -65, y: -25, z: 55 }, 500],
  [{ x: 700, y: -300, z: 1200 }, 200],
  [{ x: -1400, y: 1400, z: -1400 }, 900],
];

describe("neutron index", () => {
  it("finds exactly the stars within a radius, across sector cells", () => {
    for (const [p, r] of QUERIES) {
      const got = index.within(p, r).map(key).sort();
      const want = stars.filter((n) => d(n, p) <= r).map(key).sort();
      expect(got, `${key(p)} r ${r}`).toEqual(want);
      expect(want.length).toBeGreaterThan(0);
    }
  });

  it("walks towards a target: every star that brings it nearer, and the best ones first enough to stop early", () => {
    const to = { x: 5000, y: 200, z: -3000 };
    for (const [p, r] of QUERIES) {
      const left = d(p, to);
      const want = stars.filter((n) => d(n, p) <= r && left - d(n, to) > 0);
      const all: string[] = [];
      index.eachToward(p, r, to, (n, gain, dist) => {
        expect(gain).toBeCloseTo(left - d(n, to), 6);
        expect(dist).toBeCloseTo(d(n, p), 6);
        all.push(key(n));
      }, () => -Infinity);
      expect(all.sort()).toEqual(want.map(key).sort());
      // Stopping once nothing can beat the 10th best kept still finds the true 10 best.
      const kept: number[] = [];
      index.eachToward(p, r, to, (_n, gain) => {
        kept.push(gain);
        kept.sort((a, b) => b - a);
        kept.length = Math.min(kept.length, 10);
      }, () => (kept.length < 10 ? -Infinity : kept[9]!));
      const best = want.map((n) => left - d(n, to)).sort((a, b) => b - a).slice(0, 10);
      expect(kept.map((g) => g.toFixed(6))).toEqual(best.map((g) => g.toFixed(6)));
    }
  });

  it("skips a sub-cube by its own floor: none taken further out, every close one still visited", () => {
    // The planner keeps no more far ones (floor Infinity past 150 ly) but every one within 150 ly.
    const to = { x: 5000, y: 200, z: -3000 };
    for (const [p, r] of QUERIES) {
      const left = d(p, to);
      const seen = new Set<string>();
      index.eachToward(p, r, to, (n) => seen.add(key(n)), (near) => (near > 150 ? Infinity : -Infinity));
      for (const n of stars)
        if (d(n, p) <= Math.min(r, 150) && left - d(n, to) > 0) expect(seen.has(key(n)), key(n)).toBe(true);
      // Only sub-cubes that reach within 150 ly: nothing past 150 + the cube's diagonal (139 ly).
      for (const k of seen) {
        const [x, y, z] = k.split(",").map(Number) as [number, number, number];
        expect(d({ x, y, z }, p)).toBeLessThanOrEqual(150 + 80 * Math.sqrt(3) + 1e-6);
      }
    }
  });
});
