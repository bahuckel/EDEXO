/**
 * The data feeder's switch (owner, 2026-10-18: "the feeder is no longer needed… hide it in the options, disabled by
 * default"): off on a fresh profile, and kept across a restart once turned on (server/userPrefsFile.ts).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { applyPersistedUserPrefs, persistUserPreferences, tryReadUserPrefs } from "../src/server/userPrefsFile.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("feeder setting", () => {
  it("is off by default and survives a save and a fresh start", () => {
    const fresh = new GameStateStore();
    expect(fresh.feederEnabled).toBe(false);
    const dir = mkdtempSync(path.join(tmpdir(), "edexo-prefs-"));
    dirs.push(dir);
    const file = path.join(dir, "edexo-compare-user-settings.json");
    fresh.setFeederEnabled(true);
    persistUserPreferences(fresh, file);
    const next = new GameStateStore();
    applyPersistedUserPrefs(next, tryReadUserPrefs(file)!);
    expect(next.feederEnabled).toBe(true);
  });
});
