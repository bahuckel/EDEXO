/**
 * Each ship seen from above for the HUD's Ship section (1.3.0): every ship the app knows has an outline, its module
 * positions use Loadout slot names and sit on it, and the section draws a known ship with its own shape and an unknown
 * one with the old dart.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KNOWN_SHIPS } from "../src/shared/fsdWear";
import { SHIP_OUTLINES } from "../src/shared/shipOutlines";
import { shipDamageLoadout, newShipDamage } from "../src/shared/shipDamage";
import { ship } from "../src/client/hud/sections/ship";
import type { HudSnapshot } from "../src/client/hud/types";

const SLOT = /^(?:(?:Huge|Large|Medium|Small|Tiny)Hardpoint\d+|Slot\d\d|MainEngines|FrameShiftDrive|PowerPlant|PowerDistributor|LifeSupport|Radar|FuelTank)$/;

describe("SHIP_OUTLINES", () => {
  it("has an outline for every known ship and none for an unknown id", () => {
    expect([...KNOWN_SHIPS].filter((s) => !SHIP_OUTLINES[s])).toEqual([]);
    expect(Object.keys(SHIP_OUTLINES).filter((s) => !KNOWN_SHIPS.has(s))).toEqual([]);
  });

  it("runs each outline nose to tail on the centre line, right half only", () => {
    for (const [id, o] of Object.entries(SHIP_OUTLINES)) {
      expect(o.half.length % 2, id).toBe(0);
      expect(o.half.length, id).toBeGreaterThanOrEqual(12);
      const xs = o.half.filter((_, i) => i % 2 === 0);
      const ys = o.half.filter((_, i) => i % 2 === 1);
      expect(xs[0], id).toBe(0);
      expect(xs[xs.length - 1], id).toBe(0);
      expect(Math.min(...xs), id).toBeGreaterThanOrEqual(0);
      expect(Math.min(...ys), id).toBeGreaterThanOrEqual(-1);
      expect(Math.max(...ys), id).toBeLessThanOrEqual(101);
    }
  });

  it("names each position by its Loadout slot and keeps it near the ship", () => {
    for (const [id, o] of Object.entries(SHIP_OUTLINES)) {
      expect(o.slots.MainEngines, `${id} engines`).toBeDefined();
      const span = Math.max(...o.half.filter((_, i) => i % 2 === 0));
      for (const [slot, [x, y]] of Object.entries(o.slots)) {
        expect(slot, id).toMatch(SLOT);
        expect(Math.abs(x), `${id} ${slot}`).toBeLessThanOrEqual(span + 3);
        expect(y, `${id} ${slot}`).toBeGreaterThanOrEqual(-2);
        expect(y, `${id} ${slot}`).toBeLessThanOrEqual(100);
      }
    }
  });
});

const draw = (shipId: string) => {
  const s = newShipDamage();
  shipDamageLoadout(s, {
    event: "Loadout",
    timestamp: "2026-10-24T10:00:00Z",
    Ship: shipId,
    HullHealth: 0.8,
    Modules: [
      { Slot: "MainEngines", Item: "int_engine_size4_class5", Health: 0.3 },
      { Slot: "MediumHardpoint1", Item: "hpt_pulselaser_fixed_medium", Health: 1 },
      { Slot: "TinyHardpoint1", Item: "hpt_heatsinklauncher_turret_tiny", Health: 0.6 },
      { Slot: "Slot01_Size6", Item: "int_fuelscoop_size6_class5", Health: 0.9 },
    ],
  });
  return renderToStaticMarkup(ship.render({ shipDamage: s } as unknown as HudSnapshot) as ReactElement);
};

describe("Ship section outline", () => {
  it("draws a known ship's own curved outline with its parts in place", () => {
    const html = draw("Anaconda");
    expect(html).toMatch(/class="ship-hull[^"]*" d="M[^"]* C/);
    expect(html.match(/ship-part/g)?.length).toBe(4);
    expect(html).toContain("ship--bad");
    expect(html).not.toContain("ship-block");
  });

  it("keeps the internals as one block on a ship whose data does not place them", () => {
    const html = draw("Asp");
    expect(html).toMatch(/class="ship-hull[^"]*" d="M[^"]* C/);
    expect(html.match(/ship-part/g)?.length).toBe(4);
    expect(html).toContain("ship-block");
  });

  it("falls back to the dart for a ship it does not know", () => {
    const html = draw("some_future_ship");
    expect(html).toContain("ship-hull");
    expect(html).not.toMatch(/class="ship-hull[^"]*" d="M[^"]* C/);
  });
});
