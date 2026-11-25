/**
 * The HUD and screen-marker windows run sandboxed, like every other window of the app (plan 1.8, 2026-11-25).
 *
 * They were the one opt-out (`sandbox: false`) until a run of the real app showed nothing changes with it on: every
 * HUD opens in the shared host and as a window of its own, the preload's bridge is there and the pages size
 * themselves through it, and the marker's screen capture opens at full size. The preload only requires "electron"
 * and reads process.argv, both of which a sandboxed preload has.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { hudWindowOptions } = require("../electron/hudWindowOptions.cjs") as {
  hudWindowOptions: (w: number, h: number, icon: unknown, preload: string) => { webPreferences: Record<string, unknown> };
};

describe("HUD window options", () => {
  it("are sandboxed and isolated, with the preload and the HUDs' own session", () => {
    const wp = hudWindowOptions(404, 330, null, "/x/preload.cjs").webPreferences;
    expect(wp).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: "/x/preload.cjs",
      partition: "persist:hud",
    });
  });

  it("leave the preload to what a sandboxed preload has: electron and process.argv", () => {
    const src = readFileSync(path.resolve(__dirname, "../electron/preload.cjs"), "utf8");
    const required = [...src.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
    expect(required).toEqual(["electron"]);
  });
});
