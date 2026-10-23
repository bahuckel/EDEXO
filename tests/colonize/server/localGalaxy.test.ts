/**
 * EDEXO's own galaxy data for Colonize (localGalaxy.ts, localStationFacts.ts): coordinates from the journal first,
 * then the imported visited list, then the stations index; station facts from the stations index, a pad the row
 * already has kept.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalGalaxy, localGalaxyFrom } from "../../../src/server/colonize/localGalaxy";
import { galaxyMemoryState } from "../../../src/server/galaxyMemory";
import { setLocalStationFacts, withLocalStationFacts } from "../../../src/server/colonize/localStationFacts";

const stations = {
  system: (n: string) => (n.toLowerCase() === "hammond" ? { name: "Hammond", x: 7, y: 8, z: 9 } : n.toLowerCase() === "visited" ? { name: "Visited", x: 0, y: 0, z: 0 } : null),
  station: (sys: string, st: string) =>
    sys.toLowerCase() === "hammond" && st.toLowerCase() === "hammond hub"
      ? { name: "Hammond Hub", system: "Hammond", type: "Coriolis Starport", pad: "L" as const, distanceLs: 1234, x: 7, y: 8, z: 9, services: [], updated: null, distanceLy: 0, sys: 0 }
      : null,
};

describe("coordinates", () => {
  it("come from the journal first, then the imported list, then the stations index", () => {
    const store = { visitedSystems: new Map([[1, "Visited"]]), systemPositions: new Map([[1, { x: 1, y: 2, z: 3 }]]) };
    const g = createLocalGalaxy({
      journalStore: () => store as never,
      importedSystems: () => [{ name: "Old Haunt", x: 4, y: 5, z: 6 }],
      stations: () => stations,
    });
    expect(g.systemCoords("VISITED")).toEqual([1, 2, 3]); // the journal's, not the index's 0,0,0
    expect(g.systemCoords("old haunt")).toEqual([4, 5, 6]);
    expect(g.systemCoords("Hammond")).toEqual([7, 8, 9]);
    expect(g.systemCoords("Nowhere")).toBeNull();
    // A system the journal learns later is found without a restart.
    store.visitedSystems.set(2, "New Jump");
    store.systemPositions.set(2, { x: 9, y: 9, z: 9 });
    expect(g.systemCoords("new jump")).toEqual([9, 9, 9]);
  });

  it("answer nothing without sources (no stations index downloaded)", () => {
    const g = createLocalGalaxy({ stations: () => null });
    expect(g.systemCoords("Hammond")).toBeNull();
    expect(g.stationFacts("Hammond", "Hammond Hub")).toBeNull();
  });
});

/*
  Audit 2026-10-22: the imported list comes back new from every call, and a distance resolve asks for up to 400
  sellers back to back; the stations index Colonize read stayed until restart.
*/
describe("what a burst of look-ups costs", () => {
  afterEach(() => vi.useRealTimers());

  it("builds the imported list once, again when the journal learns a system, and again after a while", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const store = { visitedSystems: new Map<number, string>(), systemPositions: new Map<number, { x: number; y: number; z: number }>() };
    let built = 0;
    const g = createLocalGalaxy({
      journalStore: () => store as never,
      importedSystems: () => {
        built++;
        return [
          { name: "Old Haunt", x: 4, y: 5, z: 6 },
          // Not in the galaxy index: its boxel's centre, no name.
          { name: "", x: 0, y: 0, z: 0 },
        ];
      },
      stations: () => null,
    });
    for (let i = 0; i < 400; i++) expect(g.systemCoords("Old Haunt")).toEqual([4, 5, 6]);
    expect(built).toBe(1);
    // An unnamed one is never an answer.
    expect(g.systemCoords("")).toBeNull();
    expect(built).toBe(1);
    store.visitedSystems.set(1, "New Jump");
    store.systemPositions.set(1, { x: 9, y: 9, z: 9 });
    expect(g.systemCoords("Old Haunt")).toEqual([4, 5, 6]);
    expect(built).toBe(2);
    vi.setSystemTime(1_000_000 + 31_000);
    expect(g.systemCoords("Old Haunt")).toEqual([4, 5, 6]);
    expect(built).toBe(3);
  });

  it("keeps the stations index on the galaxy map's idle clock, so it is let go with the map's caches", () => {
    vi.useFakeTimers({ now: 2_000_000_000_000 });
    localGalaxyFrom({}).stationFacts("Nowhere", "Nothing");
    expect(galaxyMemoryState().lastTouch).toBe(2_000_000_000_000);
  });
});

describe("station facts", () => {
  afterEach(() => setLocalStationFacts(null));
  const g = createLocalGalaxy({ stations: () => stations });

  it("fill a seller row's pad, distance from the star and missing type; a pad it has stays", () => {
    setLocalStationFacts((sys, st) => g.stationFacts(sys, st));
    const bare = { systemName: "Hammond", stationName: "Hammond Hub", stationType: null, pad: null };
    expect(withLocalStationFacts(bare)).toMatchObject({ pad: "L", arrivalLs: 1234, stationType: "Coriolis Starport" });
    const inara = { systemName: "hammond", stationName: "HAMMOND HUB", stationType: "Orbis Starport", pad: "M" };
    expect(withLocalStationFacts(inara)).toMatchObject({ pad: "M", stationType: "Orbis Starport", arrivalLs: 1234 });
    const unknown = { systemName: "Elsewhere", stationName: "Somewhere", pad: null };
    expect(withLocalStationFacts(unknown)).toBe(unknown);
  });

  it("pass rows through unchanged when Colonize has no local data", () => {
    const row = { systemName: "Hammond", stationName: "Hammond Hub" };
    expect(withLocalStationFacts(row)).toBe(row);
  });
});
