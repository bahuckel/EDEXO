/**
 * The ship's damage part by part (discuss item 32): Loadout sets it, HullDamage keeps the hull live, the AFMU and
 * repairs mend what they name, a swap forgets it.
 */
import { describe, expect, it } from "vitest";
import {
  healthTier,
  newShipDamage,
  partOf,
  shipDamageAfmu,
  shipDamageForget,
  shipDamageHull,
  shipDamageLoadout,
  shipDamageRepair,
} from "../src/shared/shipDamage";

const loadout = {
  event: "Loadout",
  timestamp: "2026-10-23T10:00:00Z",
  Ship: "asp",
  ShipName: "Long Walk",
  ShipIdent: "FA-01",
  HullHealth: 0.92,
  Modules: [
    { Slot: "PowerPlant", Item: "int_powerplant_size4_class5", Health: 0.98 },
    { Slot: "FrameShiftDrive", Item: "int_hyperdrive_overcharge_size5_class5", Health: 0.74 },
    { Slot: "MediumHardpoint1", Item: "hpt_pulselaser_fixed_medium", Health: 1 },
    { Slot: "TinyHardpoint1", Item: "hpt_heatsinklauncher_turret_tiny", Health: 0.4 },
    { Slot: "Slot01_Size6", Item: "int_fuelscoop_size6_class5", Health: 0.9 },
    { Slot: "PaintJob", Item: "paintjob_asp_default" },
    { Slot: "PlanetaryApproachSuite", Item: "int_planetapproachsuite_advanced" },
  ],
};

describe("partOf", () => {
  it("names core modules with their rating, weapons with their size, and leaves cosmetics out", () => {
    expect(partOf("FrameShiftDrive", "int_hyperdrive_overcharge_size5_class5")).toEqual({ group: "core", label: "FSD 5A" });
    expect(partOf("MediumHardpoint1", "hpt_pulselaser_fixed_medium")).toEqual({ group: "hardpoint", label: "Pulse laser (M)" });
    expect(partOf("TinyHardpoint1", "hpt_heatsinklauncher_turret_tiny")).toEqual({ group: "utility", label: "Heat sink" });
    expect(partOf("Slot01_Size6", "int_fuelscoop_size6_class5")).toEqual({ group: "optional", label: "Fuel scoop 6A" });
    expect(partOf("PaintJob", "paintjob_asp_default")).toBeNull();
  });
});

describe("the ship's damage", () => {
  it("comes from the Loadout, the hull live from HullDamage, and only the commander's own ship", () => {
    const s = newShipDamage();
    shipDamageLoadout(s, loadout);
    expect(s).toMatchObject({ ship: "asp", shipName: "Long Walk", hull: 0.92 });
    expect(s.parts.map((p) => [p.label, p.health])).toEqual([
      ["Power plant 4A", 0.98],
      ["FSD 5A", 0.74],
      ["Pulse laser (M)", 1],
      ["Heat sink", 0.4],
      ["Fuel scoop 6A", 0.9],
    ]);
    shipDamageHull(s, { Health: 0.61, PlayerPilot: true, Fighter: false, timestamp: "2026-10-23T10:05:00Z" });
    shipDamageHull(s, { Health: 0.2, PlayerPilot: true, Fighter: true });
    expect(s.hull).toBe(0.61);
  });

  it("mends what the AFMU and a repair name, everything on RepairAll, and forgets on a swap", () => {
    const s = newShipDamage();
    shipDamageLoadout(s, loadout);
    shipDamageAfmu(s, { Module: "$int_hyperdrive_overcharge_size5_class5_name;", Health: 0.95 });
    expect(s.parts.find((p) => p.group === "core" && p.label.startsWith("FSD"))!.health).toBe(0.95);
    shipDamageRepair(s, { event: "Repair", Items: ["hpt_heatsinklauncher_turret_tiny", "Hull"] });
    expect(s.parts.find((p) => p.group === "utility")!.health).toBe(1);
    expect(s.hull).toBe(1);
    shipDamageRepair(s, { event: "RepairAll" });
    expect(s.parts.every((p) => p.health === 1)).toBe(true);
    shipDamageForget(s);
    expect(s).toEqual(newShipDamage());
  });

  it("tiers health for the colours", () => {
    expect([healthTier(0.9), healthTier(0.7), healthTier(0.3), healthTier(null)]).toEqual(["ok", "warn", "bad", "unknown"]);
  });
});
