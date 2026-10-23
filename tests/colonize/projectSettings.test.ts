/**
 * A site's own settings (discuss items 1 and 9): its plan rules tighten the one combined plan, its "systems per
 * material" go to the scans by its hub, and the HUD follows a pinned site after a docked one.
 */
import { describe, expect, it } from "vitest";
import {
  capsByReference,
  followedSiteId,
  parseProjectSettings,
  strictestRules,
  withProject,
} from "../../src/shared/colonize/projectSettings";

const base = { minLandingPad: "any" as const, maxDistanceLy: "40", showPlanetary: true, excludeFleetCarriers: false, extra: 1 };

describe("strictestRules", () => {
  it("takes the biggest pad, the shortest distance, and no planet ports or carriers if any site says no", () => {
    const { rules, stricterFor } = strictestRules(base, [
      { label: "Hammond Port", rules: { minLandingPad: "L", maxDistanceLy: "60" } },
      { label: "Okafor Dock", rules: { maxDistanceLy: "25", showPlanetary: false } },
      { label: "Quiet", rules: undefined },
    ]);
    expect(rules).toEqual({ minLandingPad: "L", maxDistanceLy: "25", showPlanetary: false, excludeFleetCarriers: false, extra: 1 });
    expect(stricterFor).toEqual(["Hammond Port", "Okafor Dock"]);
  });
  it("leaves the plan's rules alone when no site is stricter, and a site distance where the plan has none", () => {
    expect(strictestRules(base, [{ label: "A", rules: { minLandingPad: "any", maxDistanceLy: "90", showPlanetary: true } }])).toEqual({
      rules: base,
      stricterFor: [],
    });
    expect(strictestRules({ ...base, maxDistanceLy: "" }, [{ label: "A", rules: { maxDistanceLy: "30" } }]).rules.maxDistanceLy).toBe("30");
  });
});

describe("storing", () => {
  it("keeps only what is set, and drops a site set back to the plan", () => {
    let map = withProject({}, "1", { rules: { minLandingPad: "L" }, maxSystemsPerMaterial: "" });
    expect(map).toEqual({ "1": { rules: { minLandingPad: "L" } } });
    map = withProject(map, "1", null);
    expect(map).toEqual({});
    expect(parseProjectSettings({ "2": { rules: { minLandingPad: "X", maxDistanceLy: "12ly" }, maxSystemsPerMaterial: "20" }, bad: 3 })).toEqual({
      "2": { rules: { maxDistanceLy: "12" }, maxSystemsPerMaterial: "20" },
    });
  });
});

describe("capsByReference", () => {
  it("maps each site's cap to its hub, the bigger one where two share a hub", () => {
    expect(
      capsByReference(
        [
          { marketId: "1", reference: "Kraepelin Home" },
          { marketId: "2", reference: "kraepelin home" },
          { marketId: "3", reference: "HIP 47126" },
        ],
        { "1": { maxSystemsPerMaterial: "10" }, "2": { maxSystemsPerMaterial: "25" } },
      ),
    ).toEqual({ "kraepelin home": 25 });
  });
});

describe("followedSiteId", () => {
  const activeIds = ["a", "b", "c"];
  it("docked first, then the pin, then the next trip's site, then the most recent", () => {
    expect(followedSiteId({ dockedId: "c", pinnedId: "b", tripSiteId: "a", activeIds })).toBe("c");
    expect(followedSiteId({ dockedId: null, pinnedId: "b", tripSiteId: "a", activeIds })).toBe("b");
    expect(followedSiteId({ dockedId: null, pinnedId: "gone", tripSiteId: "a", activeIds })).toBe("a");
    expect(followedSiteId({ dockedId: null, pinnedId: null, tripSiteId: null, activeIds })).toBe("a");
  });
});
