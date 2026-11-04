/**
 * Status.json altitude and the scans' pitch (owner, 2026-11-04: "less accurate than before, I can't even get them to
 * open the hexagon"): with Flags bit 29 (AltitudeFromAverageRadius) the altitude is not above the ground, and a scan's
 * fix carries the pitch the live reads estimated.
 */
import { describe, expect, it } from "vitest";
import { parseStatusJsonFootFix } from "../src/server/footTravelStatus.js";
import { GameStateStore } from "../src/server/gameState.js";
import { journalLineFix } from "../src/server/liveFix.js";

const status = (flags: number, altitude: number) =>
  JSON.stringify({
    timestamp: "2026-11-04T11:05:01Z",
    event: "Status",
    Flags: flags,
    Latitude: 65.09,
    Longitude: 146.18,
    Heading: 84,
    Altitude: altitude,
    BodyName: "A 2",
    PlanetRadius: 9391918,
  });

describe("Status.json altitude", () => {
  it("is height above the ground without bit 29, unknown with it", () => {
    expect(parseStatusJsonFootFix(status(153157704, 2))!.altitudeM).toBe(2);
    expect(parseStatusJsonFootFix(status(153157704 + 0x20000000, 2066))!.altitudeM).toBeNull();
  });

  it("gives a journal line's fix the pitch the live reads estimated, not when the altitude is unknown", () => {
    const store = new GameStateStore();
    store.exoOrganicLastFix = { ...parseStatusJsonFootFix(status(153157704, 40))!, pitchDeg: -12 };
    expect(journalLineFix(store, status(153157704, 40))!.pitchDeg).toBe(-12);
    expect(journalLineFix(store, status(153157704 + 0x20000000, 2066))!.pitchDeg).toBeNull();
    expect(journalLineFix(store, null)).toBeNull();
  });
});
