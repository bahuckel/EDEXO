/**
 * @vitest-environment jsdom
 *
 * The body card's materials field (owner, 2026-10-15: "a lot of them are cut out and don't fit. Lets just make it say
 * 'Mats' and just the periodic table/abbreviations no percentages (just in that specific location)").
 */
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { JumponiumFact } from "../src/client/JumponiumFact";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A Scan's Materials list, as the journal writes it. */
function render(pct: Record<string, number>): HTMLElement {
  const materials = Object.entries(pct).map(([Name, Percent]) => ({ Name, Percent }));
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(<JumponiumFact materials={materials} stock={null} />));
  return host;
}

describe("the body card's Mats field", () => {
  it("names the field Mats and lists symbols only, rich ones first, no percentages", () => {
    // Polonium 1.12 % and yttrium 2.3 % are in the top tenth; germanium 3 % is not; carbon is everywhere.
    const host = render({ Polonium: 1.12, Yttrium: 2.3, Germanium: 3, Carbon: 20 });
    expect(host.querySelector(".fact-k")?.textContent).toBe("Mats");
    const v = host.querySelector(".fact-v")?.textContent ?? "";
    expect(v).not.toMatch(/%|\d/);
    expect(v).toContain("Po");
    expect(v).toContain("Y");
    expect(v).not.toContain("C ");
    expect(v.endsWith("★")).toBe(true);
  });

  it("shows every material when none is rich, up to six", () => {
    const host = render({ Germanium: 1, Vanadium: 1, Arsenic: 0.5, Zinc: 1, Tin: 0.2, Molybdenum: 0.2, Zirconium: 0.5 });
    const syms = (host.querySelector(".fact-v")?.textContent ?? "").trim().split(" ");
    expect(syms).toHaveLength(6);
    expect(syms.every((s) => /^[A-Z][a-z]?$/.test(s))).toBe(true);
  });
});
