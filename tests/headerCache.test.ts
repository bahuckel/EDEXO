/** The last header kept for the window's next load (src/client/headerCache.ts). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSnapshot } from "../src/shared/types.js";
import { HEADER_CACHE_EMPTY, loadHeaderSnapshot, saveHeaderSnapshot } from "../src/client/headerCache.js";
import { SHELL_OMIT } from "../src/server/wsChannels.js";

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());

const snap = (over: Partial<AppSnapshot> = {}) =>
  ({
    journalBoot: null,
    commanderName: "Cmdr",
    currentSystem: "Sol",
    currentSystemAddress: 10477373803,
    bodies: [{ state: { key: "b" } }],
    journalSystems: [{ name: "Sol" }],
    footScannedEntries: [{}],
    organicPendingLines: [{}],
    systemMap: { bodies: [] },
    exoOverlayFocusBody: { state: { key: "b" } },
    ...over,
  }) as unknown as AppSnapshot;

describe("headerCache", () => {
  it("leaves out every field the shell channel leaves out", () => {
    for (const k of SHELL_OMIT) expect(Object.keys(HEADER_CACHE_EMPTY)).toContain(k);
  });

  it("keeps the header's fields and empties the big ones", () => {
    saveHeaderSnapshot(snap());
    const back = loadHeaderSnapshot();
    expect(back?.currentSystem).toBe("Sol");
    expect(back?.commanderName).toBe("Cmdr");
    expect(back?.bodies).toEqual([]);
    expect(back?.journalSystems).toEqual([]);
    expect(back?.systemMap).toBeNull();
    expect(back?.exoOverlayFocusBody).toBeNull();
    expect([...store.values()][0]).not.toContain("footScannedEntries\":[{");
  });

  it("keeps nothing while the journal boots, and survives a broken or blocked store", () => {
    saveHeaderSnapshot(snap({ journalBoot: { phase: "reading" } as unknown as AppSnapshot["journalBoot"] }));
    expect(loadHeaderSnapshot()).toBeNull();
    store.set("edexo.headerSnapshot.v1", "{not json");
    expect(loadHeaderSnapshot()).toBeNull();
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => saveHeaderSnapshot(snap())).not.toThrow();
    expect(loadHeaderSnapshot()).toBeNull();
  });
});
