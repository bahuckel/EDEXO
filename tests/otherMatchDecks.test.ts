/**
 * One build for both "other matching details" decks (code review, 2026-10-14): what the snapshot scores a
 * candidate on (no similarity yet) and what the drawer shows (with it) must be exactly what two separate builds
 * gave, on every shipped profile and a spread of bodies.
 */
import { describe, expect, it } from "vitest";
import {
  buildOtherMatchDetailCards,
  buildOtherMatchDetailDecks,
} from "../src/server/exomasteryOtherMatch.js";
import { loadExomasteryProfile } from "../src/server/exomasteryProfile.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import type { PlanetScan } from "../src/shared/types.js";

const root = process.cwd();
const db = loadSpeciesDatabaseFromTree(root);
const bodies: PlanetScan[] = [
  {
    PlanetClass: "Rocky body",
    AtmosphereType: "CarbonDioxide",
    Atmosphere: "thin carbon dioxide atmosphere",
    SurfaceTemperature: 180,
    SurfaceGravity: 1.2,
    SurfacePressure: 900,
    Volcanism: "",
    Landable: true,
    MassEM: 0.05,
    Radius: 1.5e6,
    DistanceFromArrivalLS: 400,
  },
  {
    PlanetClass: "High metal content body",
    AtmosphereType: "SulphurDioxide",
    SurfaceTemperature: 260,
    SurfaceGravity: 3.1,
    Volcanism: "minor metallic magma volcanism",
    Landable: true,
    Materials: [{ Name: "iron", Percent: 21 }],
  },
  {
    PlanetClass: "Icy body",
    AtmosphereType: "None",
    SurfaceTemperature: 70,
    SurfaceGravity: Number.NaN,
    Volcanism: "",
    Landable: true,
  },
  {
    PlanetClass: "Metal rich body",
    AtmosphereType: "None",
    SurfaceTemperature: 1150,
    SurfaceGravity: 14.7,
    Volcanism: "major metallic magma volcanism",
    Landable: true,
  },
] as unknown as PlanetScan[];

describe("buildOtherMatchDetailDecks", () => {
  it("equals two separate builds, with and without a similarity, on every profile", () => {
    let compared = 0;
    for (const e of db.species) {
      const prof = loadExomasteryProfile(root, e);
      if (!prof) continue;
      for (const scan of bodies) {
        const decks = buildOtherMatchDetailDecks(prof, scan, undefined, null);
        expect(decks.withoutSimilarity).toEqual(
          buildOtherMatchDetailCards(prof, scan, undefined, null, null),
        );
        expect(decks.withSimilarity).toEqual(buildOtherMatchDetailCards(prof, scan, undefined, 42, null));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(200);
  });
});
