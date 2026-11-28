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

  it("says what the system's age has made of the star, once the age is known", () => {
    const dead = row({ predictedStar: { cls: "A", right: 0.99, stage: "neutron", aged: "base" } });
    expect(show(dead)).toBe("≈ neutron star");
    expect(main.value(dead)).toBe("≈ neutron");
    const title = host.querySelector("[title]")!.getAttribute("title")!;
    expect(title).toContain("Predicted from the system's address, not seen by anyone: a neutron star.");
    expect(title).toContain("its age follows from the ages of the systems you scanned in this boxel");
    expect(title).toContain("Right for about 99 % of such answers.");
    expect(show(row({ predictedStar: { cls: "F", right: 0.99, stage: "whiteDwarf", aged: "base" } }))).toBe("≈ white dwarf");
    expect(show(row({ predictedStar: { cls: "F", right: 0.99, stage: "giant", aged: "base" } }))).toBe("≈ giant");
    expect(show(row({ predictedStar: { cls: "B", right: 0.99, stage: "collapsed", aged: "base" } }))).toBe("≈ neutron star or black hole");
    // A young system's own dice: one in twenty holds a small star in the star's place, and that call is a likely one.
    expect(show(row({ predictedStar: { cls: "F", right: 0.89, stage: "small", aged: "dice", likely: true } }))).toBe("≈ small star?");
    expect(host.querySelector("[title]")!.getAttribute("title")).toContain("Likely from the system's address, not seen by anyone: a small star in the place of the one the system was born with");
    expect(host.querySelector("[title]")!.getAttribute("title")).toContain("its age is on the system's own dice");
    // A boxel that replaces its heavy stars: by its place before any scan, by his scans after.
    expect(show(row({ predictedStar: { cls: "A", right: 0.99, stage: "small", aged: "place" } }))).toBe("≈ small star");
    expect(host.querySelector("[title]")!.getAttribute("title")).toContain("This close to Sol or to the galaxy's centre stars this heavy are replaced by small ones. Right for about 99 % of such answers.");
    expect(show(row({ predictedStar: { cls: "A", right: 0.97, stage: "small", aged: "kind" } }))).toBe("≈ small star");
    expect(host.querySelector("[title]")!.getAttribute("title")).toContain("In this boxel stars this heavy are replaced by small ones, as your scans here show. Right for about 97 % of such answers.");
    // Still itself, and known to be: no "if it is still on the main sequence".
    expect(show(row({ predictedStar: { cls: "F", right: 0.978, alive: 0.95, aged: "dice", sharpened: true } }))).toBe("≈ F");
    const itself = host.querySelector("[title]")!.getAttribute("title")!;
    expect(itself).toContain("not seen by anyone: class F. Right for about 98 % of such stars, sharpened by an arrival star you scanned in this boxel.");
    expect(itself).toContain("The star should still be itself: its age is on the system's own dice (right for about 95 %).");
    expect(itself).not.toContain("something else by now");
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

describe("the Biology column", () => {
  const bio = boxelColumns({
    byId: new Map(),
    order: new Map(),
    knownMax: new Map(),
    openRow: () => undefined,
    patch: async () => undefined,
    setCutAsk: () => undefined,
  }).find((c) => c.key === "bio")!;
  const shown = (r: BoxelTableRowDTO) => {
    act(() => root.render(<>{bio.render(r)}</>));
    return host.textContent ?? "";
  };

  it("gives a system with nothing recorded the chance its age path holds biology (owner 2026-11-28)", () => {
    const young = row({ bio: null, bioOdds: { chance: 0.0594, path: "young", third: "light", average: 0.0325 } });
    expect(shown(young)).toBe("≈ 5.9 %");
    expect(bio.value(young)).toBe(0.0594);
    const cell = host.querySelector("[title]")!;
    expect(cell.className).toContain("boxel-bio-likelier");
    expect(cell.getAttribute("title")).toContain(
      "By its address it is a young system, its arrival star born among the lightest third of its mass code: 5.9 % of such systems hold a body with biology",
    );
    expect(cell.getAttribute("title")).toContain("against 3.3 % for every system of this mass code");
    // Path A in e is less likely than the average: not marked.
    shown(row({ bio: null, bioOdds: { chance: 0.0215, path: "A", average: 0.0325 } }));
    expect(host.querySelector("[title]")!.className).not.toContain("boxel-bio-likelier");
  });

  it("keeps what is recorded before any chance", () => {
    const seen = row({
      bio: { signals: 2, seen: true, species: ["Stratum Tectonicas"] },
      bioOdds: { chance: 0.05, path: "young", average: 0.03 },
    });
    expect(shown(seen)).toBe("2 signals: Stratum Tectonicas");
    expect(bio.value(seen)).toBe(1002);
    expect(shown(row({ bio: null }))).toBe("—");
    expect(bio.value(row({ bio: null }))).toBeNull();
  });
});
