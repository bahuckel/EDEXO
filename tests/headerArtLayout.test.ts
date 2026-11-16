/**
 * @vitest-environment jsdom
 * The header artwork's layout rules (src/client/headerArt): the land never rises into a block of the header, a sky
 * subject is aimed at empty space, what lies over the header (a menu, the Notices list) is not layout, the sky's
 * noise repeats without a seam, and any accent gives real colours.
 */
import { describe, expect, it } from "vitest";
import { drawnRects, envelope, freeRect, type Layout, type Rect } from "../src/client/headerArt/layout";
import { fbmP, palette, rng } from "../src/client/headerArt/maths";

/** A header of random size with random blocks in it, the same for the same seed. */
function randomLayout(seed: number): Layout {
  const r = rng(seed);
  const w = 350 + Math.round(r() * 1500);
  const h = 130 + Math.round(r() * 350);
  const taken: Rect[] = [];
  for (let i = 0, n = 1 + Math.floor(r() * 9); i < n; i++) {
    const l = r() * w * 0.9;
    const t = r() * h * 0.9;
    taken.push([l, t, Math.min(w, l + 20 + r() * w * 0.5), Math.min(h - 4, t + 14 + r() * 60)]);
  }
  return { w, h, taken };
}

describe("the land's height under the header's blocks (envelope)", () => {
  it("never rises into a block, whatever the blocks", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const L = randomLayout(seed);
      const { env } = envelope(L);
      for (const [l, , r, b] of L.taken) {
        const room = Math.max(3, L.h - b - 5);
        for (let x = Math.max(0, Math.ceil(l)); x <= Math.min(env.length - 1, Math.floor(r)); x++) {
          expect(env[x]!, `seed ${seed}, column ${x}`).toBeLessThanOrEqual(room + 1e-3);
        }
      }
    }
  });

  it("climbs to its full height where the header is empty, and stays a thin line under a full-width block", () => {
    const free = envelope({ w: 1200, h: 200, taken: [] });
    expect(Math.min(...free.env)).toBeCloseTo(free.cap, 3);
    const full = envelope({ w: 1200, h: 200, taken: [[0, 150, 1200, 192]] });
    expect(Math.max(...full.env)).toBeLessThanOrEqual(3 + 1e-3);
  });

  it("rises as a slope where a block ends, not as a step: under two pixels a column", () => {
    const { env, cap } = envelope({ w: 1500, h: 235, taken: [[0, 160, 1070, 213]] });
    let steepest = 0;
    for (let x = 1; x < env.length; x++) steepest = Math.max(steepest, Math.abs(env[x]! - env[x - 1]!));
    // Smoothed twice over 57 columns, a rise of the whole height (about 100 px here) is at most 1.8 a column.
    expect(cap).toBeGreaterThan(90);
    expect(steepest).toBeLessThan(2);
  });
});

describe("where a sky subject is aimed (freeRect)", () => {
  it("overlaps no block, whatever the blocks", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const L = randomLayout(seed);
      const fr = freeRect(L, envelope(L).env);
      if (!fr) continue;
      for (const [l, t, r, b] of L.taken) {
        const apart = fr.x >= r || fr.x + fr.w <= l || fr.y >= b || fr.y + fr.h <= t;
        expect(apart, `seed ${seed}`).toBe(true);
      }
      expect(fr.x).toBeGreaterThanOrEqual(0);
      expect(fr.x + fr.w).toBeLessThanOrEqual(L.w);
    }
  });

  it("finds nothing in a header that is all content", () => {
    const L: Layout = { w: 800, h: 200, taken: [[0, 0, 800, 200]] };
    expect(freeRect(L, envelope(L).env)).toBeNull();
  });
});

describe("what counts as the header's content (drawnRects)", () => {
  const box = (l: number, t: number, w: number, h: number) =>
    ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t, toJSON: () => ({}) }) as DOMRect;
  const el = (style: string, rect: DOMRect): HTMLElement => {
    const e = document.createElement("div");
    e.setAttribute("style", style);
    e.getBoundingClientRect = () => rect;
    return e;
  };

  it("takes a card in the header, and passes over a list laid over it and everything inside", () => {
    const host = el("", box(0, 0, 1000, 200));
    const art = document.createElement("div");
    const card = el("border: 1px solid red", box(20, 150, 300, 40));
    // The Notices list: laid over the header, with rows of its own.
    const list = el("position: absolute; border: 1px solid red", box(600, 40, 380, 400));
    const row = el("border: 1px solid red", box(610, 50, 360, 30));
    list.append(row);
    // A dialog's backdrop is fixed, not laid out either.
    const backdrop = el("position: fixed; border: 1px solid red", box(0, 0, 1000, 200));
    host.append(art, card, list, backdrop);
    document.body.append(host);
    const rects = drawnRects(host, art);
    host.remove();
    expect(rects).toEqual([[20, 150, 320, 190]]);
  });

  it("is the same with the list open and closed, so opening it does not move the picture", () => {
    const host = el("", box(0, 0, 1000, 200));
    const art = document.createElement("div");
    host.append(art, el("border: 1px solid red", box(20, 20, 200, 30)));
    document.body.append(host);
    const closed = drawnRects(host, art);
    const list = el("position: absolute", box(600, 40, 380, 400));
    list.append(el("border: 1px solid red", box(610, 50, 360, 30)));
    host.append(list);
    const open = drawnRects(host, art);
    host.remove();
    expect(open).toEqual(closed);
  });
});

describe("the sky's noise and colours", () => {
  it("repeats after one picture width and one picture height: no seam", () => {
    const r = rng(11);
    for (let i = 0; i < 200; i++) {
      const u = r();
      const v = r();
      const here = fbmP(u, v, 42, 19, 2, 5);
      expect(fbmP(u + 1, v, 42, 19, 2, 5)).toBeCloseTo(here, 9);
      expect(fbmP(u, v + 1, 42, 19, 2, 5)).toBeCloseTo(here, 9);
      expect(fbmP(u - 1, v - 1, 42, 19, 2, 5)).toBeCloseTo(here, 9);
      expect(here).toBeGreaterThanOrEqual(0);
      expect(here).toBeLessThanOrEqual(1);
    }
  });

  it("draws the same picture for the same seed", () => {
    const a = rng(7);
    const b = rng(7);
    const c = rng(8);
    const seqA = Array.from({ length: 20 }, () => a());
    expect(Array.from({ length: 20 }, () => b())).toEqual(seqA);
    expect(Array.from({ length: 20 }, () => c())).not.toEqual(seqA);
  });

  it("gives real colours for any accent: a grey, black, white, a broken value", () => {
    for (const accent of ["205, 212, 224", "128, 128, 128", "0, 0, 0", "255, 255, 255", "", "x, y"]) {
      const pal = palette(accent);
      for (const [dh, sm, l] of [[0, 1, 0.5], [-24, 0.85, 0.4], [170, 0.45, 0.86], [400, 2, 0.03]] as const) {
        const c = pal.raw(dh, sm, l);
        for (const ch of c) {
          expect(Number.isFinite(ch), accent).toBe(true);
          expect(ch).toBeGreaterThanOrEqual(-1e-9);
          expect(ch).toBeLessThanOrEqual(255 + 1e-9);
        }
        expect(pal.c(dh, sm, l, 0.5)).toMatch(/^rgba\(\d+,\d+,\d+,0\.5\)$/);
      }
    }
  });

  it("keeps the accent's hue and follows it when the scheme changes", () => {
    const orange = palette("255, 138, 31").raw(0, 1, 0.5);
    const blue = palette("72, 150, 255").raw(0, 1, 0.5);
    expect(orange[0]).toBeGreaterThan(orange[2]);
    expect(blue[2]).toBeGreaterThan(blue[0]);
    // Silver has almost no colour: the picture stays near grey.
    const silver = palette("205, 212, 224").raw(0, 1, 0.5);
    expect(Math.max(...silver) - Math.min(...silver)).toBeLessThan(60);
  });
});
