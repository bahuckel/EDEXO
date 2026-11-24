/**
 * Mutations that survived the suite in organicValue.ts (Stryker 2026-11-24, 43.8 %): the Data value breakdown's
 * lines had no test at all, and the sampled-colour photo, the label cache and the launcher's live strip were only
 * reached on paths where a changed fallback looked the same. Each case fails when the named one changes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/server/organicTracking.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/server/organicTracking.js")>();
  return { ...real, speciesEntryMatchesOrganicLabel: vi.fn(real.speciesEntryMatchesOrganicLabel) };
});

import { GameStateStore } from "../src/server/gameState.js";
import { speciesEntryMatchesOrganicLabel } from "../src/server/organicTracking.js";
import { buildOrganicPendingLines, organicLiveSummary, pendingLinePhoto } from "../src/server/organicValue.js";
import { loadPriceList, lookupPrice } from "../src/server/priceList.js";
import { getProjectRoot } from "../src/server/paths.js";
import { loadSpeciesDatabase } from "../src/server/speciesDb.js";
import type { BodyExoState } from "../src/shared/types.js";

const matcher = vi.mocked(speciesEntryMatchesOrganicLabel);
const prices = loadPriceList(getProjectRoot());
const PLACEHOLDER = "/photos/__builtin_placeholder.svg";
const LABEL = "Stratum Tectonicas - Green";

const body = (key: string, extra: Partial<BodyExoState> = {}) =>
  ({ key, bodyName: `Name of ${key}`, starSystem: `System of ${key}`, ...extra }) as BodyExoState;

const sale = (store: GameStateStore, bodyKey: string, label: string) =>
  store.pendingOrganicSales.push({ fullKey: `${bodyKey}|${label}`, bodyKey, speciesKey: label, label });

describe("the sampled colour's photograph", () => {
  const photo = { photoUrl: "/default.jpg", photoVariants: [{ url: "/yellow.jpg", colour: " Yellow " }] };

  it("reads the colour after the last dash, with or without spaces around it", () => {
    expect(pendingLinePhoto(photo, "Cactoida Peperatis - Yellow ")).toBe("/yellow.jpg");
    expect(pendingLinePhoto(photo, "Cactoida Peperatis -Yellow")).toBe("/yellow.jpg");
    expect(pendingLinePhoto(photo, "Cactoida Peperatis - Green - Yellow")).toBe("/yellow.jpg");
    expect(pendingLinePhoto(photo, "Cactoida Peperatis - Yellow - Green")).toBe("/default.jpg");
  });
});

describe("the Data value breakdown's lines", () => {
  beforeEach(() => {
    matcher.mockClear();
  });

  it("prices each sale, five times on a first-footfall body, and names its body and photograph", () => {
    const db = loadSpeciesDatabase();
    const base = lookupPrice(prices, LABEL, LABEL)!;
    const store = new GameStateStore();
    store.currentSystem = "Here";
    store.bodies.set("100:3", body("100:3"));
    store.firstFootfallBodies.add("100:3");
    sale(store, "100:3", LABEL);
    sale(store, "100:7", LABEL);
    sale(store, "100:8", "Nothing Real - Blue");

    const [first, unknownBody, unknownLabel] = buildOrganicPendingLines(store, db, prices);
    expect(first).toEqual({
      bodyKey: "100:3",
      bodyName: "Name of 100:3",
      starSystem: "System of 100:3",
      speciesLabel: LABEL,
      baseCredits: base,
      valueCredits: base * 5,
      firstFootfall: true,
      multiplier: 5,
      photoUrl: first!.photoUrl,
    });
    expect(base).toBeGreaterThan(1_000_000);
    expect(first!.photoUrl).not.toBe(PLACEHOLDER);
    expect(first!.photoUrl).toBeTruthy();

    expect(unknownBody).toMatchObject({ bodyName: "Body 7", starSystem: "Here", valueCredits: base, multiplier: 1 });
    expect(unknownLabel).toMatchObject({ baseCredits: null, valueCredits: 0, photoUrl: PLACEHOLDER });
  });

  it("falls back to the body key and a dash without a body id or a current system", () => {
    const store = new GameStateStore();
    sale(store, "odd-key", LABEL);
    const [line] = buildOrganicPendingLines(store, loadSpeciesDatabase(), prices);
    expect(line).toMatchObject({ bodyName: "odd-key", starSystem: "—" });
  });

  it("searches the species for a label once per database, a miss included", () => {
    const db = loadSpeciesDatabase();
    const store = new GameStateStore();
    // Labels no other case uses: the cache lives as long as the database.
    sale(store, "100:3", "Bacterium Aurasus - Teal");
    sale(store, "100:4", "Nothing Else - Red");
    buildOrganicPendingLines(store, db, prices);
    const searched = matcher.mock.calls.length;
    expect(searched).toBeGreaterThan(db.species.length);
    buildOrganicPendingLines(store, db, prices);
    expect(matcher.mock.calls.length).toBe(searched);
  });
});

describe("the launcher's live strip", () => {
  const strip = () => {
    const store = new GameStateStore();
    store.currentSystem = "Here";
    for (const k of ["1:1", "1:2", "1:3"]) store.bodies.set(k, body(k, { biologicalSignals: Number(k.slice(2)) }));
    store.uiSelectedBodyKey = "1:3";
    return store;
  };

  it("names the body landed on before the one selected, and the sampled one before both", () => {
    const store = strip();
    store.overlayTouchdownBodyKey = "1:2";
    expect(organicLiveSummary(store)).toMatchObject({ systemName: "Here", bodyName: "Name of 1:2", bioSignals: 2 });
    store.exoOrganicTracker = { bodyKey: "1:1" } as GameStateStore["exoOrganicTracker"];
    expect(organicLiveSummary(store)).toMatchObject({ bodyName: "Name of 1:1", bioSignals: 1 });
  });

  it("copies the next jump's four fields and nothing else", () => {
    const store = strip();
    vi.spyOn(store, "nextJumpTarget").mockReturnValue({
      starSystem: "There",
      starClass: "K",
      arrived: false,
      source: "jump",
      likelyFirstFootfall: null,
    } as unknown as ReturnType<GameStateStore["nextJumpTarget"]>);
    expect(organicLiveSummary(store).jumpTarget).toEqual({ starSystem: "There", starClass: "K", arrived: false, source: "jump" });
  });
});
