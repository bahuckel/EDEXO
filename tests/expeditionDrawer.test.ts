/**
 * The expedition drawer's pieces (plan 2.5, 2026-10-11): boxels coloured by rank from dim to bright, sized by
 * the systems they hold, the hover card's words, and the drawer with no position yet.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExpeditionDrawer, crShort, expeditionColours, expeditionSize, expeditionTip } from "../src/client/ExpeditionDrawer.js";
import type { ExpeditionBoxelDTO, ExpeditionFieldDTO } from "../src/shared/dto/expedition.js";

const boxel = (key: string, evPerJump: number, over: Partial<ExpeditionBoxelDTO> = {}): ExpeditionBoxelDTO => ({
  key, code: "d", name: `Swoilz ${key} d4`, mixed: false, center: { x: 0, y: 0, z: 0 }, cubeLy: 80, distanceLy: 120, region: "Inner Orion Spur",
  systems: 300, pBio: 0.075, recorded: 2, visited: 0, ev: evPerJump * 300, jumps: 302, evPerJump, topGenera: [{ genus: "Stratum", share: 0.3 }], ...over,
});
const field = (boxels: ExpeditionBoxelDTO[], species: string | null = null): ExpeditionFieldDTO => ({
  from: { x: 0, y: 0, z: 0 }, radiusLy: 500, jumpRangeLy: 60, scored: boxels.length, skipped: [], species, rule: null, boxels, builtAt: "2026-10-11",
});

describe("expedition drawer", () => {
  it("colours by rank: the best boxel brightest, the worst dimmest", () => {
    const c = expeditionColours(field([boxel("a", 1e6), boxel("b", 9e6), boxel("c", 4e6)]));
    const lum = (k: string) => c.get(k)!.reduce((x, y) => x + y, 0);
    expect(lum("b")).toBeGreaterThan(lum("c"));
    expect(lum("c")).toBeGreaterThan(lum("a"));
    // Species mode ranks by bodies per jump instead.
    const s = expeditionColours(field([boxel("a", 9e6, { speciesBodies: 1 }), boxel("b", 1e6, { speciesBodies: 50 })], "x"));
    expect(s.get("b")![0]).toBeGreaterThan(s.get("a")![0]);
  });

  it("sizes by systems, within 5 to 13 px", () => {
    expect(expeditionSize(boxel("a", 1, { systems: 1 }))).toBe(5);
    expect(expeditionSize(boxel("a", 1, { systems: 3000 }))).toBeLessThanOrEqual(13);
    expect(expeditionSize(boxel("a", 1, { systems: 3000 }))).toBeGreaterThan(expeditionSize(boxel("a", 1, { systems: 20 })));
  });

  it("says what a boxel holds on hover, and the commander's own systems when he has been", () => {
    const t = expeditionTip(boxel("a", 7.9e6, { visited: 12 }), false);
    expect(t.title).toBe("Swoilz a d4");
    expect(t.line).toContain("7.9 M CR per jump");
    expect(t.note).toContain("12 yours");
    expect(expeditionTip(boxel("a", 1, { name: null }), false).title).toBe("d boxel (unnamed sector)");
    expect(crShort(2.89e9)).toBe("2.9 B");
  });

  it("asks for a position when there is none", () => {
    const html = renderToStaticMarkup(
      createElement(ExpeditionDrawer, {
        ship: null, selected: null, field: null, setField: () => {}, planKeys: [], setPlanKeys: () => {}, plan: null, setPlan: () => {}, onFocus: () => {},
      }),
    );
    expect(html).toContain("No position yet");
  });
});
