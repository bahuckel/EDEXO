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

    // A power cut between rename and the disk's own flush leaves an empty file under the real name (plan 2.1).
    it("flushes the temporary file to disk before the rename", () => {
      const f = join(dir, "a.json");
      const order: string[] = [];
      const realFsync = fs.fsyncSync;
      fs.fsyncSync = ((fd: number) => {
        order.push("fsync");
        return realFsync(fd);
      }) as typeof fs.fsyncSync;
      fs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
        order.push("rename");
        return realRename(from, to);
      }) as typeof fs.renameSync;
      syncBuiltinESMExports();
      try {
        write(f, "new");
      } finally {
        fs.fsyncSync = realFsync;
        syncBuiltinESMExports();
      }
      expect(order).toEqual(["fsync", "rename"]);
    });

    it("takes EBUSY and EACCES for Windows holding the file too, and gives up after five tries", () => {
      for (const code of ["EBUSY", "EACCES"]) {
        const f = join(dir, `${code}.json`);
        const calls = failRenames(1, code);
        write(f, "new");
        expect(calls(), code).toBe(2);
      }
      const calls = failRenames(99, "EPERM");
      expect(() => write(join(dir, "never.json"), "new")).toThrow();
      expect(calls()).toBe(5);
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

// The LAN key file is written owner-only through the options' mode (lanAuth.ts). Read-only is the bit Windows keeps.
describe("writeFileAtomic's mode", () => {
  it("gives the new file the mode in the options", () => {
    const f = join(dir, "ro.txt");
    writeFileAtomic(f, "x", { encoding: "utf8", mode: 0o444 });
    try {
      expect(fs.statSync(f).mode & 0o200).toBe(0);
    } finally {
      fs.chmodSync(f, 0o666);
    }
    const g = join(dir, "rw.txt");
    writeFileAtomic(g, "x", "utf8");
    expect(fs.statSync(g).mode & 0o200).not.toBe(0);
  });
});

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
