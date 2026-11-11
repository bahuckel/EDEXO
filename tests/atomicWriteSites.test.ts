/**
 * Every file the app writes goes in whole or not at all (review A3, 2026-10-10; leftovers 2026-11-09; review
 * 2026-11-10 C6, plan 1.3): through writeFileAtomic (src/server/atomicWrite.ts, electron/atomicWrite.cjs), which
 * flushes the temporary file before the rename and retries the rename while Windows holds the file. A bare temporary
 * file and rename was accepted here until 2026-11-10 and eleven savers used one (no flush: a power cut left an empty
 * bookmarks or foot-catalog file). Now any `writeFileSync`, `appendFileSync`, `createWriteStream` or `renameSync` under
 * src/server, src/feeder or electron fails unless its file is named below with the reason.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const DIRS = ["src/server", "src/feeder", "electron"];

/** Files whose raw writes are meant, and why. */
const RAW: Record<string, string> = {
  "src/server/atomicWrite.ts": "the helper itself",
  "electron/atomicWrite.cjs": "the helper itself",
  "src/server/devEntry.ts": "the crash log, written as the process dies",
  "src/server/startupChecks.ts": "a log line",
  "src/server/statisticsScan.ts": "emptying a stale cache file (the empty file is read as no cache)",
  "src/server/routes/settingsRoutes.ts": "the feeder inbox: a temporary name there would be picked up as a route",
  "src/server/exoOutlierLog.ts": "appends to a log",
  "src/server/exobioUnknown.ts": "appends to a log",
  "src/server/gggResearch.ts": "appends to a log",
  "src/server/scanLocateLog.ts": "appends to a log",
  "src/server/predictionAuditLog.ts": "appends to the change log; an unreadable log moved aside",
  "electron/diag.cjs": "the startup diagnostics log and a profile dump",
  "electron/hudWindows.cjs": "appends to the HUD log",
  "src/server/appUpdater.ts": "a download streamed to .part, checked, then renamed",
  "src/server/finderIndex.ts": "a download streamed to .part, then renamed",
  "src/server/galaxyIndexFiles.ts": "a download streamed to .part, then renamed",
  "src/server/jumponiumIndex.ts": "a download streamed to .part, then renamed",
  "src/server/neutronIndex.ts": "a download streamed to .part, then renamed",
  "src/server/stationsIndex.ts": "a download streamed to .part, then renamed",
  "src/server/backupZip.ts": "the backup zip, streamed",
  "src/server/backup.ts": "a restore moves files into place",
  "src/server/commanderMigration.ts": "a one-time move of files into a commander folder",
  "src/feeder/paths.ts": "moves an inbox file to the processed folder",
  "src/server/journalMergeCache.ts": "two files renamed in order; a miss rebuilds the cache (combined plan 1.1c)",
  "electron/updater.cjs": "moves the staged update into place",
  "electron/launcherIpc.cjs": "an export to the file the commander picked in a save dialog",
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|cjs|mts)$/.test(p) ? [p] : [];
  });
}

describe("file writes", () => {
  it("go through writeFileAtomic, or are named with a reason", () => {
    const raw: string[] = [];
    const used = new Set<string>();
    for (const f of DIRS.flatMap((d) => files(join(ROOT, d)))) {
      const name = relative(ROOT, f).replace(/\\/g, "/");
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (!/\b(writeFileSync|appendFileSync|createWriteStream|renameSync)\(/.test(line)) return;
          if (RAW[name]) used.add(name);
          else raw.push(`${name}:${i + 1}`);
        });
    }
    expect(raw).toEqual([]);
    // A reason for a file that no longer writes raw is stale.
    expect(Object.keys(RAW).filter((n) => !used.has(n))).toEqual([]);
  });
});
