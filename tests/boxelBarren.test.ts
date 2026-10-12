/**
 * Systems flown since 2025 without biology, per boxel (owner, 2026-10-12): the expedition planner no longer counts
 * them as unflown. The file format (docs/perf/boxel_barren.py), its refusals, the look-up, and the shipped table.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { barrenIn, barrenNumbersIn, loadBarrenTable, parseBarrenTable } from "../src/server/boxelBarren.js";
import { gridIdAt } from "../src/server/expedition.js";
import { SECTOR_ORIGIN } from "../src/shared/sectorName.js";
import { boxelCubeLy, type MassCode } from "../src/shared/boxelAdvice.js";

const root = path.resolve(__dirname, "..");

function varint(n: number, out: number[]): void {
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
}

/** The builder's layout, from rows per code (grid ids sorted); version 2 writes each row's system numbers. */
function encode(
  codes: Record<string, [number, number, number[]?][]>,
  meta: object = { builtAt: "test" },
  version = 2,
): Buffer {
  const m = Buffer.from(JSON.stringify(meta));
  const head = Buffer.alloc(16);
  head.write("EDEXOBRN", 0, "latin1");
  head.writeUInt32LE(version, 8);
  head.writeUInt32LE(m.length, 12);
  const parts: Buffer[] = [head, m];
  const n = Buffer.alloc(4);
  n.writeUInt32LE(Object.keys(codes).length, 0);
  parts.push(n);
  for (const [code, rows] of Object.entries(codes)) {
    const h = Buffer.alloc(8);
    h[0] = code.charCodeAt(0);
    h.writeUInt32LE(rows.length, 4);
    const body: number[] = [];
    let prev = 0;
    for (const [g] of rows) {
      varint(g - prev, body);
      prev = g;
    }
    for (const [, c] of rows) varint(c, body);
    if (version >= 2)
      for (const [, c, nums = []] of rows) {
        expect(nums.length).toBe(c);
        let last = 0;
        for (const v of nums) {
          varint(v - last, body);
          last = v;
        }
      }
    parts.push(h, Buffer.from(body));
  }
  return Buffer.concat(parts);
}

describe("boxel-barren: the file", () => {
  // A grid id past 2^32 (gz × 2^28), so the varint must not use 32-bit shifts.
  const big = 600 + 500 * 16384 + 300 * 268435456;
  const forty = Array.from({ length: 40 }, (_, i) => i * 3);
  const rows = {
    c: [
      [5, 2, [0, 300]],
      [7, 3, [1, 2, 16_000]],
      [big, 40, forty],
    ] as [number, number, number[]][],
    h: [[1, 9, [0, 1, 2, 3, 4, 5, 6, 7, 8]]] as [number, number, number[]][],
  };
  const buf = encode(rows, { builtAt: "2026-10-12", recentFrom: "2025" });

  it("reads back every boxel and count, and 0 where it has none", () => {
    const t = parseBarrenTable(buf);
    expect(t.meta.recentFrom).toBe("2025");
    expect(barrenIn(t, "c", 5)).toBe(2);
    expect(barrenIn(t, "c", 7)).toBe(3);
    expect(barrenIn(t, "c", big)).toBe(40);
    expect(barrenIn(t, "c", 6)).toBe(0);
    expect(barrenIn(t, "h", 1)).toBe(9);
    expect(barrenIn(t, "d", 5)).toBe(0);
    expect(barrenIn(null, "c", 5)).toBe(0);
  });

  it("gives each boxel's system numbers (version 2), and none from a version 1 file", () => {
    const t = parseBarrenTable(buf);
    expect(barrenNumbersIn(t, "c", 5)).toEqual([0, 300]);
    expect(barrenNumbersIn(t, "c", 7)).toEqual([1, 2, 16_000]);
    expect(barrenNumbersIn(t, "c", big)).toEqual(forty);
    expect(barrenNumbersIn(t, "h", 1)).toHaveLength(9);
    expect(barrenNumbersIn(t, "c", 6)).toEqual([]);
    const v1 = parseBarrenTable(encode({ c: [[5, 2]] }, { builtAt: "old" }, 1));
    expect(barrenIn(v1, "c", 5)).toBe(2);
    expect(barrenNumbersIn(v1, "c", 5)).toEqual([]);
  });

  it("refuses a wrong magic, another version, a truncated file and a count past the end", () => {
    const wrong = Buffer.from(buf);
    wrong.write("NOTBARRN", 0, "latin1");
    expect(() => parseBarrenTable(wrong)).toThrow(/not a boxel-barren file/);
    const v3 = Buffer.from(buf);
    v3.writeUInt32LE(3, 8);
    expect(() => parseBarrenTable(v3)).toThrow(/version 3/);
    expect(() => parseBarrenTable(buf.subarray(0, buf.length - 3))).toThrow(/truncated|past the end/);
    const over = Buffer.from(buf);
    const metaLen = over.readUInt32LE(12);
    over.writeUInt32LE(1e9, 16 + metaLen + 4 + 4);
    expect(() => parseBarrenTable(over)).toThrow(/past the end/);
  });
});

describe("boxel-barren: the shipped table", () => {
  const t = loadBarrenTable(root)!;

  it("has mass codes c to h, ids in order and every count at least the builder's minimum", () => {
    expect(t).not.toBeNull();
    expect(t.meta.recentFrom).toBe("2025");
    for (const code of ["c", "d", "e", "f", "g", "h"] as MassCode[]) {
      const e = t.byCode.get(code)!;
      expect(e.ids.length, code).toBeGreaterThan(1000);
      for (let i = 1; i < e.ids.length; i++)
        if (!(e.ids[i]! > e.ids[i - 1]!)) throw new Error(`${code}: ids out of order at ${i}`);
      const min = code === "c" || code === "d" ? 2 : 1;
      expect(Math.min(...e.counts.subarray(0, 50_000)), code).toBeGreaterThanOrEqual(min);
    }
  });

  it("finds the bubble flown: over a hundred d boxels within 300 ly of Swoilz hold barren systems", () => {
    // Not Sol: the space round it is hand-named sectors, whose boxels are not the planner's and are left out.
    const swoilz = { x: 137, y: -89, z: 298 };
    const e = t.byCode.get("d")!;
    const size = boxelCubeLy("d");
    let near = 0;
    for (const id of e.ids) {
      const gz = Math.floor(id / 268435456);
      const gy = Math.floor((id - gz * 268435456) / 16384);
      const gx = id - gz * 268435456 - gy * 16384;
      const c = {
        x: SECTOR_ORIGIN.x + (gx + 0.5) * size,
        y: SECTOR_ORIGIN.y + (gy + 0.5) * size,
        z: SECTOR_ORIGIN.z + (gz + 0.5) * size,
      };
      if (Math.hypot(c.x - swoilz.x, c.y - swoilz.y, c.z - swoilz.z) < 300) near++;
    }
    expect(near).toBeGreaterThan(100);
    // And a look-up by position lands on the same key the builder wrote.
    const id = e.ids[Math.floor(e.ids.length / 2)]!;
    const gz = Math.floor(id / 268435456);
    const gy = Math.floor((id - gz * 268435456) / 16384);
    const gx = id - gz * 268435456 - gy * 16384;
    const p = {
      x: SECTOR_ORIGIN.x + (gx + 0.5) * size,
      y: SECTOR_ORIGIN.y + (gy + 0.5) * size,
      z: SECTOR_ORIGIN.z + (gz + 0.5) * size,
    };
    expect(gridIdAt("d", p)).toBe(id);
    expect(barrenIn(t, "d", gridIdAt("d", p))).toBeGreaterThan(0);
    // Its systems' numbers, one per barren system, ascending.
    const nums = barrenNumbersIn(t, "d", id);
    expect(nums).toHaveLength(barrenIn(t, "d", id));
    expect([...nums].sort((x, y) => x - y)).toEqual(nums);
  });
});
