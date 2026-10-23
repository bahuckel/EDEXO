/**
 * No ticks by hand (owner, 2026-10-23: "keep it automatic, no ticks"): a plan saved with ticks by an earlier build
 * loads without them, a new plan starts with none, and the window counts against the plan as made, like the HUD
 * (discuss item 4).
 */
import { describe, expect, it } from "vitest";
import {
  createTripPlanSnapshot,
  parseTripPlanSnapshot,
  resolveDisplayLogisticsPlan,
  type TripPlanSnapshot,
} from "../../src/shared/colonize/tripPlanProgress";
import type { LogisticsPlan } from "../../src/shared/colonize/logisticsPlanner";

const buyStop = (stopIndex: number, marketId: string, station: string, ...commodities: string[]) => ({
  stopIndex,
  kind: "buy" as const,
  systemName: "Sys",
  stationName: station,
  marketId,
  buys: commodities.map((commodityId) => ({ commodityId, label: commodityId, tons: 10 })),
  deliverTo: [],
  cargoLoaded: 0,
});
const planOf = (...trips: ReturnType<typeof buyStop>[][]) =>
  ({ trips: trips.map((stops, i) => ({ tripNumber: i + 1, stops })) }) as unknown as LogisticsPlan;

describe("no ticks by hand", () => {
  it("drops ticks saved by an earlier build, here and in the earlier plans", () => {
    const saved = {
      ...createTripPlanSnapshot(planOf([buyStop(0, "100", "A", "steel")]), "K", []),
      manualCompletedLineIds: ["t1-s0-b-steel"],
      earlier: [{ planRefreshKey: "J", manualCompletedLineIds: ["t1-s0-b-titanium"], baselineContributions: {} }],
    };
    const read = parseTripPlanSnapshot(JSON.stringify(saved))!;
    expect(read.manualCompletedLineIds).toEqual([]);
    expect(read.earlier?.[0]?.manualCompletedLineIds).toEqual([]);
  });
  it("starts a new plan, or one made before, with none", () => {
    const a = { ...createTripPlanSnapshot(planOf([buyStop(0, "100", "A", "steel")]), "A", []), manualCompletedLineIds: ["t1-s0-b-steel"] };
    const b = createTripPlanSnapshot(planOf([buyStop(0, "100", "A", "steel")]), "B", [], a);
    expect(b.manualCompletedLineIds).toEqual([]);
    expect(createTripPlanSnapshot(planOf([]), "A", [], b).manualCompletedLineIds).toEqual([]);
  });
});

describe("resolveDisplayLogisticsPlan", () => {
  const made = planOf([buyStop(0, "100", "A", "steel")]);
  const snapshot = createTripPlanSnapshot(made, "K", []) as TripPlanSnapshot;
  const live = {
    ...planOf([buyStop(0, "100", "A", "titanium")]),
    cargoOnHand: 60,
    warnings: [],
    missingBuyIndexed: [],
    missingTripEligible: [],
    dockBuys: [],
  } as unknown as LogisticsPlan;
  it("shows the plan as made while its key is current, with the live cargo", () => {
    const shown = resolveDisplayLogisticsPlan({ live, snapshot, planRefreshKey: "K", hasActiveDepots: true })!;
    expect(shown.trips).toBe(made.trips);
    expect(shown.cargoOnHand).toBe(60);
  });
  it("shows the live plan under a new key", () => {
    expect(resolveDisplayLogisticsPlan({ live, snapshot, planRefreshKey: "K2", hasActiveDepots: true })).toBe(live);
  });
});
