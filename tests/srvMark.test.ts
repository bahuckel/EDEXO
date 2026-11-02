/**
 * The SRV mark (plan 1.3.6 S-2, owner 2026-11-02: "SRV mark - yes"): stepping out of the SRV marks where it stands, from
 * Status.json at that moment (`Disembark` has no position); boarding it, docking it, launching another or losing it
 * clears the mark.
 */
import { describe, expect, it } from "vitest";
import { buildExoMinimapDto, ingestExoOrganicJournalLine } from "../src/server/exoOrganicTracker.js";
import { GameStateStore } from "../src/server/gameState.js";
import { getCachedSpeciesDatabase, loadSpeciesDatabase } from "../src/server/snapshot.js";

const BODY = "Eembaids EG-Y g5 4";
const fix = (latDeg: number) => ({
  latDeg,
  lonDeg: 165.72,
  planetRadiusM: 1_500_000,
  bodyName: BODY,
  headingDeg: 0,
  temperatureK: null,
  gravityG: null,
});
const line = (event: string, over: Record<string, unknown> = {}) => ({
  timestamp: "2026-11-02T20:00:00Z",
  event,
  SystemAddress: 37738594260331,
  BodyID: 4,
  Body: BODY,
  OnPlanet: true,
  ...over,
});

function setup() {
  loadSpeciesDatabase();
  const store = new GameStateStore();
  const ingest = (l: Record<string, unknown>, at = 13.93) =>
    ingestExoOrganicJournalLine(store as never, l as never, fix(at), process.cwd(), getCachedSpeciesDatabase());
  return { store, ingest };
}

describe("the SRV mark", () => {
  it("is set where he steps out of the SRV, and shows on that body's radar", () => {
    const { store, ingest } = setup();
    ingest(line("Disembark", { SRV: true, OnStation: false }), 13.93);
    expect(store.surfaceSrvMark).toMatchObject({ bodyKey: "37738594260331:4", latDeg: 13.93, label: "Your SRV" });
    // He walks 0.01° north: the SRV is behind him, to the south.
    store.exoOrganicLastFix = fix(13.94);
    const m = buildExoMinimapDto(store as never, "37738594260331:4", 0)!.marks.find((x) => x.kind === "srv");
    expect(m?.label).toBe("Your SRV");
    expect(m!.northM).toBeLessThan(-200);
  });

  it("is not set by leaving the ship, and goes when he boards the SRV, docks it, launches another or loses it", () => {
    for (const end of [line("Embark", { SRV: true }), line("DockSRV"), line("LaunchSRV"), line("SRVDestroyed")]) {
      const { store, ingest } = setup();
      ingest(line("Disembark", { SRV: false }));
      expect(store.surfaceSrvMark).toBeNull();
      ingest(line("Disembark", { SRV: true }));
      expect(store.surfaceSrvMark).not.toBeNull();
      ingest(end);
      expect(store.surfaceSrvMark).toBeNull();
    }
  });

  it("boarding the ship leaves it where it stands", () => {
    const { store, ingest } = setup();
    ingest(line("Disembark", { SRV: true }));
    ingest(line("Embark", { SRV: false }));
    expect(store.surfaceSrvMark).not.toBeNull();
    // A dismissed ship lifting off on its own leaves the SRV too; flying the ship off does not (the game recalls it).
    ingest(line("Liftoff", { PlayerControlled: false }));
    expect(store.surfaceSrvMark).not.toBeNull();
    ingest(line("Liftoff", { PlayerControlled: true }));
    expect(store.surfaceSrvMark).toBeNull();
  });
});
