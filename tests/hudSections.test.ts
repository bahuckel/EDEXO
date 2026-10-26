/**
 * One list of HUD section names (shared/hudSections.ts, audit 2026-10-22). The client, the server's prefs check
 * and the CLI read it, and since 1.3.1 the launcher too (built by Vite; it kept a copy before).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HUD_SECTIONS } from "../src/cli/dispatch.js";
import { sanitizeHudPrefs } from "../src/server/hudPrefsSanitize.js";
import { HUD_SECTION_KEYS, isHudSectionKey } from "../src/shared/hudSections.js";

describe("the HUD's section names", () => {
  it("are the CLI's list", () => {
    expect(HUD_SECTIONS).toEqual([...HUD_SECTION_KEYS]);
  });

  it("are the launcher's list: it imports this one, and its swatches the HUD's colours", () => {
    const overlays = readFileSync(path.resolve(__dirname, "../src/client/launcher/hudOverlays.js"), "utf8");
    expect(overlays).toContain('import { HUD_SECTION_KEYS } from "@shared/hudSections";');
    expect(overlays).toMatch(/var HUD_SECTION_ORDER = HUD_SECTION_KEYS\.slice\(\);/);
    expect(overlays).not.toMatch(/HUD_SECTION_ORDER = \[/);
    const settings = readFileSync(path.resolve(__dirname, "../src/client/launcher/hudSettings.js"), "utf8");
    expect(settings).toContain('import { PRESETS } from "../hud/presets";');
    expect(settings).not.toMatch(/orange: "#/);
  });

  it("are all a saved HUD layout may hold", () => {
    for (const k of HUD_SECTION_KEYS) expect(isHudSectionKey(k), k).toBe(true);
    for (const v of ["radio", "toString", "", null, 3]) expect(isHudSectionKey(v), String(v)).toBe(false);
    expect(sanitizeHudPrefs({ sections: [...HUD_SECTION_KEYS, "colonize", "radio"] })).toEqual({
      sections: [...HUD_SECTION_KEYS],
    });
  });
});

describe("sanitizeHudPrefs", () => {
  it("answers null for anything but an object, as setHudPrefs did", () => {
    for (const v of [null, undefined, "compact", 3, false]) expect(sanitizeHudPrefs(v)).toBeNull();
  });

  it("clamps the numbers", () => {
    expect(sanitizeHudPrefs({ scale: 9, opacity: 0, tilt: -90, slant: 40 })).toEqual({
      scale: 2,
      opacity: 0.1,
      tilt: -35,
      slant: 15,
    });
  });
});
