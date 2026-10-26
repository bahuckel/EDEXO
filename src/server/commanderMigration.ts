/*
  The commander for this run, and the move of the files from before 1.3.1 into a commander's folder (per-commander
  profiles; plan docs/plan-25102026-commander-profiles.md).

  Before 1.3.1 every commander's data shared the app data folder. A start with a commander moves any per-commander
  file (paths.ts PER_COMMANDER_ENTRIES) still at the top of the app data folder into the folder of the commander that
  start picks — the newest journal's, normally the one who played last, which for a player with one account is simply
  theirs. Other commanders start empty and fill from their own journals.

  Not once only: 1.3.1 never writes these names at the top, so one found there came from before 1.3.1, from a backup
  made before it and restored (a restore puts files back where they were), or from a run whose journals named
  nobody. Where the commander's folder already has that file, its copy stays beside it as `<name>.bak-<time>`
  (backups leave `.bak-` copies out). Moved, not copied, so nothing is there twice.
*/
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { chooseCommander, setActiveCommander } from "./activeCommander.js";
import type { CommanderSummary } from "./journalCommanders.js";
import { listJournalFilesChronological } from "./journalWatcher.js";
import { commanderFolderName, PER_COMMANDER_ENTRIES, resolveUserSettingsJsonPath } from "./paths.js";

/** Move the per-commander files at the top of the app data folder into `fid`'s folder; the names moved. */
export function migrateIntoCommanderFolder(appDataDir: string, fid: string, now = new Date()): string[] {
  const into = join(appDataDir, "commanders", commanderFolderName(fid));
  const moved: string[] = [];
  for (const name of PER_COMMANDER_ENTRIES) {
    const from = join(appDataDir, name);
    if (!existsSync(from)) continue;
    try {
      mkdirSync(into, { recursive: true });
      const to = join(into, name);
      if (existsSync(to)) renameSync(to, `${to}.bak-${now.toISOString().replace(/[:.]/g, "-")}`);
      renameSync(from, to);
      moved.push(name);
    } catch (e) {
      // Left where it was: that commander starts without it (a file can be locked by a sync tool or a scanner).
      console.warn(`commanders: could not move ${name}:`, e);
    }
  }
  return moved;
}

/**
 * Pick this run's commander from every journal in `journalDir` (EDEXO_COMMANDER first, else the newest journal's),
 * make it active, and move the files from before 1.3.1 into its folder if that was never done.
 */
export async function pickCommanderForRun(journalDir: string): Promise<CommanderSummary | null> {
  const all = await listJournalFilesChronological(journalDir, { minFileStartUtcMs: null, allCommanders: true });
  const c = chooseCommander(all, process.env.EDEXO_COMMANDER);
  setActiveCommander(c ? { fid: c.fid, name: c.name } : null);
  if (c) {
    const moved = migrateIntoCommanderFolder(dirname(resolveUserSettingsJsonPath()), c.fid);
    if (moved.length) console.log(`commanders: moved ${moved.length} file(s) into CMDR ${c.name}'s folder`);
  }
  return c;
}
