/**
 * @vitest-environment jsdom
 *
 * The Boxels table's Main star column (src/client/boxel/boxelColumns.tsx): a system whose star nobody has recorded
 * shows the class its address predicts, marked as such (star predictor step E; owner, 2026-11-24: "show threshold
 * and mark predicted").
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { boxelColumns } from "../src/client/boxel/boxelColumns";
import type { BoxelTableRowDTO } from "../src/shared/boxel";

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

const main = boxelColumns({
  byId: new Map(),
  order: new Map(),
  knownMax: new Map(),
  openRow: () => undefined,
  patch: async () => undefined,
  setCutAsk: () => undefined,
}).find((c) => c.key === "main")!;
const row = (extra: Partial<BoxelTableRowDTO>): BoxelTableRowDTO =>
  ({ boxelId: "a", n: 3, name: "Eol Prou AB-C d1-3", flown: false, from: null, mainStar: null, otherStars: [], ...extra }) as BoxelTableRowDTO;
const show = (r: BoxelTableRowDTO) => {
  act(() => root.render(<>{main.render(r)}</>));
  return host.textContent ?? "";
};

describe("the Main star column", () => {
  it("shows a predicted star with its mark, a likely one with a question mark, and says what it stands on", () => {
    const likely = row({ predictedStar: { cls: "F", right: 0.94, alive: 0.8, likely: true } });
    expect(show(likely)).toBe("≈ F?");
    expect(main.value(likely)).toBe("≈ F");
    const title = host.querySelector("[title]")!.getAttribute("title")!;
    expect(title).toContain("Likely from the system's address, not seen by anyone: class F if the star is still on the main sequence.");
    expect(title).toContain("Right for about 94 % of such stars.");
    expect(title).toContain("Scan one arrival star of this boxel and the rest of it gets sharper.");
    expect(show(row({ predictedStar: { cls: "K", right: 0.964, alive: 0.99 } }))).toBe("≈ K");
    expect(host.querySelector("[title]")!.getAttribute("title")).toContain("Predicted from the system's address");
  });

  it("keeps a recorded star before a prediction, and says when Spansh has no record", () => {
    const known = row({ from: "index", mainStar: "K", predictedStar: { cls: "G", right: 0.964, alive: 0.99 } });
    expect(show(known)).toBe("K");
    expect(main.value(known)).toBe("K");
    expect(show(row({ notOnSpansh: true, predictedStar: { cls: "M", right: 0.996, alive: 0.97 } }))).toBe("≈ M not on Spansh");
    expect(show(row({ notOnSpansh: true }))).toBe("not on Spansh");
    expect(show(row({}))).toBe("—");
    expect(main.value(row({}))).toBeNull();
  });
});
