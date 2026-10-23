/**
 * @vitest-environment jsdom
 *
 * The trip plan's in-memory copy (tripPlanProgress.ts) must not hide a plan another window saved: it arrives as new
 * text in storage (uiStateSync.ts). A save of this window still waiting to be written is newer than storage and wins.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "edexo-colonize-trip-plan-snapshot-v3";
const text = (key: string) => JSON.stringify({ planRefreshKey: key, plan: { trips: [{ tripNumber: 1, stops: [] }] } });

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("the trip plan's in-memory copy", () => {
  it("follows new text in storage, and a pending save wins over storage", async () => {
    const trips = await import("../../src/shared/colonize/tripPlanProgress");
    localStorage.setItem(KEY, text("a"));
    expect(trips.loadTripPlanSnapshot()?.planRefreshKey).toBe("a");
    // Same text: the parsed copy is reused.
    expect(trips.loadTripPlanSnapshot()).toBe(trips.loadTripPlanSnapshot());

    localStorage.setItem(KEY, text("b")); // another window made a new plan
    expect(trips.loadTripPlanSnapshot()?.planRefreshKey).toBe("b");

    const mine = { ...trips.loadTripPlanSnapshot()!, planRefreshKey: "c" };
    trips.scheduleSaveTripPlanSnapshot(mine, 50);
    expect(trips.loadTripPlanSnapshot()?.planRefreshKey).toBe("c");
    // Another window's save landing before this one is written does not undo this window's.
    localStorage.setItem(KEY, text("z"));
    expect(trips.loadTripPlanSnapshot()?.planRefreshKey).toBe("c");
    await new Promise((r) => setTimeout(r, 120));
    expect(JSON.parse(localStorage.getItem(KEY)!).planRefreshKey).toBe("c");
    expect(trips.loadTripPlanSnapshot()?.planRefreshKey).toBe("c");
  });
});
