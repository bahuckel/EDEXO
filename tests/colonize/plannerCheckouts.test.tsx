/**
 * @vitest-environment jsdom
 *
 * Opening the Plan tab must not save the sellers again (audit 2026-10-22): it wrote the 50-500 KB checkout on every
 * mount and reset "Sellers last gathered" to "just now", so "(getting old)" never showed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { usePlannerCheckouts, type PlannerCheckouts } from "../../src/client/colonize/planner/hooks/usePlannerCheckouts";
import { loadSavedCheckout, scheduleSaveCheckoutSnapshot } from "../../src/shared/colonize/savedCheckout";
import { parseSavedCheckout } from "../../src/shared/colonize/storageValidation";
import type { BasketCheckoutBundle } from "../../src/shared/colonize/types";

const KEY = "edexo-colonize-last-checkout-v1";
const TWO_HOURS = 2 * 60 * 60_000;

let seen: PlannerCheckouts | null = null;
function Probe({ bundle }: { bundle: BasketCheckoutBundle | null }) {
  seen = usePlannerCheckouts({
    isActive: true,
    activeDepots: [],
    cargoByKey: new Map(),
    checkoutBundle: bundle,
    bannedStations: [],
    constructionRefSystems: [],
    constructionSiteSystems: [],
    homeSystem: "",
  });
  return null;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("the saved sellers on the Plan tab", () => {
  it("keeps their age across mounts and writes nothing", async () => {
    const savedAt = new Date(Date.now() - TWO_HOURS).toISOString();
    const stored = JSON.stringify({ savedAt, bundle: { plans: [] } });
    localStorage.setItem(KEY, stored);
    const bundle = loadSavedCheckout()!.bundle;
    for (let mount = 0; mount < 2; mount++) {
      act(() => root.render(<Probe bundle={bundle} key={mount} />));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(seen?.checkoutAge).toBe("2h ago");
      expect(seen?.checkoutStale).toBe(true);
    }
    expect(localStorage.getItem(KEY)).toBe(stored);
  });

  it("dates new sellers when they are taken in", async () => {
    const next: BasketCheckoutBundle = { plans: [] };
    scheduleSaveCheckoutSnapshot(next);
    act(() => root.render(<Probe bundle={next} />));
    expect(seen?.checkoutAge).toBe("just now");
    expect(seen?.checkoutStale).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ bundle: next });
  });

  it("reads an older save that still carries the single-site result, and none without sellers", () => {
    expect(parseSavedCheckout({ savedAt: "2026-10-22T10:00:00Z", result: null, bundle: { plans: [] } })).toEqual({
      savedAt: "2026-10-22T10:00:00Z",
      bundle: { plans: [] },
    });
    expect(parseSavedCheckout({ savedAt: "2026-10-22T10:00:00Z", result: { groups: [] }, bundle: null })).toBeNull();
  });
});
