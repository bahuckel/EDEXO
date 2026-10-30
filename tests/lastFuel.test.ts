/**
 * The main tank's last known level (owner, 2026-10-30: "log the last known fuel level instead of assuming the fuel is
 * full if the game is not running"): from the journal's lines and the live Status.json, cleared on another ship, kept
 * through a restart, and what the neutron planner starts from when the game is not running.
 */
import { describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { neutronShip } from "../src/server/neutronShip.js";

const at = (m: number) => `2026-10-30T20:${String(m).padStart(2, "0")}:00Z`;

describe("the last known fuel", () => {
  it("follows the journal: login, jumps, scooping, refuels, the reservoir; another ship forgets it", () => {
    const s = new GameStateStore();
    s.apply({ timestamp: at(0), event: "Loadout", Ship: "mandalay", ShipID: 3, FuelCapacity: { Main: 32, Reserve: 0.5 }, Modules: [] } as never);
    s.apply({ timestamp: at(1), event: "LoadGame", Commander: "Test", Ship: "mandalay", ShipID: 3, FuelLevel: 30, FuelCapacity: 32 } as never);
    expect(s.lastFuelMainT).toBe(30);
    s.apply({ timestamp: at(2), event: "FSDJump", StarSystem: "A", SystemAddress: 1, StarPos: [0, 0, 0], JumpDist: 50, FuelUsed: 4, FuelLevel: 26 } as never);
    expect(s.lastFuelMainT).toBe(26);
    expect(s.lastFuelAt).toBe(at(2));
    s.apply({ timestamp: at(3), event: "FuelScoop", Scooped: 3, Total: 29 } as never);
    expect(s.lastFuelMainT).toBe(29);
    s.apply({ timestamp: at(4), event: "ReservoirReplenished", FuelMain: 28.6, FuelReservoir: 0.5 } as never);
    expect(s.lastFuelMainT).toBe(28.6);
    s.apply({ timestamp: at(5), event: "RefuelPartial", Cost: 100, Amount: 10 } as never);
    // Capped at the tank.
    expect(s.lastFuelMainT).toBe(32);
    s.apply({ timestamp: at(6), event: "FSDJump", StarSystem: "B", SystemAddress: 2, StarPos: [50, 0, 0], JumpDist: 50, FuelUsed: 5, FuelLevel: 27 } as never);
    s.apply({ timestamp: at(7), event: "RefuelAll", Cost: 100, Amount: 5 } as never);
    expect(s.lastFuelMainT).toBe(32);
    s.apply({ timestamp: at(8), event: "ShipyardSwap", ShipType: "asp", ShipID: 4 } as never);
    expect(s.lastFuelMainT).toBeNull();
  });

  it("survives a restart, and the journal lines written while EDEXO was closed move it on", () => {
    const before = new GameStateStore();
    before.apply({ timestamp: at(1), event: "LoadGame", Commander: "Test", Ship: "mandalay", ShipID: 3, FuelLevel: 30, FuelCapacity: 32 } as never);
    const saved = JSON.parse(JSON.stringify(before.serializeJournalMergePayload()));
    // EDEXO starts again: the cache first, then the lines the game wrote meanwhile (journalPipeline.ts).
    const after = new GameStateStore();
    expect(after.hydrateJournalMergePayload(saved)).toBe(true);
    expect(after.lastFuelMainT).toBe(30);
    after.apply({ timestamp: at(20), event: "FSDJump", StarSystem: "A", SystemAddress: 1, StarPos: [0, 0, 0], JumpDist: 60, FuelUsed: 5.2, FuelLevel: 24.8 } as never);
    after.apply({ timestamp: at(22), event: "FuelScoop", Scooped: 4, Total: 28.8 } as never);
    after.apply({ timestamp: at(25), event: "FSDJump", StarSystem: "B", SystemAddress: 2, StarPos: [60, 0, 0], JumpDist: 55, FuelUsed: 4.9, FuelLevel: 23.9 } as never);
    expect(after.lastFuelMainT).toBe(23.9);
    expect(after.lastFuelAt).toBe(at(25));
  });

  it("is the live tank while the game writes one, and stays when it stops", () => {
    const s = new GameStateStore();
    s.applyLiveShipFuel(55.5, 0.5);
    expect(s.lastFuelMainT).toBe(55.5);
    // The game closed: Status.json has no fuel.
    s.applyLiveShipFuel(null, null);
    expect(s.liveStatusFuelMainT).toBeNull();
    expect(s.lastFuelMainT).toBe(55.5);
  });

  it("is what the neutron planner starts from when the game is not running", () => {
    const s = new GameStateStore();
    s.apply({ timestamp: at(0), event: "Loadout", Ship: "mandalay", ShipID: 3, FuelCapacity: { Main: 32, Reserve: 0.5 }, Modules: [] } as never);
    s.apply({ timestamp: at(1), event: "FSDJump", StarSystem: "A", SystemAddress: 1, StarPos: [0, 0, 0], JumpDist: 50, FuelUsed: 4, FuelLevel: 12.5 } as never);
    const ship = neutronShip(s);
    expect(ship.fuelNowT).toBe(12.5);
    expect(ship.fuelNowFrom).toBe("last");
    expect(ship.fuelNowAt).toBe(at(1));
    s.applyLiveShipFuel(20, 0.5);
    expect(neutronShip(s)).toMatchObject({ fuelNowT: 20, fuelNowFrom: "live", fuelNowAt: null });
  });

  it("calls a closed game's leftover Status.json the last known, at the journal's time", () => {
    const s = new GameStateStore();
    s.apply({ timestamp: at(1), event: "FSDJump", StarSystem: "A", SystemAddress: 1, StarPos: [0, 0, 0], JumpDist: 50, FuelUsed: 4, FuelLevel: 18 } as never);
    s.gameRunning = false;
    s.applyLiveShipFuel(18, 0.5);
    expect(neutronShip(s)).toMatchObject({ fuelNowT: 18, fuelNowFrom: "last", fuelNowAt: at(1) });
  });
});
