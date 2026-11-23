/**
 * The "GGG ladder" drawer of the system map's body panel (src/client/GggLadderDrawer.tsx): what it says
 * about a giant on a border, in a nudge range and out of one (2026-11-22: the chance the nudge left a
 * giant alone, and no near misses).
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GggLadderDrawer } from "../src/client/GggLadderDrawer.js";
import type { SystemMapBodyDetailDTO } from "../src/shared/types.js";

const C1 = "Sudarsky class I gas giant";
const drawer = (planetClass: string, surfaceTemperature: number, massEM: number, radius: number) =>
  renderToStaticMarkup(
    createElement(GggLadderDrawer, {
      detail: { planetClass, surfaceTemperature, massEM, radius } as SystemMapBodyDetailDTO,
    }),
  );

describe("GGG ladder drawer", () => {
  it("a giant that cannot be nudged, on a border: green by the ladder", () => {
    // Pheia Aewsy LV-Y d11 B 4 (catalogue #26).
    const html = drawer(C1, 126.062111, 212.034698, 67_972_136);
    expect(html).toContain("Layer 6 lands on the 250 K border: green by the ladder.");
    expect(html).toContain("Outside the nudge range (100–122.22 K): the ladder reads this temperature as it is.");
    expect(html).toContain("on the 250 K border");
  });

  it("a cold giant in its maybe range, on a border: green if the nudge left it alone, with the chance", () => {
    // Synookio EI-J d9-1 7 (catalogue #19): a float step off by the page's rule, exact by the app's.
    const html = drawer(C1, 119.986717, 21.216078, 20_795_606);
    expect(html).toContain(
      "Layer 6 lands on the 270 K border: green by the ladder, if the nudge left it alone (90 % chance).",
    );
    expect(html).toContain("Between 100 and 122.22 K the game may nudge the temperature first");
    expect(html).toContain("on the 270 K border");
  });

  it("a layer next to a border is not green; an always-nudged giant gets no verdict", () => {
    // Leami SL-W c18-375 8: half a float step short, not green.
    const leami = drawer("Gas giant with ammonia based life", 119.724983, 346.083435, 70_950_224);
    expect(leami).toContain("No layer lands on a border: not green by the ladder.");
    expect(leami).not.toContain("ggg-ladder__rung--hit");
    const ii = drawer("Sudarsky class II gas giant", 217.87532, 300, 70_000_000);
    expect(ii).toContain("No verdict: always nudged at this temperature.");
    expect(ii).toContain("Below 250 K the game always nudges");
  });
});
