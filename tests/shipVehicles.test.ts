/**
 * The ship's vehicles in the HUD's Ship section (1.3.1, owner 2026-10-25: "ship deployed vehicles ... Nomad, Rhino, the
 * SRVs"): launches, docks, losses and their hull, and the SRV's HullDamage kept off the ship's hull (1.3.0 put it there).
 * The SRV lines are the owner's own (2023-10-09); the Rhino and Nomad lines follow the Rhino update's journal
 * (`SRVType` mev_rhino; LaunchFighter's unnamed field "lander01" / "Nomad").
 */
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  hydrateShipDamage,
  newShipDamage,
  shipDamageHull,
  shipDamageLoadout,
  shipDamageRepair,
  shipDamageVehicle,
  type ShipDamageState,
} from "../src/shared/shipDamage";
import { ship } from "../src/client/hud/sections/ship";
import type { HudSnapshot } from "../src/client/hud/types";

/** Feeds journal lines the way gameState.apply does: the vehicle events, and HullDamage to the hulls. */
function play(s: ShipDamageState, lines: Record<string, unknown>[]): void {
  for (const j of lines) {
    shipDamageVehicle(s, j);
    if (j.event === "HullDamage") shipDamageHull(s, j);
    if (j.event === "RepairAll") shipDamageRepair(s, j);
  }
}

const loaded = () => {
  const s = newShipDamage();
  shipDamageLoadout(s, { event: "Loadout", timestamp: "2023-10-09T18:00:00Z", Ship: "Krait_MkII", HullHealth: 1, Modules: [] });
  return s;
};

describe("SRVs", () => {
  it("keeps the SRV's hits off the ship's hull (the owner's Scarab drive, 2023-10-09)", () => {
    const s = loaded();
    play(s, [
      { timestamp: "2023-10-09T18:18:22Z", event: "LaunchSRV", SRVType: "testbuggy", SRVType_Localised: "SRV Scarab", Loadout: "starter", ID: 9, PlayerControlled: true },
      { timestamp: "2023-10-09T18:24:09Z", event: "HullDamage", Health: 0.687058, PlayerPilot: true },
      { timestamp: "2023-10-09T18:37:51Z", event: "HullDamage", Health: 0.394384, PlayerPilot: true },
    ]);
    expect(s.hull).toBe(1);
    expect(s.inVehicle).toBe("srv:testbuggy");
    expect(s.vehicles[0]).toMatchObject({ name: "SRV Scarab", state: "out", hull: 0.394384, pilot: "you" });
    play(s, [{ timestamp: "2023-10-09T18:41:30Z", event: "DockSRV", SRVType: "testbuggy", SRVType_Localised: "SRV Scarab", ID: 9 }]);
    expect(s.inVehicle).toBeNull();
    expect(s.vehicles[0]).toMatchObject({ state: "docked", hull: 0.394384 });
    // Back in the ship, a hit with no Fighter field is the ship's again (old journals write it so).
    play(s, [{ timestamp: "2023-10-09T19:00:00Z", event: "HullDamage", Health: 0.9, PlayerPilot: true }]);
    expect(s.hull).toBe(0.9);
  });

  it("names the Rhino, and a lost SRV is at nothing until the next one launches", () => {
    const s = loaded();
    play(s, [
      { timestamp: "2026-09-03T10:00:00Z", event: "LaunchSRV", SRVType: "mev_rhino", Loadout: "default", ID: 41, PlayerControlled: true },
      { timestamp: "2026-09-03T10:20:00Z", event: "SRVDestroyed", ID: 41, SRVType: "mev_rhino" },
    ]);
    expect(s.vehicles[0]).toMatchObject({ key: "srv:mev_rhino", name: "Rhino", state: "destroyed", hull: 0 });
    expect(s.inVehicle).toBeNull();
  });

  it("follows the commander out on foot and back into the SRV", () => {
    const s = loaded();
    play(s, [
      { event: "LaunchSRV", SRVType: "testbuggy", ID: 9, PlayerControlled: true },
      { event: "Disembark", SRV: true, OnPlanet: true },
    ]);
    expect(s.inVehicle).toBeNull();
    play(s, [
      { event: "Embark", SRV: true, OnPlanet: true },
      { event: "HullDamage", Health: 0.7, PlayerPilot: true },
    ]);
    expect(s.inVehicle).toBe("srv:testbuggy");
    expect(s.vehicles[0]!.hull).toBe(0.7);
    expect(s.hull).toBe(1);
  });
});

describe("fighters and the Nomad", () => {
  it("reads the Nomad from the Rhino update's unnamed field, and its hits from Fighter: true", () => {
    const s = loaded();
    play(s, [
      { timestamp: "2026-09-03T11:00:00Z", event: "LaunchFighter", "": "lander01", _Localised: "Nomad", Loadout: "zero", ID: 68, PlayerControlled: true },
      { timestamp: "2026-09-03T11:05:00Z", event: "HullDamage", Health: 0.55, PlayerPilot: true, Fighter: true },
    ]);
    expect(s.vehicles[0]).toMatchObject({ key: "slv:lander01", kind: "slv", name: "Nomad", state: "out", hull: 0.55, pilot: "you" });
    expect(s.hull).toBe(1);
    play(s, [{ event: "DockFighter", ID: 68 }]);
    expect(s.vehicles[0]!.state).toBe("docked");
    expect(s.inVehicle).toBeNull();
  });

  it("knows a crew-flown fighter by its restock, keeps the mothership's hits on the ship, and follows a switch", () => {
    const s = loaded();
    play(s, [
      { event: "RestockVehicle", Type: "independent_fighter", Loadout: "three", Cost: 1030, Count: 1 },
      { event: "LaunchFighter", Loadout: "three", ID: 25, PlayerControlled: false },
      { event: "HullDamage", Health: 0.8, PlayerPilot: false, Fighter: true },
      { event: "HullDamage", Health: 0.9, PlayerPilot: true, Fighter: false },
    ]);
    expect(s.vehicles[0]).toMatchObject({ name: "Taipan", pilot: "crew", hull: 0.8 });
    expect(s.hull).toBe(0.9);
    expect(s.inVehicle).toBeNull();
    play(s, [
      { event: "VehicleSwitch", To: "Fighter" },
      // The ship, flown by the crew now, takes a hit: still the ship's.
      { event: "HullDamage", Health: 0.7, PlayerPilot: false, Fighter: false },
    ]);
    expect(s.inVehicle).toBe("fighter:independent_fighter");
    expect(s.hull).toBe(0.7);
    play(s, [{ event: "FighterDestroyed", ID: 25 }]);
    expect(s.vehicles[0]).toMatchObject({ state: "destroyed", hull: 0 });
    expect(s.inVehicle).toBeNull();
    play(s, [{ event: "FighterRebuilt", Loadout: "three", ID: 26 }]);
    expect(s.vehicles[0]).toMatchObject({ state: "docked", hull: 1 });
  });
});

describe("sessions and the cache", () => {
  it("puts what was out back in the hangar on a new game, repairs the hangar with the ship, and survives a cache", () => {
    const s = loaded();
    play(s, [
      { event: "LaunchSRV", SRVType: "testbuggy", ID: 9, PlayerControlled: true },
      { event: "HullDamage", Health: 0.6, PlayerPilot: true },
      { event: "LoadGame", Ship: "Krait_MkII" },
    ]);
    expect(s.inVehicle).toBeNull();
    expect(s.vehicles[0]).toMatchObject({ state: "docked", hull: 0.6 });
    const back = hydrateShipDamage(JSON.parse(JSON.stringify(s)));
    expect(back.vehicles).toEqual(s.vehicles);
    play(back, [{ event: "RepairAll", Cost: 100 }]);
    expect(back.vehicles[0]!.hull).toBe(1);
    // A cache from 1.3.0 has no vehicles at all.
    expect(hydrateShipDamage({ ship: "asp", parts: [] }).vehicles).toEqual([]);
  });
});

const html = (s: ShipDamageState) => renderToStaticMarkup(ship.render({ shipDamage: s } as unknown as HudSnapshot) as ReactElement);

describe("the Ship section", () => {
  it("draws the vehicle the commander is in, with the ship as a row", () => {
    const s = loaded();
    play(s, [
      { event: "LaunchSRV", SRVType: "mev_rhino", ID: 41, PlayerControlled: true },
      { event: "HullDamage", Health: 0.42, PlayerPilot: true },
    ]);
    const h = html(s);
    expect(h).toContain("Rhino");
    expect(h).toContain("hull 42%");
    expect(h).toContain("ship--bad");
    expect(h).toContain("hull 100%");
    expect(ship.relevant!({ shipDamage: s } as unknown as HudSnapshot)).toBe(true);
    expect(ship.state!({ shipDamage: s } as unknown as HudSnapshot)).toBe("warn");
  });

  it("lists a vehicle out under the ship, and leaves a whole one in the hangar out", () => {
    const s = loaded();
    play(s, [
      { event: "RestockVehicle", Type: "federation_fighter", Loadout: "one", Count: 1 },
      { event: "LaunchFighter", Loadout: "one", ID: 7, PlayerControlled: false },
    ]);
    expect(html(s)).toContain("F63 Condor");
    expect(html(s)).toContain("out · crew");
    play(s, [{ event: "DockFighter", ID: 7 }]);
    expect(html(s)).not.toContain("F63 Condor");
  });
});
