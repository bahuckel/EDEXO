/*
  Who the game is playing, and every commander the journals name (per-commander profiles, 1.3.1), for the launcher's
  dropdown, the app's "Logged in as another commander" line and its Switch / Keep pop-up. The journal folder is
  listed every few seconds (heads are read once per file, journalCommanders.ts); a change pushes.
*/
import type { CommandersDTO, CommanderRefDTO } from "../shared/types.js";
import { activeCommander } from "./activeCommander.js";
import { getHudBridge } from "./hudBridge.js";
import { gameCommander, listJournalCommanders } from "./journalCommanders.js";
import { listJournalFilesChronological } from "./journalWatcher.js";

const WATCH_MS = 3000;

export function createCommanderWatch({ getJournalDir, onChange }: { getJournalDir: () => string; onChange: () => void }) {
  let list: CommandersDTO["list"] = [];
  let game: CommanderRefDTO | null = null;
  let key = "";

  async function refresh(): Promise<void> {
    const all = await listJournalFilesChronological(getJournalDir(), { minFileStartUtcMs: null, allCommanders: true });
    list = listJournalCommanders(all).map((c) => ({ fid: c.fid, name: c.name, files: c.files }));
    const g = gameCommander(all);
    game = g ? { fid: g.fid, name: g.name } : null;
    const next = `${game?.fid ?? ""}|${list.map((c) => `${c.fid}:${c.name}`).join(",")}`;
    if (next !== key) {
      const first = key === "";
      key = next;
      if (!first) onChange();
    }
  }

  void refresh().catch(() => {});
  const timer = setInterval(() => void refresh().catch(() => {}), WATCH_MS);
  timer.unref?.();

  return {
    state(): CommandersDTO {
      const a = activeCommander();
      return {
        active: a ? { fid: a.fid, name: a.name } : null,
        game,
        list,
        canSwitch: typeof getHudBridge()?.switchCommander === "function",
      };
    },
    /** The game is playing a commander other than this run's: its live files are not ours (Keep). */
    gameIsAnotherCommander(): boolean {
      const a = activeCommander();
      return !!a && !!game && game.fid !== a.fid;
    },
    refresh,
    stop(): void {
      clearInterval(timer);
    },
  };
}
