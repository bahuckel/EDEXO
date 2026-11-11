/**
 * A body read from the journal and the same body hydrated from Spansh/EDSM reach the matcher alike (review 2026-11-10
 * T3, plan 2.2). Each random body is written twice, once as the journal's `Scan` (metres, m/s², pascals, seconds,
 * fractions, lists) and once as Spansh writes it (km, g, atmospheres, days, AU, per cent, maps), and both must give
 * the same planet class and the same measured-exclusion values. The A4 slip (solid composition kept in per cent, a
 * 6 % ice body read as 600 %) fails here, and so does the next unit slip in either path.
 *
 * Seeded, so a failure names its body and runs the same again.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { mapEdsmBodyToExplorationRecord } from "../src/server/edsmSystemHydration.js";
import { planetScanFromExplorationRecord } from "../src/server/footScannedCatalog.js";
import { exclusionValues } from "../src/server/matchSpeciesBands.js";
import type { JournalLine } from "../src/shared/types.js";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spansh's spelling and the journal's, for the classes biology lands on. */
const CLASSES: [spansh: string, journal: string][] = [
  ["High metal content world", "High metal content body"],
  ["Rocky body", "Rocky body"],
  ["Icy body", "Icy body"],
  ["Rocky Ice world", "Rocky ice body"],
  ["Metal-rich body", "Metal rich body"],
];
/** Gas names as the journal writes them, and as Spansh does. */
const GASES: [journal: string, spansh: string][] = [
  ["CarbonDioxide", "Carbon dioxide"],
  ["SulphurDioxide", "Sulphur dioxide"],
  ["Nitrogen", "Nitrogen"],
  ["Argon", "Argon"],
  ["Neon", "Neon"],
  ["Ammonia", "Ammonia"],
];
const METALS = ["iron", "nickel", "sulphur", "carbon", "chromium", "manganese", "phosphorus", "zinc", "germanium"];

const G = 9.80665;
const ATM = 101_325;
const AU = 149_597_870_700;
const DAY = 86_400;
const SYS = 7_267_487_328_978;

type Body = { journal: Record<string, unknown>; spansh: Record<string, unknown>; journalClass: string };

function makeBody(seed: number): Body {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const [spanshClass, journalClass] = pick(CLASSES);
  const bodyId = 1 + Math.floor(r() * 60);
  const name = `Equiv Test AB-C d1-${seed} ${bodyId}`;
  const gravityG = 0.02 + r() * 2.5;
  const radiusKm = 300 + r() * 9000;
  const tempK = 20 + r() * 600;
  const pressureAtm = r() < 0.3 ? 0 : r() * 0.1;
  const smaAu = 0.01 + r() * 300;
  const orbitDays = (r() < 0.2 ? -1 : 1) * (0.1 + r() * 4000);
  const rotDays = (r() < 0.2 ? -1 : 1) * (0.1 + r() * 300);
  const distLs = 5 + r() * 400_000;
  const massEM = 0.0001 + r() * 3;
  const ecc = r() * 0.6;
  const ice = Math.round(r() * 60 * 100) / 100;
  const metal = Math.round(r() * (100 - ice) * 0.5 * 100) / 100;
  const rock = Math.round((100 - ice - metal) * 100) / 100;
  const gases = GASES.filter(() => r() < 0.5).map(([j, s]) => ({ j, s, pct: Math.round(r() * 9900) / 100 }));
  const mats = METALS.filter(() => r() < 0.6).map((m) => ({ m, pct: Math.round(r() * 2500) / 100 }));
  const journal: Record<string, unknown> = {
    timestamp: "2026-09-01T10:00:00Z",
    event: "Scan",
    ScanType: "Detailed",
    StarSystem: "Equiv Test AB-C d1-0",
    SystemAddress: SYS,
    BodyName: name,
    BodyID: bodyId,
    DistanceFromArrivalLS: distLs,
    TidalLock: false,
    TerraformState: "",
    PlanetClass: journalClass,
    Atmosphere: gases.length ? "thin atmosphere" : "",
    AtmosphereType: gases.length ? "CarbonDioxide" : "None",
    AtmosphereComposition: gases.map((g) => ({ Name: g.j, Percent: g.pct })),
    Volcanism: "",
    MassEM: massEM,
    Radius: radiusKm * 1000,
    SurfaceGravity: gravityG * G,
    SurfaceTemperature: tempK,
    SurfacePressure: pressureAtm * ATM,
    Landable: true,
    Materials: mats.map((x) => ({ Name: x.m, Percent: x.pct })),
    Composition: { Ice: ice / 100, Rock: rock / 100, Metal: metal / 100 },
    SemiMajorAxis: smaAu * AU,
    Eccentricity: ecc,
    OrbitalInclination: 1.5,
    Periapsis: 20,
    OrbitalPeriod: orbitDays * DAY,
    AscendingNode: 3,
    MeanAnomaly: 4,
    RotationPeriod: rotDays * DAY,
    AxialTilt: 0.1,
    WasDiscovered: true,
    WasMapped: false,
  };
  const spansh: Record<string, unknown> = {
    bodyId,
    name,
    type: "Planet",
    subType: spanshClass,
    distanceToArrival: distLs,
    earthMasses: massEM,
    radius: radiusKm,
    gravity: gravityG,
    surfaceTemperature: tempK,
    surfacePressure: pressureAtm,
    isLandable: true,
    atmosphereType: gases.length ? "Thin Carbon dioxide" : "No atmosphere",
    atmosphereComposition: Object.fromEntries(gases.map((g) => [g.s, g.pct])),
    materials: Object.fromEntries(mats.map((x) => [x.m[0]!.toUpperCase() + x.m.slice(1), x.pct])),
    solidComposition: { Ice: ice, Rock: rock, Metal: metal },
    semiMajorAxis: smaAu,
    orbitalEccentricity: ecc,
    orbitalInclination: 1.5,
    argOfPeriapsis: 20,
    orbitalPeriod: orbitDays,
    rotationalPeriod: rotDays,
    axialTilt: 0.1,
  };
  return { journal, spansh, journalClass };
}

/** Numbers equal to 9 significant figures (the two paths multiply and divide by the same constants). */
function close(a: unknown, b: unknown, path: string, out: string[]): void {
  if (typeof a === "number" && typeof b === "number") {
    if (Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) out.push(`${path}: journal ${a}, hydrated ${b}`);
  } else if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
      close((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
  } else if (a !== b) out.push(`${path}: journal ${JSON.stringify(a)}, hydrated ${JSON.stringify(b)}`);
}

const BODIES = Array.from({ length: 120 }, (_, i) => [3000 + i, makeBody(3000 + i)] as const);

describe("a body from the journal and the same body from Spansh", () => {
  it.each(BODIES)("body %i: same class, same measured-exclusion values", (_seed, b) => {
    const store = new GameStateStore();
    store.apply(b.journal as unknown as JournalLine);
    const fromJournal = [...store.explorationScans.values()].find((x) => x.bodyId === b.journal.BodyID)!;
    const hydrated = mapEdsmBodyToExplorationRecord(b.spansh, SYS, "Equiv Test AB-C d1-0")!;
    const js = planetScanFromExplorationRecord(fromJournal)!;
    const hs = planetScanFromExplorationRecord(hydrated)!;
    expect(js.PlanetClass).toBe(b.journalClass);
    expect(hs.PlanetClass).toBe(b.journalClass);
    const diffs: string[] = [];
    close(exclusionValues(js, undefined), exclusionValues(hs, undefined), "values", diffs);
    expect(diffs).toEqual([]);
  });
});
