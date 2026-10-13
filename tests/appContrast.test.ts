/**
 * Readable colours (owner, 2026-10-13: "If I set the color of the UI to a dark one, all text becomes invisible …
 * checkmarks and other elements are also hard to see"): a dark accent is lifted until it reads on the page.
 */
import { describe, expect, it } from "vitest";
import {
  APP_THEME_PRESETS,
  MIN_ACCENT_CONTRAST,
  contrastRatio,
  readableAccent,
  resolveAppTheme,
  textTokens,
} from "../src/shared/appThemes.js";

const PAGE: [number, number, number] = [7, 6, 10];
const rgb = (s: string) => s.split(",").map((v) => Number(v.trim())) as [number, number, number];

describe("readable accent", () => {
  it("leaves a colour that already reads, and every preset, as it is", () => {
    expect(readableAccent([255, 138, 31])).toEqual({ rgb: [255, 138, 31], lifted: false });
    for (const p of APP_THEME_PRESETS)
      expect(contrastRatio(rgb(p.rgb), PAGE)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
  });

  it("lifts a dark navy, a dark red and black just until they read, keeping the hue", () => {
    for (const c of [
      [20, 24, 70],
      [90, 10, 10],
      [0, 0, 0],
    ] as [number, number, number][]) {
      const r = readableAccent(c);
      expect(r.lifted).toBe(true);
      expect(contrastRatio(r.rgb, PAGE)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
      // Not lifted further than needed: 5 points of lightness less would not read.
      expect(contrastRatio(r.rgb, PAGE)).toBeLessThan(MIN_ACCENT_CONTRAST + 1.5);
    }
    const navy = readableAccent([20, 24, 70]).rgb;
    expect(navy[2]).toBeGreaterThan(navy[0]); // still blue
  });

  it("a custom scheme is drawn lifted unless asked not to", () => {
    expect(resolveAppTheme({ custom: "#141846" })).toMatchObject({ key: "custom", lifted: true });
    expect(resolveAppTheme({ custom: "#141846" }, { readable: false })).toMatchObject({
      rgb: "20, 24, 70",
      lifted: false,
    });
  });

  it("a text colour of one's own gives the dimmer shades too", () => {
    const t = textTokens("#ffffff")!;
    expect(t["--text"]).toBe("#ffffff");
    expect(t["--peach-rgb"]).toBe("255, 255, 255");
    expect(t["--text-dim"]! < t["--text"]!).toBe(true);
    expect(textTokens("nope")).toBeNull();
  });
});
