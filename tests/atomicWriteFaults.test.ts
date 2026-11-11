/**
 * The two writeFileAtomic copies under faults (review 2026-11-10 T8, plan 1.3): a rename Windows refuses for a moment
 * (antivirus, the indexer) is tried again; one that keeps failing leaves the old file and no temporary file; a file
 * that no longer reads is moved aside, never overwritten by the next save.
 *
 * The rename is made to fail by replacing `fs.renameSync` for a moment (`syncBuiltinESMExports` carries it to the ESM
 * import in atomicWrite.ts; the .cjs copy reads it from `require("fs")` at call time).
 */
import fs, { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setAsideUnreadable, writeFileAtomic } from "../src/server/atomicWrite.js";
import { createBookmarksService } from "../src/server/bookmarks.js";

const require = createRequire(import.meta.url);
const cjs = require("../electron/atomicWrite.cjs") as { writeFileAtomic: (f: string, d: string) => void };

const realRename = fs.renameSync;
let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "edexo-atomic-"));
});
afterEach(() => {
  fs.renameSync = realRename;
  syncBuiltinESMExports();
  rmSync(dir, { recursive: true, force: true });
});

/** The next `n` renames fail with `code`, then renames work again. */
function failRenames(n: number, code: string): () => number {
  let calls = 0;
  fs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
    calls++;
    if (calls <= n) throw Object.assign(new Error(code), { code });
    return realRename(from, to);
  }) as typeof fs.renameSync;
  syncBuiltinESMExports();
  return () => calls;
}

for (const [name, write] of [
  ["atomicWrite.ts", writeFileAtomic],
  ["atomicWrite.cjs", cjs.writeFileAtomic],
] as const) {
  describe(`writeFileAtomic (${name})`, () => {
    it("tries a busy rename again and gets the new file in", () => {
      const f = join(dir, "a.json");
      writeFileSync(f, "old", "utf8");
      const calls = failRenames(2, "EPERM");
      write(f, "new");
      expect(calls()).toBe(3);
      expect(readFileSync(f, "utf8")).toBe("new");
      expect(readdirSync(dir)).toEqual(["a.json"]);
    });

    it("keeps the old file and leaves no temporary file when the rename keeps failing", () => {
      const f = join(dir, "a.json");
      writeFileSync(f, "old", "utf8");
      failRenames(99, "EPERM");
      expect(() => write(f, "new")).toThrow();
      expect(readFileSync(f, "utf8")).toBe("old");
      expect(readdirSync(dir)).toEqual(["a.json"]);
    });

    it("does not retry an error that is not Windows holding the file", () => {
      const f = join(dir, "a.json");
      const calls = failRenames(99, "ENOSPC");
      expect(() => write(f, "new")).toThrow();
      expect(calls()).toBe(1);
      expect(readdirSync(dir)).toEqual([]);
    });
  });
}

describe("a file that no longer reads", () => {
  it("is moved aside with the time in its name", () => {
    const f = join(dir, "x.json");
    writeFileSync(f, "{torn", "utf8");
    const aside = setAsideUnreadable(f)!;
    expect(aside).toMatch(/x\.json\.unreadable-\d+$/);
    expect(existsSync(f)).toBe(false);
    expect(readFileSync(aside, "utf8")).toBe("{torn");
  });

  // An empty file is what a power cut leaves when the data was never flushed.
  it("is not overwritten by the next bookmark", () => {
    const f = join(dir, "bookmarks.json");
    writeFileSync(f, "", "utf8");
    const svc = createBookmarksService({ filePath: f });
    expect(svc.all()).toEqual([]);
    expect(readdirSync(dir).some((n) => n.startsWith("bookmarks.json.unreadable-"))).toBe(true);
  });
});
