/**
 * A sibling moon's species are a hint here, not a find (2026-10-03): Skaude EX-A d1-228 5 c and 5 d
 * carried 5 b's five species as "logged by you" and as the accuracy probe's truth.
 */
import { describe, expect, it } from "vitest";
import { loadSpeciesDatabase } from "../src/server/snapshot.js";
import {
  collectOwnOrganicLockSpeciesIds,
  collectResolvedOrganicLockSpeciesIds,
} from "../src/server/organicLocks.js";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import type { OrganicGenusLock, PlanetScan, SpeciesDatabase } from "../src/shared/types.js";

const db = loadSpeciesDatabase() as unknown as SpeciesDatabase;
const lock = (fromSibling: boolean): OrganicGenusLock => ({
  genusLocalised: "Aleoida",
  genusSymbol: "$Codex_Ent_Aleoids_Genus_Name;",
  speciesLocalised: "Aleoida Gravis",
  speciesSymbol: "$Codex_Ent_Aleoids_05_Name;",
  variantLocalised: "Aleoida Gravis - Teal",
  ...(fromSibling ? { fromSibling: true } : {}),
});

describe("a body's own finds", () => {
  it("leave out what was copied from a sibling moon", () => {
    expect(collectResolvedOrganicLockSpeciesIds([lock(true)], db)).toEqual(["aleoida_aleoida_gravis"]);
    expect(collectOwnOrganicLockSpeciesIds([lock(true)], db)).toEqual([]);
    expect(collectOwnOrganicLockSpeciesIds([lock(false)], db)).toEqual(["aleoida_aleoida_gravis"]);
  });
});

describe("the matcher on a sibling moon", () => {
  // Skaude EX-A d1-228 5 c: 182 K, where Aleoida gravis (190-195 K) does not grow; 5 b's gravis was
  // injected here as "ScanOrganic on this body identifies this species".
  const fiveC: PlanetScan = {
    BodyName: "Skaude EX-A d1-228 5 c",
    BodyID: 38,
    StarSystem: "Skaude EX-A d1-228",
    SystemAddress: 7843457502475,
    PlanetClass: "Rocky body",
    Atmosphere: "thin carbon dioxide atmosphere",
    AtmosphereType: "CarbonDioxide",
    SurfaceGravity: 0.09 * 9.80665,
    SurfaceTemperature: 182.3,
    SurfacePressure: 0.02 * 101325,
    Landable: true,
  };
  const gravisRow = (locks: OrganicGenusLock[]) =>
    matchDatabaseToScan(db, fiveC, null, locks, { includeBacterium: true }).matches.find(
      (m) => m.entry.id === "aleoida_aleoida_gravis",
    );
  it("does not inject a sibling's species as found here; its own find still is", () => {
    expect(gravisRow([lock(true)])?.approximateMatch).not.toBe(true);
    expect(gravisRow([lock(false)])?.approximateMatch).toBe(true);
  });

  // Review 2026-11-10 A1: the sibling's gravis narrowed Aleoida to gravis, which fails 182 K, and dropped every
  // Bacterium: the moon showed no Aleoida and no Bacterium at all.
  it("keeps the species that fits here and every Bacterium when a sibling's find is copied over", () => {
    const ids = (locks: OrganicGenusLock[]) =>
      matchDatabaseToScan(db, fiveC, null, locks, { includeBacterium: true }).matches.map((m) => m.entry.id);
    const bare = ids([]);
    const withSibling = ids([lock(true)]);
    expect(bare).toContain("aleoida_aleoida_coronamus");
    expect(withSibling).toContain("aleoida_aleoida_coronamus");
    expect(withSibling.filter((id) => id.startsWith("bacterium_"))).toEqual(bare.filter((id) => id.startsWith("bacterium_")));
    expect(bare.some((id) => id.startsWith("bacterium_"))).toBe(true);
  });

  // Review 2026-11-10 A2: on a body with no DSS (FSS count only), the commander's own sample of another genus
  // removed every Bacterium row, though Bacterium may well be one of the signals not yet found.
  it("keeps every Bacterium after an own sample of another genus on a body with no DSS", () => {
    const bacteria = (locks: OrganicGenusLock[]) =>
      matchDatabaseToScan(db, fiveC, null, locks, { includeBacterium: true })
        .matches.map((m) => m.entry.id)
        .filter((id) => id.startsWith("bacterium_"));
    expect(bacteria([lock(false)])).toEqual(bacteria([]));
    expect(bacteria([]).length).toBeGreaterThan(0);
  });
});
