/**
 * The header artwork's facts that need no canvas (src/client/headerArt): every genus has a plant shape, the land
 * follows the body's kind, the plants are the body's genera with the likeliest in the middle, and the turning sky's
 * subjects pass where they are aimed, climb as they go, and come round after one turn.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { landModel, landStyleOf, plantSpots } from "../src/client/headerArt/land";
import type { Layout } from "../src/client/headerArt/layout";
import { landCap, rng, seedOf } from "../src/client/headerArt/maths";
import { GENUS_PLANT, PLANT, PLANT_H, plantsOfGenera } from "../src/client/headerArt/plants";
import { ROTATION_S, skyGeometry, skyPlace, subjectOnScreen } from "../src/client/headerArt/sky";

const SIZES: [number, number, number][] = [
  [1558, 207, 2],
  [1816, 135, 1],
  [1058, 265, 1.25],
  [348, 585, 3],
];

describe("the plants are the body's genera", () => {
  it("has a shape for every genus folder under data/species", () => {
    const dirs = readdirSync(path.join(import.meta.dirname, "..", "data", "species"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(dirs.length).toBeGreaterThanOrEqual(25);
    const missing = dirs.filter((d) => !GENUS_PLANT[d]);
    expect(missing, "add a shape in headerArt/plants.ts and name it in GENUS_PLANT").toEqual([]);
    for (const kind of Object.values(GENUS_PLANT)) {
      expect(typeof PLANT[kind], kind).toBe("function");
      expect(PLANT_H[kind], kind).toBeGreaterThan(0);
    }
  });

  it("keeps the genera's order, each once, and leaves out what it does not know", () => {
    expect(plantsOfGenera(["tussock", "bacterium", "tussock", "brain-tree", "not-a-genus", " Stratum "])).toEqual(["tussock", "bacterium", "brain", "stratum"]);
    expect(plantsOfGenera([])).toEqual([]);
  });

  const wide: Layout = { w: 1558, h: 207, taken: [[20, 20, 1540, 60], [20, 180, 1340, 200]] };

  it("stands the likeliest genus in the middle, with the rings, and the others round it in turn", () => {
    const lm = landModel(wide, 7);
    expect(lm.hasPeak).toBe(true);
    const { spots, hero } = plantSpots(lm, ["stratum", "bacterium", "tussock"], rng(3));
    expect(spots.length).toBeGreaterThan(2);
    expect(hero?.k).toBe("stratum");
    const nearest = [...spots].sort((a, b) => Math.abs(a.x - lm.pkC) - Math.abs(b.x - lm.pkC))[0]!;
    expect(nearest).toBe(hero);
    expect(new Set(spots.map((s) => s.k))).toEqual(new Set(["stratum", "bacterium", "tussock"]));
    for (const s of spots) {
      expect(s.x).toBeGreaterThan(lm.pk0);
      expect(s.x).toBeLessThan(lm.pk1);
      // A plant is no taller than the room above the ground at its place.
      expect(s.s * PLANT_H[s.k]).toBeLessThanOrEqual(lm.E(s.x) - lm.hNear(s.x) + 1e-6);
    }
  });

  it("leaves the ground bare for a body without biology, and where the header has no free part", () => {
    expect(plantSpots(landModel(wide, 7), [], rng(3))).toEqual({ spots: [], hero: null });
    const full: Layout = { w: 1058, h: 265, taken: [[0, 0, 1058, 262]] };
    expect(plantSpots(landModel(full, 7), ["tussock"], rng(3)).spots).toEqual([]);
  });

  it("draws the same line-up for the same seed and another for another body", () => {
    const lm = landModel(wide, 7);
    const a = plantSpots(lm, ["tussock", "fungoida"], rng(seedOf("Sol|1")));
    const b = plantSpots(lm, ["tussock", "fungoida"], rng(seedOf("Sol|1")));
    const c = plantSpots(lm, ["tussock", "fungoida"], rng(seedOf("Sol|2")));
    expect(b.spots).toEqual(a.spots);
    expect(c.spots).not.toEqual(a.spots);
  });
});

describe("the land follows the body and the system", () => {
  it("reads the journal's planet classes", () => {
    expect(landStyleOf("Icy body")).toBe("icy");
    expect(landStyleOf("Rocky ice body")).toBe("icy");
    expect(landStyleOf("High metal content body")).toBe("metal");
    expect(landStyleOf("Metal rich body")).toBe("metal");
    expect(landStyleOf("Rocky body")).toBe("rocky");
    expect(landStyleOf("Sudarsky class I gas giant")).toBe("plain");
    expect(landStyleOf(null)).toBe("plain");
    expect(landStyleOf(undefined)).toBe("plain");
  });

  const open: Layout = { w: 1200, h: 220, taken: [] };
  const profile = (seed: number, style: Parameters<typeof landModel>[2]) => {
    const lm = landModel(open, seed, style);
    return Array.from({ length: 60 }, (_, i) => Math.round(lm.hFar(i * 20) * 10) / 10);
  };

  it("gives every system its own skyline, the same on every visit", () => {
    const sol = seedOf("Sol");
    expect(seedOf("Sol")).toBe(sol);
    expect(seedOf("Achenar")).not.toBe(sol);
    expect(seedOf(null)).toBe(seedOf(""));
    for (const name of ["Sol", "Achenar", "Skaudao CY-G b43-10", ""]) {
      expect(seedOf(name)).toBeGreaterThanOrEqual(1);
      expect(seedOf(name)).toBeLessThanOrEqual(65536);
    }
    expect(profile(sol, "plain")).toEqual(profile(sol, "plain"));
    expect(profile(seedOf("Achenar"), "plain")).not.toEqual(profile(sol, "plain"));
  });

  it("builds an icy, a rocky and a metal-rich body differently from the plain land, within the land's height", () => {
    const plain = profile(7, "plain");
    expect(profile(7, "icy")).not.toEqual(plain);
    expect(profile(7, "metal")).not.toEqual(plain);
    const rocky = landModel(open, 7, "rocky");
    const base = landModel(open, 7, "plain");
    expect(Array.from({ length: 60 }, (_, i) => rocky.hMid(i * 20))).not.toEqual(Array.from({ length: 60 }, (_, i) => base.hMid(i * 20)));
    for (const style of ["plain", "icy", "rocky", "metal"] as const) {
      const lm = landModel(open, 7, style);
      for (let x = 0; x <= open.w; x += 7) {
        for (const fn of [lm.hFar2, lm.hFar, lm.hMid, lm.hNear]) {
          expect(fn(x), style).toBeGreaterThan(0);
          expect(fn(x), style).toBeLessThanOrEqual(lm.cap * 1.08 + 1e-6);
        }
      }
    }
  });

  it("is a low line everywhere for the calm picture", () => {
    const lm = landModel(open, 7, "plain", true);
    expect(lm.cap).toBe(5);
    expect(lm.hasPeak).toBe(false);
  });
});

describe("the turning sky", () => {
  it("turns once in 30 minutes", () => {
    expect(ROTATION_S).toBe(1800);
  });

  it.each(SIZES)("passes each subject through its aim, header %i × %i at %f×", (w, h, dpr) => {
    const g = skyGeometry(w, h, dpr);
    for (const subject of [g.giant, g.sun, g.moons]) {
      // The turn at which this subject is over its aim's x.
      const turn = ((((subject.aim[0] - subject.x) / g.P - g.start) % 1) + 1) % 1;
      const copies = subjectOnScreen(g, subject, turn);
      const hit = copies.some((p) => Math.abs(p.x - subject.aim[0]) < 1e-6 && Math.abs(p.y - subject.aim[1]) < 1e-6);
      expect(hit, JSON.stringify(copies)).toBe(true);
    }
    // The giant is at its aim when the clock starts, and every aim is inside the header.
    expect(subjectOnScreen(g, g.giant, 0).some((p) => Math.abs(p.x - g.giant.aim[0]) < 1e-6)).toBe(true);
    for (const subject of [g.giant, g.sun, g.moons]) {
      expect(subject.aim[0]).toBeGreaterThan(0);
      expect(subject.aim[0]).toBeLessThan(w);
      expect(subject.aim[1]).toBeGreaterThan(0);
      expect(subject.aim[1]).toBeLessThan(h);
    }
    // The star comes up inside the land's height: it rises out of the far range, not out of open sky.
    expect(g.sun.aim[1]).toBeGreaterThan(h - landCap(h));
  });

  it.each(SIZES)("comes round after one turn and never jumps, header %i × %i at %f×", (w, h, dpr) => {
    const g = skyGeometry(w, h, dpr);
    const r = rng(w + h);
    for (let i = 0; i < 50; i++) {
      const t = r();
      const a = skyPlace(g, t);
      const b = skyPlace(g, t + 1);
      expect(b.s).toBeCloseTo(a.s, 6);
      expect(b.y0).toBeCloseTo(a.y0, 6);
      expect(a.s).toBeGreaterThanOrEqual(0);
      expect(a.s).toBeLessThan(g.P);
      expect(a.y0).toBeLessThanOrEqual(0);
      expect(a.y0).toBeGreaterThan(-g.Hp);
      // A second later a point of the sky is where it was, a little to the right and a little higher (in one of its copies).
      const dt = 1 / ROTATION_S;
      const before = subjectOnScreen(g, g.giant, t);
      const after = subjectOnScreen(g, g.giant, t + dt);
      const dx = g.P * dt;
      const dy = -g.Hp * dt;
      const carriedOn = before.some((p) => after.some((q) => Math.abs(q.x - p.x - dx) < 1e-6 && Math.abs(q.y - p.y - dy) < 1e-6));
      expect(carriedOn).toBe(true);
    }
  });

  it.each(SIZES)("is longer than the header, taller than it, and never over 7 M pixels unless at 1×, header %i × %i at %f×", (w, h, dpr) => {
    const g = skyGeometry(w, h, dpr);
    expect(g.P).toBeGreaterThanOrEqual(w * 3);
    expect(g.Hp).toBeGreaterThan(h);
    expect(g.slope).toBeCloseTo(g.Hp / g.P, 12);
    expect(g.scale).toBeLessThanOrEqual(dpr);
    expect(g.scale).toBeGreaterThanOrEqual(1);
    if (g.scale > 1) expect(g.P * g.Hp * g.scale * g.scale).toBeLessThanOrEqual(7e6);
    // The subjects are spread round the turn, not bunched.
    const xs = [g.sun.x, g.giant.x, g.moons.x].map((x) => x / g.P).sort((a, b) => a - b);
    expect(xs[1]! - xs[0]!).toBeGreaterThan(0.2);
    expect(xs[2]! - xs[1]!).toBeGreaterThan(0.2);
  });

  it("does not depend on the header's blocks: the same size gives the same sky", () => {
    expect(skyGeometry(1558, 207, 2)).toEqual(skyGeometry(1558, 207, 2));
    expect(skyGeometry(1558, 207, 2).start).not.toBe(skyGeometry(1058, 207, 2).start);
  });
});
