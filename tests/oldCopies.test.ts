/**
 * Old copies in the data folder (discuss item 24): listed by name, biggest first; removed only when named, still an
 * old copy, and inside the folder.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isOldCopyName, isRecentRecoveryCopy, listOldCopies, removeOldCopies } from "../src/server/oldCopies.js";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-old-"));
  mkdirSync(path.join(dir, "galaxy"));
  mkdirSync(path.join(dir, "browser"));
  writeFileSync(path.join(dir, "edexo-bio-bodies.bin.before-20261010-v1"), "x".repeat(300));
  writeFileSync(path.join(dir, "edexo-predictions.json.polluted-20261009.bak"), "x".repeat(200));
  writeFileSync(path.join(dir, "galaxy", "bio-index.bin.before-20261007"), "x".repeat(100));
  writeFileSync(path.join(dir, "colonize-state.json.bak-corrupt"), "x");
  writeFileSync(path.join(dir, "edexo-predictions.json"), "keep");
  writeFileSync(path.join(dir, "edexo-backup-settings.json"), "keep");
  writeFileSync(path.join(dir, "browser", "cookies.bak"), "never looked at");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("old copies", () => {
  it("names only one-off copies", () => {
    expect(isOldCopyName("x.bin.before-20261007")).toBe(true);
    expect(isOldCopyName("x.json.bak")).toBe(true);
    expect(isOldCopyName("x.json.bak-corrupt")).toBe(true);
    expect(isOldCopyName("edexo-backup-settings.json")).toBe(false);
    expect(isOldCopyName("before-restore-notes.txt")).toBe(false);
  });

  it("lists them biggest first, skipping the browser's folder", () => {
    const { files, bytes } = listOldCopies(dir);
    expect(files.map((f) => f.path)).toEqual([
      "edexo-bio-bodies.bin.before-20261010-v1",
      "edexo-predictions.json.polluted-20261009.bak",
      "galaxy/bio-index.bin.before-20261007",
    ]);
    expect(bytes).toBe(600);
  });

  it("keeps a recovery copy made in the last 30 days: neither listed nor removed (review 2026-10-24)", () => {
    expect(listOldCopies(dir).files.some((f) => f.path.endsWith(".bak-corrupt"))).toBe(false);
    expect(removeOldCopies(["colonize-state.json.bak-corrupt"], dir).removed).toEqual([]);
    expect(existsSync(path.join(dir, "colonize-state.json.bak-corrupt"))).toBe(true);
    const day = 86_400_000;
    const now = Date.parse("2026-10-24T00:00:00Z");
    expect(isRecentRecoveryCopy("x.json.bak-corrupt", now - 29 * day, now)).toBe(true);
    expect(isRecentRecoveryCopy("x.json.bak-corrupt", now - 31 * day, now)).toBe(false);
    expect(isRecentRecoveryCopy("x.json.bak-4", now, now)).toBe(true);
    expect(isRecentRecoveryCopy("x.json.bak-unreadable", now, now)).toBe(true);
    expect(isRecentRecoveryCopy("x.bin.before-20261007", now, now)).toBe(false);
  });

  it("removes only what is named, an old copy, and inside the folder", () => {
    const out = removeOldCopies(
      ["galaxy/bio-index.bin.before-20261007", "edexo-predictions.json", "../outside.bak", "browser/cookies.bak-x"],
      dir,
    );
    expect(out.removed).toEqual(["galaxy/bio-index.bin.before-20261007"]);
    expect(out.skipped).toEqual(["edexo-predictions.json", "../outside.bak", "browser/cookies.bak-x"]);
    expect(existsSync(path.join(dir, "edexo-predictions.json"))).toBe(true);
    expect(existsSync(path.join(dir, "galaxy", "bio-index.bin.before-20261007"))).toBe(false);
  });
});
