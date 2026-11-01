/**
 * Chained HUDs (owner, 2026-11-01): the group page, its key, and which HUDs touch (electron/hudGeometry.cjs).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const g = require("../electron/hudGeometry.cjs") as {
  hudSlotKey: (p: string) => string;
  hudSectionsOf: (p: string) => string[];
  hudGroupOf: (p: string) => number | null;
  hudGroupPath: (s: string[], g: number) => string;
  hudChainOffers: (r: { key: string; x: number; y: number; width: number; height: number }[]) => Record<string, { below: string | null; right: string | null }>;
  HUD_SECTION_BY_PATH: Record<string, string>;
};

describe("the group page", () => {
  it("keys each group apart, and the whole merged panel as before", () => {
    expect(g.hudSlotKey("/hud-overlay.html?s=jump,fss&g=2")).toBe("/hud-overlay.html?g=2");
    expect(g.hudSlotKey("/hud-overlay.html?s=jump,fss")).toBe("/hud-overlay.html");
    expect(g.hudSlotKey("/jump-overlay.html")).toBe("/jump-overlay.html");
    expect(g.hudGroupPath(["jump", "fss"], 3)).toBe("/hud-overlay.html?s=jump,fss&g=3");
    expect(g.hudGroupOf("/hud-overlay.html?s=jump,fss&g=3")).toBe(3);
    expect(g.hudGroupOf("/hud-overlay.html?s=jump")).toBeNull();
  });

  it("reads a window's sections, a separate page or a merged one", () => {
    expect(g.hudSectionsOf("/fss-scan-overlay.html")).toEqual(["fss"]);
    expect(g.hudSectionsOf("/hud-overlay.html?s=jump,fss&g=1")).toEqual(["jump", "fss"]);
    expect(g.hudSectionsOf("/hud-overlay.html")).toHaveLength(Object.keys(g.HUD_SECTION_BY_PATH).length);
  });

  it("has the launcher's section table", () => {
    const src = readFileSync("src/client/launcher/hudOverlays.js", "utf8");
    const block = /HUD_SECTION_BY_PATH = \{([^}]*)\}/.exec(src)![1]!;
    const launcher = Object.fromEntries([...block.matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
    expect(g.HUD_SECTION_BY_PATH).toEqual(launcher);
  });
});

describe("which HUDs touch", () => {
  const r = (key: string, x: number, y: number, height = 100, width = 404) => ({ key, x, y, width, height });

  it("a stack: each one the next below, within the gap", () => {
    const o = g.hudChainOffers([r("a", 100, 100), r("b", 100, 206), r("c", 100, 600)]);
    expect(o.a).toEqual({ below: "b", right: null });
    expect(o.b).toEqual({ below: null, right: null });
  });

  it("side by side on the same screen, and none across a wide gap or a small overlap", () => {
    const o = g.hudChainOffers([r("a", 100, 100), r("b", 510, 120), r("c", 100, 230, 100, 404), r("d", 400, 230 + 106)]);
    expect(o.a!.right).toBe("b");
    // c and d overlap by a quarter of a width: not one above the other.
    expect(o.c!.below).toBeNull();
    expect(g.hudChainOffers([r("a", 100, 100), r("b", 100, 300)]).a!.below).toBeNull();
  });
});
