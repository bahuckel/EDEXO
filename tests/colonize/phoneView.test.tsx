/**
 * @vitest-environment jsdom
 *
 * Colonize on a paired phone (1.3.0): read-only. It asks the server only what a LAN device may (getSnapshot), shows
 * the PC's haul plan with its ticks and the sites, and offers nothing that writes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ColonizeSnapshot, DepotSnapshot } from "../../src/shared/colonize/types";
import { COLONIZE_LAN_READ } from "../../src/server/routes/colonizeRoutes";
import { colonizeScreenUrl } from "../../src/client/lsPrefs";
import { tripBuyLineId } from "../../src/shared/colonize/tripPlanProgress";

const site: DepotSnapshot = {
  marketId: "1",
  starSystem: "Swoilz KI-E b4-9",
  systemAddress: 20464042518049,
  stationName: "Orbital Construction Site: Kraepelin City",
  constructionSiteLabel: "Kraepelin City",
  progress: 0.52,
  complete: false,
  failed: false,
  lastTimestamp: "2026-09-08T15:50:17Z",
  resources: [{ name: "steel", nameLocalised: "Steel", required: 6000, provided: 3000, payment: 1 }],
  contributions: [],
  progressHistory: [],
  contributionProgressHistory: [],
};
const snapshot = {
  ownColonies: [{ name: "Swoilz KI-E b4-9", systemAddress: 20464042518049, claimedAt: "2026-05-15T19:04:23Z" }],
  activeDepots: [site],
  completedDepots: [],
  archivedDepots: [],
  liveDocked: { marketId: "1", stationName: site.stationName!, starSystem: site.starSystem, timestamp: null },
  navContext: { starSystem: site.starSystem, systemAddress: 1 },
  // Trip 1's titanium is aboard: that trip is bought (no ticks by hand since 2026-10-23).
  shipCargo: [{ name: "titanium", nameLocalised: "Titanium", count: 80 }],
  shipCargoCapacity: 80,
  carriers: [],
  wingRoster: [],
} as unknown as ColonizeSnapshot;

const trip = (n: number, station: string) => ({
  tripNumber: n,
  loadTons: 80,
  capacity: 80,
  buyRouteLy: 10,
  stops: [
    {
      stopIndex: 0,
      kind: "buy",
      systemName: "Laso UF-E d12-16",
      stationName: station,
      distanceLy: 14,
      stationType: "Coriolis Starport",
      pad: "L",
      arrivalLs: 1234,
      buys: [{ commodityId: "titanium", label: "Titanium", buyTons: 80, buyPrice: 100, forDepots: ["Kraepelin City"], stillNeedTotal: 0 }],
      deliverTo: ["Kraepelin City"],
      cargoLoaded: 80,
    },
  ],
});
const PLAN = {
  planRefreshKey: "k",
  createdAt: "",
  baselineContributions: {},
  // A tick an earlier build saved: dropped as it loads.
  manualCompletedLineIds: [tripBuyLineId(2, 0, "titanium")],
  plan: { trips: [trip(1, "Hammond Hub"), trip(2, "Second Seller")] },
};

const called: string[] = [];
vi.mock("../../src/client/colonize/api", () => {
  const listen = () => () => {};
  const api = new Proxy({ onUpdate: listen, onMaterialBuyScanStatus: listen, onInaraImport: listen, onUiState: listen } as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return () => {
        called.push(prop);
        return Promise.resolve(prop === "getSnapshot" ? snapshot : { ok: true });
      };
    },
  });
  return { colonizeApi: api, colonizeReadOnly: () => true, useColonizeAppState: () => ({ state: {}, connected: true }) };
});
vi.mock("../../src/client/colonize/uiStateSync", () => ({
  loadColonizeUiState: () => Promise.resolve("server"),
  onRemoteUiState: () => () => {},
}));

const { ColonizeScreen } = await import("../../src/client/colonize/ColonizeScreen");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem("edexo-colonize-trip-plan-snapshot-v3", JSON.stringify(PLAN));
  called.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
}

describe("Colonize on a phone", () => {
  it("shows the PC's plan, the site and the hold, offers nothing that writes, and asks only what LAN may", async () => {
    act(() => root.render(<ColonizeScreen />));
    await settle();
    const text = host.textContent ?? "";
    expect(text).toContain("Phone view");
    expect(host.querySelector("[data-testid='phone-where']")?.textContent).toContain("Kraepelin City");
    expect(host.querySelector("[data-testid='phone-hold']")?.textContent).toContain("80 / 80 t");
    // Trip 1's cargo is aboard: trip 2 is next.
    expect(text).toContain("Next trip · 2 of 2");
    expect(text).toContain("Second Seller");
    // The stop's facts from EDEXO's stations index (1.3.0): pad and distance from the star.
    // As chips on the stop's card (R5b): its type, pad and distance from the star.
    for (const chip of ["Coriolis Starport", "L pad", "1,234 ls"]) expect(text).toContain(chip);
    expect(text).toContain("Docked at your site");
    expect(text).toContain("Kraepelin City");
    expect(text).toContain("Your colony");
    for (const write of ["Never use this station", "Mark trip done", "Put this site away", "Shop around", "Copy"]) expect(text).not.toContain(write);
    // Nothing to tick, here or on the PC.
    expect(host.querySelectorAll("input[type=checkbox]").length).toBe(0);
    // No tabs: Search, Sources and Wing write or look things up.
    expect(host.querySelector("[role=tab]")).toBeNull();
    expect(called.length).toBeGreaterThan(0);
    for (const m of called) expect(COLONIZE_LAN_READ.has(m as never), m).toBe(true);
  });

  it("says when the PC has made no plan yet", async () => {
    localStorage.clear();
    act(() => root.render(<ColonizeScreen />));
    await settle();
    expect(host.querySelector("[data-testid='phone-no-plan']")?.textContent).toContain("open Colonize on the PC");
  });
});

describe("the phone's link", () => {
  it("keeps the LAN address and its access key", () => {
    expect(colonizeScreenUrl("http://192.0.2.10:7111/?k=abc")).toBe("http://192.0.2.10:7111/?k=abc&screen=colonize");
  });
});
