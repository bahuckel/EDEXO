/**
 * The shortest boxel order (owner, 2026-11-04: "go from g20 > g121 > g96 > g67 and so on from the same boxel, as the
 * routes are shortest that way, instead of going numerically up"): shared/boxelOrder.ts, the boxel run following it,
 * and Spansh's look-up keeping each system's position.
 */
import { describe, expect, it } from "vitest";
import { shortestBoxelOrder, type Vec3 } from "../src/shared/boxelOrder.js";
import { createBoxelRun } from "../src/server/boxelRun.js";
import { createSavedBoxels } from "../src/server/savedBoxels.js";
import { spanshSearchSystemFacts } from "../src/server/boxelLookup.js";

// His Eembaids EG-Y boxel, g0 to g21: the positions his plotted routes gave (2026-11-04), rounded.
const EG: Record<number, Vec3> = {
  0: [5255, 360, 30443], 1: [5435, 478, 30857], 2: [5303, 74, 30443], 3: [5633, 135, 30447], 4: [5610, 321, 30561],
  5: [5442, 426, 30307], 6: [5314, 495, 30521], 7: [5567, 487, 30483], 8: [5165, 559, 30906], 9: [5062, 323, 30467],
  10: [5216, 16, 30559], 11: [5502, 280, 30661], 12: [5272, 509, 30743], 13: [5242, 331, 30400], 14: [5206, 232, 30405],
  15: [5586, 165, 30674], 16: [5113, 299, 30690], 17: [5459, 498, 30851], 18: [5354, 531, 30862], 19: [5341, 614, 30826],
  20: [5176, 277, 30817], 21: [5593, 496, 30801],
};
const pos = new Map(Object.entries(EG).map(([k, v]) => [Number(k), v] as const));
const all = [...pos.keys()];

describe("the shortest boxel order", () => {
  it("on his boxel is about half the light years of flying by number", () => {
    const o = shortestBoxelOrder(all, pos, EG[0]!);
    expect(o.numericLy).toBeGreaterThan(7000);
    expect(o.orderLy).toBeLessThan(o.numericLy * 0.6);
    expect([...o.order].sort((a, b) => a - b)).toEqual(all);
    expect(o.placed).toBe(all.length);
  });

  it("starts with the system nearest to him, and the legs add up to the total", () => {
    const here: Vec3 = [5600, 300, 30560]; // beside g4
    const o = shortestBoxelOrder(all, pos, here);
    expect(o.order[0]).toBe(4);
    expect(Math.abs(o.legs.reduce((s: number, l) => s + (l ?? 0), 0) - o.orderLy)).toBeLessThanOrEqual(all.length);
  });

  it("orders a whole g boxel's systems quickly, each once", () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 640;
    const big = new Map<number, Vec3>();
    for (let n = 0; n < 1500; n++) big.set(n, [rnd(), rnd(), rnd()]);
    const t = performance.now();
    const o = shortestBoxelOrder([...big.keys()], big, [0, 0, 0]);
    expect(performance.now() - t).toBeLessThan(2000); // was 1.9 s for 2,000 with the full 2-opt; ~0.15 s now
    expect(new Set(o.order).size).toBe(1500);
    expect(o.orderLy).toBeLessThan(o.numericLy * 0.15);
    expect(shortestBoxelOrder([...big.keys()], big, [0, 0, 0])).toBe(o); // asked again: the same answer, not worked out again
  });

  it("gives two boxels with the same numbers left their own order, and is never longer than by number", () => {
    const a = new Map<number, Vec3>([[0, [0, 0, 0]], [1, [100, 0, 0]], [2, [10, 0, 0]]]);
    const b = new Map<number, Vec3>([[0, [0, 0, 0]], [1, [10, 0, 0]], [2, [100, 0, 0]]]);
    expect(shortestBoxelOrder([0, 1, 2], a, [0, 0, 0]).order).toEqual([0, 2, 1]);
    expect(shortestBoxelOrder([0, 1, 2], b, [0, 0, 0]).order).toEqual([0, 1, 2]);
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 640;
    for (let k = 0; k < 2000; k++) {
      const n = 2 + (k % 11);
      const p = new Map<number, Vec3>();
      for (let i = 0; i < n; i++) p.set(i, [rnd(), rnd(), rnd()]);
      const o = shortestBoxelOrder([...p.keys()], p, [rnd(), rnd(), rnd()]);
      expect(o.orderLy).toBeLessThanOrEqual(o.numericLy);
    }
  });

  it("puts systems with no position after the placed ones, by number", () => {
    const o = shortestBoxelOrder([3, 40, 7, 25, 13], pos, null);
    expect(o.order.slice(3)).toEqual([40, 25].sort((a, b) => a - b));
    expect(o.legs.slice(3)).toEqual([null, null]);
    expect(o.placed).toBe(3);
  });
});

describe("a boxel run in the shortest order", () => {
  function setup() {
    const saved = createSavedBoxels({ filePath: null });
    let current: string | null = "Eembaids EG-Y g0";
    const visited = ["Eembaids EG-Y g0"];
    const copied: string[] = [];
    const run = createBoxelRun({
      saved,
      visited: () => visited,
      sightings: () => [],
      currentSystem: () => current,
      deliver: (n) => copied.push(n),
      positions: () => pos,
      here: () => EG[0]!,
    });
    const { id } = saved.add("Eembaids EG-Y g21")!;
    return { saved, run, id, copied, jump: (n: number) => (visited.push(`Eembaids EG-Y g${n}`), (current = `Eembaids EG-Y g${n}`)) };
  }

  it("copies by number until switched on, then the nearest first and steps along the order", () => {
    const t = setup();
    expect(t.run.copyNext()).toBe("Eembaids EG-Y g1");
    t.saved.setShortest(t.id, true);
    const want = shortestBoxelOrder(all.filter((n) => n !== 0), pos, EG[0]!).order;
    expect(t.run.copyNext()).toBe(`Eembaids EG-Y g${want[0]}`);
    expect(t.run.step(1)).toBe(`Eembaids EG-Y g${want[1]}`);
    expect(t.run.step(1)).toBe(`Eembaids EG-Y g${want[2]}`);
    expect(t.run.step(-1)).toBe(`Eembaids EG-Y g${want[1]}`);
    expect(t.saved.remaining(t.id, [], [], null)!.shortest).toBe(true);
    t.saved.setShortest(t.id, false);
    expect(t.run.copyNext()).toBe("Eembaids EG-Y g1");
  });

  it("with no position known, takes the next in line as before, not the lowest number (review 2026-11-05)", () => {
    const saved = createSavedBoxels({ filePath: null });
    const { id } = saved.add("Eembaids EG-Y g21")!;
    saved.setShortest(id, true);
    const run = createBoxelRun({
      saved,
      visited: () => ["Eembaids EG-Y g5"],
      sightings: () => [],
      currentSystem: () => "Eembaids EG-Y g5",
      deliver: () => {},
      positions: () => new Map(),
      here: () => null,
    });
    expect(run.copyNext()).toBe("Eembaids EG-Y g6");
  });
});

describe("Spansh's look-up", () => {
  it("keeps where each system is", () => {
    const f = spanshSearchSystemFacts({ name: "Eembaids EG-Y g22", x: 5459.4, y: 95.1, z: 30748.2, bodies: [] }, () => false);
    expect(f?.pos).toEqual([5459.4, 95.1, 30748.2]);
    expect(spanshSearchSystemFacts({ name: "x", bodies: [] }, () => false)?.pos).toBeUndefined();
  });
});
