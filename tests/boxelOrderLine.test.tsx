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
        predictedExact: 0.8,
        predictedChecked: 0,
      }),
    );
    expect(text).toContain("d1-4 12 ly");
    expect(text).toContain("d1-7 ≈ 30 ly");
    expect(text).toContain("2 of the 3 positions are predicted from the system's address");
    expect(text).toContain("its kind is a guess: exact for about 80 % of systems in a mass code d boxel this crowded");
    expect(host.querySelectorAll('[title="Predicted position"]')).toHaveLength(2);
  });

  it("says so once a real position has told the boxel's kind", () => {
    const text = show(
      boxel({
        order: [{ n: 4, ly: 12 }, { n: 7, ly: 30, predicted: true }, { n: 5, ly: 78, predicted: true }],
        predicted: 2,
        predictedExact: 0.99,
        predictedChecked: 1,
      }),
    );
    expect(text).toContain("The boxel's kind was read from 1 real position: such predictions are exact for 99 % of systems.");
    expect(text).not.toContain("guess");
  });

  it("says nothing about predictions when every position was seen", () => {
    const text = show(boxel({ order: [{ n: 4, ly: 12 }, { n: 7, ly: 30 }, { n: 5, ly: 78 }] }));
    expect(text).not.toContain("predicted");
    expect(text).not.toContain("≈");
    expect(text).toContain("120 ly for the 3 with a position");
  });

  it("reads the mass code of a sector's first boxel, which has no number", () => {
    const text = show(
      boxel({ prefix: "Eembaids EG-Y g", order: [{ n: 4, ly: 12, predicted: true }], placed: 1, predicted: 1, predictedExact: 0.7 }),
    );
    expect(text).toContain("1 of the 1 positions is predicted");
    expect(text).toContain("in a mass code g boxel this crowded");
    // A mass code with one kind only needs no guess.
    const sure = show(
      boxel({ prefix: "Eembaids EG-Y g", order: [{ n: 4, ly: 12, predicted: true }], placed: 1, predicted: 1, predictedExact: 0.99 }),
    );
    expect(sure).toContain("Such predictions are exact for 99 % of systems.");
    expect(sure).not.toContain("guess");
  });

  it("puts the star each address predicts in brackets, a likely one with a question mark", () => {
    const star = { cls: "F", right: 0.94, alive: 0.8, likely: true };
    const text = show(
      boxel({
        order: [{ n: 4, ly: 12 }, { n: 7, ly: 30, predicted: true, star }, { n: 5, ly: 78, star: { ...star, cls: "A" } }],
      }),
    );
    expect(text).toContain("d1-4 12 ly");
    expect(text).toContain("d1-7 (F?) ≈ 30 ly");
    expect(text).toContain("d1-5 (A?) 78 ly");
    expect(text).toContain("A letter in brackets is the arrival star the system's address predicts, if it is still on the main sequence");
    expect(text).toContain("about 20 % in this mass code are something else by now");
    expect(text).toContain("a ? marks a likely one: scan one arrival star of this boxel and the rest gets sharper.");
    const title = host.querySelector('[title^="Likely from the system"]')!.getAttribute("title")!;
    expect(title).toContain("class F if the star is still on the main sequence. Right for about 94 % of such stars.");
    expect(title).toContain("About 20 % of this mass code's arrival stars are something else by now");
  });

  it("says a sharpened star is predicted, and keeps quiet when no stop has a star", () => {
    const star = { cls: "K", right: 0.985, alive: 0.99, sharpened: true };
    const text = show(boxel({ order: [{ n: 4, ly: 12, star }, { n: 7, ly: 30 }, { n: 5, ly: 78 }] }));
    expect(text).toContain("d1-4 (K) 12 ly");
    expect(text).toContain("(about 1 % in this mass code are something else by now).");
    expect(text).not.toContain("a ? marks");
    expect(host.querySelector('[title^="Predicted from the system"]')!.getAttribute("title")).toContain(
      "Right for about 99 % of such stars, sharpened by an arrival star you scanned in this boxel.",
    );
    expect(show(boxel({ order: [{ n: 4, ly: 12 }, { n: 7, ly: 30 }, { n: 5, ly: 78 }] }))).not.toContain("brackets");
  });
});
