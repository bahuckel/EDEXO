/**
 * @vitest-environment jsdom
 *
 * The shortest-order line of a saved boxel (src/client/boxel/BoxelOrderLine.tsx): positions worked out from the
 * system's address are marked as predicted, with how often such a prediction is exact (owner, 2026-11-24: "show
 * threshold and mark predicted").
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { BoxelOrderLine } from "../src/client/boxel/BoxelOrderLine";
import type { SavedBoxelDTO } from "../src/shared/boxel";

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

const boxel = (extra: Partial<SavedBoxelDTO>): SavedBoxelDTO =>
  ({ id: "1", prefix: "Eol Prou AB-C d1-", shortest: true, placed: 3, orderLy: 120, numericLy: 300, ...extra }) as SavedBoxelDTO;
const show = (b: SavedBoxelDTO) => {
  act(() => root.render(<BoxelOrderLine b={b} />));
  return host.textContent ?? "";
};

describe("the shortest-order line", () => {
  it("marks the predicted positions and says how often they are exact", () => {
    const text = show(
      boxel({
        order: [
          { n: 4, ly: 12 },
          { n: 7, ly: 30, predicted: true },
          { n: 5, ly: 78, predicted: true },
        ],
        predicted: 2,
        predictedExact: 0.96,
      }),
    );
    expect(text).toContain("d1-4 12 ly");
    expect(text).toContain("d1-7 ≈ 30 ly");
    expect(text).toContain("2 of the 3 positions are predicted from the system's address");
    expect(text).toContain("exact for 96 % of mass code d systems");
    expect(host.querySelectorAll('[title="Predicted position"]')).toHaveLength(2);
  });

  it("says nothing about predictions when every position was seen", () => {
    const text = show(boxel({ order: [{ n: 4, ly: 12 }, { n: 7, ly: 30 }, { n: 5, ly: 78 }] }));
    expect(text).not.toContain("predicted");
    expect(text).not.toContain("≈");
    expect(text).toContain("120 ly for the 3 with a position");
  });

  it("reads the mass code of a sector's first boxel, which has no number", () => {
    const text = show(
      boxel({ prefix: "Eembaids EG-Y g", order: [{ n: 4, ly: 12, predicted: true }], placed: 1, predicted: 1, predictedExact: 1 }),
    );
    expect(text).toContain("1 of the 1 positions is predicted");
    expect(text).toContain("exact for 100 % of mass code g systems");
  });
});
