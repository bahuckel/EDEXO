/**
 * His own notable-body rules (src/shared/customBodyRules.ts, owner 2026-11-02): conditions on the scan, all of which
 * must hold, the figures that met them, the settings' checks, and the notice a matching scan raises.
 */
import { describe, expect, it } from "vitest";
import { customRuleHits, sanitizeCustomRules, type CustomBodyRule } from "../src/shared/customBodyRules.js";
import { featureRecordFromScan } from "../src/shared/bodyFeatures.js";
import { DEFAULT_NOTIFY_PREFS, mergeNotifyPrefs } from "../src/shared/notices.js";
import { createNoticesService, type NoticesContext } from "../src/server/notices.js";

const scan = {
  timestamp: "2026-11-02T12:00:00Z",
  event: "Scan",
  StarSystem: "Rule",
  SystemAddress: 9,
  BodyID: 4,
  BodyName: "Rule 4 a",
  PlanetClass: "Rocky body",
  Landable: true,
  SurfaceGravity: 0.4,
  SurfaceTemperature: 180,
  SurfacePressure: 900,
  Atmosphere: "thin argon atmosphere",
  Volcanism: "",
  TerraformState: "",
  DistanceFromArrivalLS: 1234.5,
  Radius: 400_000,
};

const lowG: CustomBodyRule = {
  id: "r1",
  name: "Floaty argon",
  on: true,
  conds: [
    { field: "landable", op: "yes" },
    { field: "gravityG", op: "lt", value: 0.05 },
    { field: "atmosphere", op: "has", value: "argon" },
  ],
};

describe("his own rules", () => {
  it("match when every condition holds, with the figures that met them", () => {
    const hits = customRuleHits(featureRecordFromScan(scan), [lowG]);
    expect(hits).toEqual([{ key: "rule:r1", label: "Floaty argon", why: "Landable, Gravity 0.041 g, Atmosphere thin argon atmosphere" }]);
    // One condition fails: no match.
    expect(customRuleHits(featureRecordFromScan({ ...scan, SurfaceGravity: 1 }), [lowG])).toEqual([]);
    // Off, or without a condition: nothing.
    expect(customRuleHits(featureRecordFromScan(scan), [{ ...lowG, on: false }, { ...lowG, id: "r2", conds: [] }])).toEqual([]);
  });

  it("read 'none' as no volcanism, text in any case, and an unknown figure as not met", () => {
    const r = featureRecordFromScan(scan);
    const rule = (conds: CustomBodyRule["conds"]): CustomBodyRule => ({ id: "x", name: "x", on: true, conds });
    expect(customRuleHits(r, [rule([{ field: "volcanism", op: "has", value: "none" }])])).toHaveLength(1);
    expect(customRuleHits(r, [rule([{ field: "planetClass", op: "has", value: "ROCKY" }])])).toHaveLength(1);
    expect(customRuleHits(r, [rule([{ field: "terraformable", op: "no" }])])).toHaveLength(1);
    expect(customRuleHits(r, [rule([{ field: "distanceLs", op: "ge", value: 1000 }])])[0]?.why).toBe("Distance from arrival 1,235 ls");
    // No orbital period in the scan: the condition cannot hold.
    expect(customRuleHits(r, [rule([{ field: "orbitDays", op: "lt", value: 1 }])])).toEqual([]);
  });

  it("keep only well-formed rules in the settings, and a settings file from before them still loads", () => {
    const got = sanitizeCustomRules([
      lowG,
      { ...lowG }, // the same id twice
      { id: "bad id!", name: "", conds: [{ field: "nope", op: "lt", value: 1 }, { field: "gravityG", op: "has", value: 1 }, { field: "radiusKm", op: "gt", value: "big" }] },
      "junk",
    ]);
    expect(got).toHaveLength(2);
    expect(got[1]).toEqual({ id: "badid", name: "My rule", on: true, conds: [] });
    expect(sanitizeCustomRules(Array.from({ length: 30 }, (_, i) => ({ ...lowG, id: `r${i}` })))).toHaveLength(20);
    expect(DEFAULT_NOTIFY_PREFS.customRules).toEqual([]);
    const p = mergeNotifyPrefs(DEFAULT_NOTIFY_PREFS, { customRules: [lowG] });
    expect(p.customRules).toEqual([lowG]);
    // A change to something else keeps the rules.
    expect(mergeNotifyPrefs(p, { records: false }).customRules).toEqual([lowG]);
    expect(mergeNotifyPrefs({ ...DEFAULT_NOTIFY_PREFS, customRules: undefined as never }, {}).customRules).toEqual([]);
  });

  it("send a matching scan to the mail icon under the rule's name", () => {
    const ctx: NoticesContext = {
      isKnownBody: () => false,
      allScans: function* () {},
      currentSystem: () => ({ name: "Rule", address: 9 }),
      scanOf: () => null,
    };
    const n = createNoticesService({ filePath: null });
    n.observe({ ...scan, SurfaceGravity: 0.3 }, ctx);
    expect(n.list()).toHaveLength(0);
    n.setPrefs({ customRules: [lowG] });
    n.observe({ ...scan, BodyID: 5, BodyName: "Rule 5 a", SurfaceGravity: 0.3 }, ctx);
    expect(n.list().map((x) => `${x.title}: ${x.text}`)).toEqual([expect.stringMatching(/^Floaty argon: 5 a in Rule — Landable, Gravity 0.031 g/)]);
  });
});
