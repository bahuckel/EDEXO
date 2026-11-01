// @vitest-environment jsdom
/**
 * The Elite Style's angle pointed at the middle of the screen (owner, 2026-11-01: mirrored left and right, shallower
 * toward the middle, none in the exact middle).
 */
import { describe, expect, it } from "vitest";
import { HUD_PLACE_SNAP, hudScreenPlace } from "../src/client/hud/theme";

const SCREEN = { x: 0, y: 0, w: 1920, h: 1080 };
const at = (x: number, y: number) => hudScreenPlace({ x, y, w: 404, h: 300 }, SCREEN);

describe("where a panel is on its screen", () => {
  it("flush in the top-right corner is the angle as set; the top-left is its mirror", () => {
    expect(at(1920 - 404, 0)).toEqual({ h: 1, v: 1 });
    expect(at(0, 0)).toEqual({ h: -1, v: 1 });
  });

  it("goes shallower toward the middle and is none there, snapped within a few per cent", () => {
    const half = at((1920 - 404) / 2 + 380, 0).h;
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
    expect(at((1920 - 404) / 2, (1080 - 300) / 2)).toEqual({ h: 0, v: 0 });
    // A few pixels off the middle still counts as the middle.
    expect(at((1920 - 404) / 2 + 20, (1080 - 300) / 2 - 10)).toEqual({ h: 0, v: 0 });
    expect(HUD_PLACE_SNAP).toBeGreaterThan(0);
  });

  it("turns the other way up and down below the middle, and keeps to the screen it is on", () => {
    expect(at(1920 - 404, 1080 - 300)).toEqual({ h: 1, v: -1 });
    // On a second screen to the right: its own middle.
    const second = hudScreenPlace({ x: 1920 + 100, y: 0, w: 404, h: 300 }, { x: 1920, y: 0, w: 2560, h: 1440 });
    expect(second.h).toBeLessThan(0);
    expect(second.v).toBe(1);
  });
});
