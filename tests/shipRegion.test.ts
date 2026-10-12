/**
 * Where the ship is, apart from what the app shows (owner, 2026-10-12: the Encyclopedia said "in Arcadian
 * Stream, where you are now" in Empyrean Straits). `currentRegion` follows the system on show (a notice or a
 * map click can point the app at one), `shipRegion` the system the ship is in.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { buildSnapshot, loadSpeciesDatabase } from "../src/server/snapshot.js";

const jump = (sys: string, addr: number, pos: [number, number, number], ts: string) => ({
  timestamp: ts,
  event: "FSDJump",
  StarSystem: sys,
  SystemAddress: addr,
  StarPos: pos,
  JumpDist: 40,
  FuelUsed: 1,
  FuelLevel: 20,
});

describe("the ship's region and the region on show", () => {
  it("keeps shipRegion on the ship while another system is viewed", () => {
    const store = new GameStateStore();
    // The owner's last two regions, from his jumps: Arcadian Stream, then Empyrean Straits.
    store.apply(jump("Arcadian side", 1001, [10410, -245, 34132], "2026-10-11T20:00:00Z"));
    store.apply(jump("Aishaisp VY-S e3-27", 117497138020, [8491.375, 63.40625, 34286.09375], "2026-10-12T01:59:38Z"));
    loadSpeciesDatabase();
    let snap = buildSnapshot(store, null, "", "127.0.0.1", 0, [], 1);
    expect(snap.shipRegion?.name).toBe("Empyrean Straits");
    expect(snap.currentRegion?.name).toBe("Empyrean Straits");

    // Pointed at the old system (a notice, a map click): the system card's region follows it, the ship's does not.
    store.setViewingSystemAddress(1001);
    snap = buildSnapshot(store, null, "", "127.0.0.1", 0, [], 1);
    expect(snap.currentRegion?.name).toBe("Arcadian Stream");
    expect(snap.shipRegion?.name).toBe("Empyrean Straits");
  });
});
