/**
 * Edges of atomicWrite.ts that survived Stryker (2026-11-24, 73.6 %): the growing wait between busy renames, an
 * error that is not an object, options given as null, and a file to set aside that is already gone.
 */
import fs, { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renameWithRetry, setAsideUnreadable, writeFileAtomic } from "../src/server/atomicWrite.js";

const realRename = fs.renameSync;
let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "edexo-atomic-edges-"));
});
afterEach(() => {
  fs.renameSync = realRename;
  syncBuiltinESMExports();
  rmSync(dir, { recursive: true, force: true });
});

/** The next `n` renames throw `thrown`, then renames work again. */
function failRenames(n: number, thrown: () => unknown): void {
  let calls = 0;
  fs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
    if (++calls <= n) throw thrown();
    return realRename(from, to);
  }) as typeof fs.renameSync;
  syncBuiltinESMExports();
}

describe("renameWithRetry", () => {
  it("waits 40 ms more before each new try", () => {
    const f = join(dir, "a.json");
    writeFileSync(f, "x", "utf8");
    failRenames(3, () => Object.assign(new Error("EPERM"), { code: "EPERM" }));
    const t0 = performance.now();
    renameWithRetry(f, join(dir, "b.json"));
    // 40 + 80 + 120 ms; a flat or shrinking wait is well under 200.
    expect(performance.now() - t0).toBeGreaterThanOrEqual(200);
    expect(readFileSync(join(dir, "b.json"), "utf8")).toBe("x");
  });

  it("throws what the rename threw when that is not an error object", () => {
    failRenames(1, () => null);
    let caught: unknown = "nothing";
    try {
      renameWithRetry(join(dir, "a"), join(dir, "b"));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeNull();
  });
});

describe("writeFileAtomic", () => {
  it("takes options given as null", () => {
    const f = join(dir, "n.json");
    writeFileAtomic(f, "new", null);
    expect(readFileSync(f, "utf8")).toBe("new");
  });
});

describe("setAsideUnreadable", () => {
  it("answers null for a file that is already gone", () => {
    expect(setAsideUnreadable(join(dir, "missing.json"))).toBeNull();
  });
});
