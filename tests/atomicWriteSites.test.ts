/**
 * Every file the server writes goes in whole or not at all (review A3, 2026-10-10; leftovers 2026-11-09): through
 * writeFileAtomic (atomicWrite.ts) or a temporary file renamed over it. Nine user-data files were still written in
 * place after the first pass (the update's ready file, the auto-refresh state, the LAN key, the visited-stars import,
 * ...): a crash mid-write left half a file, read back as unreadable. A new in-place write fails here unless named
 * below with the reason.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "src", "server");

/** Files whose in-place writes are meant, and why. */
const IN_PLACE: Record<string, string> = {
  "atomicWrite.ts": "the helper itself, into its temporary file",
  "devEntry.ts": "the crash log, written as the process dies",
  "startupChecks.ts": "a log line",
  "statisticsScan.ts": "emptying a stale cache file (the empty file is read as no cache)",
  "routes/settingsRoutes.ts": "the feeder inbox: a temporary name there would be picked up as a route",
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("server file writes", () => {
  it("are atomic, or named with a reason", () => {
    const inPlace: string[] = [];
    for (const f of files(ROOT)) {
      const name = relative(ROOT, f).replace(/\\/g, "/");
      if (IN_PLACE[name]) continue;
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          // A temporary file first ("tmp", "`${path}.tmp`") is renamed over the real one by the caller.
          if (/\bwriteFileSync\(/.test(line) && !/writeFileSync\(\s*(`[^`]*\.tmp|\w*tmp\w*\b)/i.test(line))
            inPlace.push(`${name}:${i + 1}`);
        });
    }
    expect(inPlace).toEqual([]);
  });
});
