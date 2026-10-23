/**
 * One list of HUD section names (shared/hudSections.ts, audit 2026-10-22). The client, the server's prefs check
 * and the CLI read it; public/launcher.js cannot import it, so its copy is held to it here.
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

  it("are the launcher's list, in the same order", () => {
    const src = readFileSync(path.resolve(__dirname, "../public/launcher.js"), "utf8");
    const m = src.match(/var HUD_SECTION_ORDER = (\[[^\]]*\]);/);
    expect(m, "HUD_SECTION_ORDER in public/launcher.js").not.toBeNull();
    expect(JSON.parse(m![1]!)).toEqual([...HUD_SECTION_KEYS]);
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
