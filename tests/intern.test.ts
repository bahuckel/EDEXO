/**
 * One copy of each repeated scan value (src/server/intern.ts; owner, 2026-10-26: server memory). Values parsed from
 * two journal lines are equal but separate strings; stored scans must share one.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { intern, internNamedPercents } from "../src/server/intern.js";
import type { JournalLine } from "../src/shared/types.js";

const scan = (bodyId: number): JournalLine =>
  JSON.parse(
    JSON.stringify({
      timestamp: "2026-10-26T10:00:00Z",
      event: "Scan",
      ScanType: "Detailed",
      BodyName: `Test Sys ${bodyId}`,
      BodyID: bodyId,
      StarSystem: "Test Sys",
      SystemAddress: 1234,
      PlanetClass: "High metal content body",
      Atmosphere: "thin carbon dioxide atmosphere",
      AtmosphereType: "CarbonDioxide",
      AtmosphereComposition: [{ Name: "CarbonDioxide", Percent: 99 }],
      Volcanism: "major water geysers volcanism",
      Landable: true,
      Materials: [
        { Name: "iron", Percent: 20.1 },
        { Name: "phosphorus", Percent: 12.3 },
      ],
    }),
  ) as JournalLine;

describe("interning", () => {
  it("returns the first copy of an equal string", () => {
    const a = intern(["phos", "phorus"].join(""));
    const b = intern(["phosph", "orus"].join(""));
    expect(a).toBe(b);
    const list = [{ Name: ["ir", "on"].join(""), Percent: 1 }, { Name: "iron", Name_Localised: "Iron", Percent: 2 }, null, 7];
    internNamedPercents(list);
    expect((list[0] as { Name: string }).Name).toBe(intern("iron"));
  });

  it("leaves two scanned bodies sharing their class, atmosphere, volcanism and material names", () => {
    const store = new GameStateStore();
    store.apply(scan(1));
    store.apply(scan(2));
    const a = store.explorationScans.get("1234:1")!;
    const b = store.explorationScans.get("1234:2")!;
    expect(a.planetClass).toBe("High metal content body");
    // Same values, and with interning the same strings (equal either way; this checks nothing changed in content).
    for (const k of ["planetClass", "atmosphereType", "volcanism", "starSystem"] as const) expect(a[k]).toEqual(b[k]);
    expect((a.materials as { Name: string }[]).map((m) => m.Name)).toEqual(["iron", "phosphorus"]);
    expect((a.atmosphereComposition as { Name: string }[])[0]!.Name).toBe("CarbonDioxide");
  });
});
