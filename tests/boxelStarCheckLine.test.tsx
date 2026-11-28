/**
 * @vitest-environment jsdom
 *
 * The line that checks the star predictions against your own scans (src/client/boxel/BoxelStarCheckLine.tsx; plan
 * §3 item 4 of docs/plan-24112026-star-predictor.md).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { BoxelStarCheckLine } from "../src/client/boxel/BoxelStarCheckLine";
import type { BoxelStarCheckDTO, SavedBoxelDTO } from "../src/shared/boxel";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const byId = new Map<string, SavedBoxelDTO>([
  ["a", { id: "a", prefix: "Eol Prou AB-C d1-", boxel: "AB-C d1" } as SavedBoxelDTO],
  ["b", { id: "b", prefix: "Eembaids EG-Y g", boxel: "EG-Y g" } as SavedBoxelDTO],
]);
const show = (checks: BoxelStarCheckDTO[]) => {
  act(() => root.render(<BoxelStarCheckLine checks={checks} byId={byId} />));
  return host.textContent ?? "";
};
const miss = (n: number, predicted: BoxelStarCheckDTO["misses"][number]["predicted"], real: string) => ({ n, predicted, real });

describe("the star predictions against your scans", () => {
  it("counts the hits per boxel and spells out the misses", () => {
    const text = show([
      {
        boxelId: "a",
        checked: 14,
        right: 12,
        misses: [
          miss(23, { cls: "F", right: 0.94, alive: 0.85, likely: true }, "A"),
          miss(41, { cls: "A", right: 0.99, stage: "neutron", aged: "base" }, "blackHole"),
        ],
      },
      { boxelId: "b", checked: 3, right: 3, misses: [] },
    ]);
    expect(text).toContain("Star predictions against your scans: 12 of 14 right in AB-C d1");
    expect(text).toContain("(d1-23: predicted F?, found class A; d1-41: predicted neutron star, found a black hole).");
    expect(text).toContain("3 of 3 right in EG-Y g.");
    expect(host.querySelector("p")!.getAttribute("title")).toContain("never from its own");
  });

  it("counts the misses past the fifth, and shows nothing with nothing checked", () => {
    const many = Array.from({ length: 8 }, (_, i) => miss(i, { cls: "K", right: 0.964, alive: 0.99 }, i ? "small" : "tTauri"));
    const text = show([{ boxelId: "a", checked: 20, right: 12, misses: many }]);
    expect(text).toContain("d1-0: predicted K, found a T Tauri star; d1-1: predicted K, found a small star in its place");
    expect(text).toContain("; 3 more).");
    expect(show([])).toBe("");
    expect(show([{ boxelId: "a", checked: 0, right: 0, misses: [] }])).toBe("");
  });
});
