/**
 * @vitest-environment jsdom
 *
 * The trip plan's in-memory copy (tripPlanProgress.ts) must not hide ticks another window made: they arrive as new
 * text in storage (uiStateSync.ts). A tick of this window still waiting to be saved is newer than storage and wins.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "edexo-colonize-trip-plan-snapshot-v3";
const text = (ticks: string[]) =>
  JSON.stringify({ planRefreshKey: "k", plan: { trips: [{ tripNumber: 1, stops: [] }] }, manualCompletedLineIds: ticks });

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("the trip plan's in-memory copy", () => {
  it("follows new text in storage, and a pending save wins over storage", async () => {
    const trips = await import("../../src/shared/colonize/tripPlanProgress");
    localStorage.setItem(KEY, text(["a"]));
    expect(trips.loadTripPlanSnapshot()?.manualCompletedLineIds).toEqual(["a"]);
    // Same text: the parsed copy is reused.
    expect(trips.loadTripPlanSnapshot()).toBe(trips.loadTripPlanSnapshot());

    localStorage.setItem(KEY, text(["a", "b"])); // another window ticked "b"
    expect(trips.loadTripPlanSnapshot()?.manualCompletedLineIds).toEqual(["a", "b"]);

    const mine = { ...trips.loadTripPlanSnapshot()!, manualCompletedLineIds: ["c"] };
    trips.scheduleSaveTripPlanSnapshot(mine, 50);
    expect(trips.loadTripPlanSnapshot()?.manualCompletedLineIds).toEqual(["c"]);
    // Another window's save landing before this one is written does not undo this window's tick.
    localStorage.setItem(KEY, text(["a", "b", "z"]));
    expect(trips.loadTripPlanSnapshot()?.manualCompletedLineIds).toEqual(["c"]);
    await new Promise((r) => setTimeout(r, 120));
    expect(JSON.parse(localStorage.getItem(KEY)!).manualCompletedLineIds).toEqual(["c"]);
    expect(trips.loadTripPlanSnapshot()?.manualCompletedLineIds).toEqual(["c"]);
  });
});
