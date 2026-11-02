/**
 * Firm temperature edges (firmTemperatureEdges.ts; overnight study 2026-11-02): a row past an edge the EDDN year
 * never saw its species cross is demoted with no tolerance, and the signal-count rescue does not take it back.
 */
import { beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchDatabaseToScan } from "../src/server/matchSpecies.js";
import { loadSpeciesDatabaseFromTree } from "../src/server/speciesTreeLoader.js";
import { firmTemperatureEdge, pastFirmEdge } from "../src/server/firmTemperatureEdges.js";
import type { PlanetScan, SpeciesDatabase } from "../src/shared/types.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A thin-CO2 rocky moon of the kind labiata grows on (the probe's 1591025322331:80 at 149.99 K, then warmer).
const at = (k: number): PlanetScan =>
  ({
    ScanType: "Detailed",
    BodyName: "Test CO2 moon",
    BodyID: 80,
    StarSystem: "Test",
    SystemAddress: 1591025322331,
    DistanceFromArrivalLS: 1800,
    PlanetClass: "Rocky body",
    Atmosphere: "thin carbon dioxide atmosphere",
    AtmosphereType: "CarbonDioxide",
    AtmosphereComposition: [{ Name: "CarbonDioxide", Percent: 100 }],
    Volcanism: "",
    MassEM: 0.0012,
    Radius: 640000,
    SurfaceGravity: 0.62,
    SurfaceTemperature: k,
    SurfacePressure: 1200,
    Landable: true,
    Parents: [{ Planet: 79 }, { Star: 0 }],
  }) as unknown as PlanetScan;

let db: SpeciesDatabase;
beforeAll(() => {
  db = loadSpeciesDatabaseFromTree(projectRoot);
});

const labiata = (k: number, signals?: number) =>
  matchDatabaseToScan(db, at(k), null, null, { includeBacterium: true, biologicalSignals: signals }).matches.find(
    (m) => m.entry.id === "concha_concha_labiata",
  );

describe("firm temperature edges", () => {
  it("reads the edges the EDDN year holds", () => {
    expect(firmTemperatureEdge("concha_concha_labiata")).toMatchObject({ minK: 150 });
    expect(firmTemperatureEdge("stratum_stratum_paleas")).toMatchObject({ minK: 165 });
    expect(firmTemperatureEdge("tussock_tussock_pennata")).toMatchObject({ maxK: 154 });
    expect(firmTemperatureEdge("no_such_species")).toBeUndefined();
    const e = firmTemperatureEdge("tussock_tussock_ignis")!;
    expect(pastFirmEdge(e, 160.99)).toEqual({ side: "below", edgeK: 161 });
    expect(pastFirmEdge(e, 161)).toBeNull();
    expect(pastFirmEdge(e, 170.01)).toEqual({ side: "above", edgeK: 170 });
  });

  it("demotes a row just past the edge, which the envelope's tolerance used to keep shown", () => {
    const past = labiata(149.99);
    expect(past?.unlikely).toBe(true);
    expect(past!.unlikelyReasons!.map((r) => r.field)).toEqual(["FirmTemperature"]);
    // On the edge it is a candidate as before.
    expect(labiata(150.4)?.unlikely).not.toBe(true);
  });

  it("is not taken back to fill the signal count", () => {
    // Many signals and few genera fit a cold CO2 moon: the rescue looks for rows to bring back.
    const run = matchDatabaseToScan(db, at(149.4), null, null, { includeBacterium: true, biologicalSignals: 8 });
    // Room to fill: fewer genera shown than signals, and labiata the temperature row it would have taken first.
    expect(new Set(run.matches.filter((m) => !m.unlikely).map((m) => m.entry.genusDataDir)).size).toBeLessThan(8);
    const past = run.matches.find((m) => m.entry.id === "concha_concha_labiata");
    expect(past?.unlikely).toBe(true);
    expect(past?.restoredForSignalCount).not.toBe(true);
  });
});
