import { describe, expect, it } from "vitest";
import { resourceNeedId } from "../../src/shared/colonize/commodityKey";
import { buildLogisticsSummary } from "../../src/shared/colonize/logisticsSummary";
import { combinedMissingWithQty, buildCargoMap } from "../../src/shared/colonize/basketGap";
import type { DepotSnapshot, ResourceRow } from "../../src/shared/colonize/types";

function row(name: string, required: number, provided = 0): ResourceRow {
  return { name, nameLocalised: name, required, provided, payment: null };
}

function depot(marketId: string, label: string, resources: ResourceRow[]): DepotSnapshot {
  return {
    marketId,
    starSystem: "Test System",
    systemAddress: null,
    stationName: label,
    constructionSiteLabel: label,
    progress: 0,
    complete: false,
    failed: false,
    lastTimestamp: null,
    resources,
    contributions: [],
    progressHistory: [],
    contributionProgressHistory: [],
  };
}

describe("cargo on hand is allocated once across depots", () => {
  const depots = [
    depot("a", "Site A", [row("Steel", 100)]),
    depot("b", "Site B", [row("Steel", 100)]),
  ];
  const cargo = buildCargoMap([{ name: "Steel", nameLocalised: "Steel", count: 60 }]);

  it("reports the same outstanding total from the summary as from the basket", () => {
    const summary = buildLogisticsSummary(depots, cargo);
    const basket = combinedMissingWithQty(depots, cargo);
    const basketTons = basket.reduce((s, b) => s + b.quantityTons, 0);

    // 200 t required, 60 t aboard, so 140 t outstanding. The summary used to build a
    // fresh cargo pool per row and subtract the same 60 t at both sites, reporting 80.
    expect(summary.totalTonsOutstanding).toBe(140);
    expect(basketTons).toBe(140);
  });

  it("does not let one hold satisfy two sites", () => {
    const summary = buildLogisticsSummary(depots, cargo);
    const steel = summary.rows.find((r) => r.label === "Steel");
    expect(steel?.totalTonsNeeded).toBe(140);
    expect(steel?.depotCount).toBe(2);
  });
});

describe("resourceNeedId", () => {
  it("is stable across the journal symbol and the display name", () => {
    const symbol = resourceNeedId({ name: "$TerrainEnrichmentSystems_name;", nameLocalised: "" });
    const display = resourceNeedId({ name: "Land Enrichment Systems", nameLocalised: "" });
    expect(symbol).not.toBe("");
    expect(symbol).toBe(display);
  });

  it("falls back to the normalised name when nothing in the catalogue matches", () => {
    // The two-term variant used elsewhere returned "" here, so the row was silently
    // dropped by the summary while the planner still counted it.
    const id = resourceNeedId({ name: "Totally Fictional Commodity", nameLocalised: "" });
    expect(id).not.toBe("");
  });

  it("keeps different commodities apart", () => {
    expect(resourceNeedId({ name: "Steel" })).not.toBe(resourceNeedId({ name: "Titanium" }));
  });

  it("uses the localised name when the raw name resolves to nothing", () => {
    expect(resourceNeedId({ name: "", nameLocalised: "Steel" })).toBe(resourceNeedId({ name: "Steel" }));
  });
});
