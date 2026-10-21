import { describe, expect, it } from "vitest";
import { resourceNeedId } from "../../src/shared/colonize/commodityKey";
import {
  commodityDisplayLabel,
  findRavenBuildId,
  parseConstructionSiteHits,
  parseRavenProject,
  siteNeedRows,
} from "../../src/shared/colonize/siteLookup";

describe("parseConstructionSiteHits", () => {
  it("keeps construction depots with their system, and drops everything else", () => {
    const hits = parseConstructionSiteHits({
      results: [
        {
          name: "Orbital Construction Site: Test Station",
          system_name: "Alpha",
          market_id: 3960000001,
          type: "Space Construction Depot",
          distance: 12.5,
          updated_at: "2026-09-25T10:00:00Z",
        },
        {
          name: "Test Station",
          system_name: "Beta",
          market_id: "3960000002",
          type: "Planetary Construction Depot",
        },
        { name: "Test Station", system_name: "Gamma", market_id: 3960000003, type: "Coriolis Starport" },
        { name: "No Market", system_name: "Delta", type: "Space Construction Depot" },
      ],
    });
    expect(hits).toEqual([
      {
        name: "Orbital Construction Site: Test Station",
        systemName: "Alpha",
        marketId: "3960000001",
        kind: "space",
        distanceLy: 12.5,
        updatedAt: "2026-09-25T10:00:00Z",
      },
      {
        name: "Test Station",
        systemName: "Beta",
        marketId: "3960000002",
        kind: "planetary",
        distanceLy: null,
        updatedAt: null,
      },
    ]);
  });

  it("returns nothing for a response it does not recognise", () => {
    expect(parseConstructionSiteHits(null)).toEqual([]);
    expect(parseConstructionSiteHits({ results: "nope" })).toEqual([]);
  });
});

describe("Raven Colonial projects", () => {
  it("finds the project for this market in the system's list", () => {
    const projects = [
      { buildId: "a", marketId: 1 },
      { buildId: "b", marketId: "3960000002" },
    ];
    expect(findRavenBuildId(projects, "3960000002")).toBe("b");
    expect(findRavenBuildId(projects, "9")).toBeNull();
    expect(findRavenBuildId({ not: "a list" }, "1")).toBeNull();
  });

  it("lists what is still needed, largest first, with the planner's ids and readable names", () => {
    const rows = siteNeedRows({ steel: 120, cmmcomposite: 800, liquidoxygen: 0, polymers: 40, junk: "x" });
    expect(rows.map((r) => [r.label, r.tons])).toEqual([
      ["CMM Composite", 800],
      ["Steel", 120],
      ["Polymers", 40],
    ]);
    // Ids match what a journal site's resource rows produce, so a looked-up site can join a plan.
    expect(rows.find((r) => r.label === "CMM Composite")!.commodityId).toBe(
      resourceNeedId({ name: "CMMComposite" }),
    );
    expect(rows.find((r) => r.label === "Polymers")!.commodityId).toBe(resourceNeedId({ name: "Polymers" }));
  });

  it("reads a project, and treats an empty answer as not registered", () => {
    const p = parseRavenProject({
      buildId: "b",
      buildName: "Test Station",
      buildType: "coriolis",
      commodities: { steel: 100, aluminium: 50 },
      maxNeed: 900,
      complete: false,
      timestamp: "2026-09-25T10:00:00Z",
      linkedFC: [{}, {}],
    });
    expect(p).toMatchObject({
      found: true,
      remainingTons: 150,
      totalTons: 900,
      linkedCarriers: 2,
      buildType: "coriolis",
    });
    expect(parseRavenProject(null)).toEqual({ found: false });
    expect(parseRavenProject({})).toEqual({ found: false });
  });

  it("falls back to the raw key for a commodity it has never heard of", () => {
    expect(commodityDisplayLabel("somethingnew")).toBe("somethingnew");
  });
});
