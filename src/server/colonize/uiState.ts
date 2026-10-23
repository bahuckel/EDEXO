/**
 * `colonize/ui-state.json`: the Colonize window's settings and progress (1.3.0 phase 5; the keys are in
 * shared/colonize/uiStateKeys.ts). One copy on the server, so the app window, a browser tab and a restart agree; the
 * window keeps a localStorage copy for its first paint and writes through here.
 *
 * Writes are batched (a ticked line saves within a moment, a burst of ticks once) and whole-or-nothing
 * (atomicWrite.ts). A file that cannot be read starts empty; the window then uploads what its browser still has.
 */
import { copyFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "../atomicWrite.js";
import { resolveColonizeDataDir } from "../paths.js";
import { cleanUiStateSet, type ColonizeSyncedKey, type ColonizeUiStateSet } from "../../shared/colonize/uiStateKeys";

const FILE = "ui-state.json";
const WRITE_DELAY_MS = 300;

export class ColonizeUiState {
  private values: Partial<Record<ColonizeSyncedKey, string>> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Whether any window ever saved here. Until then a window uploads what its browser holds (settings from before the
   * server kept them); after, the server's copy wins, and a key it lacks was cleared, not forgotten.
   */
  seeded = false;

  constructor(private readonly file: string) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return; // none yet
    }
    try {
      const j = JSON.parse(text) as { values?: unknown };
      this.seeded = true;
      for (const [k, v] of Object.entries(cleanUiStateSet(j.values))) if (typeof v === "string") this.values[k as ColonizeSyncedKey] = v;
    } catch {
      // Unreadable: start empty, but keep a copy first (the plan's ticks and the hub pins live only here).
      try {
        copyFileSync(file, `${file}.bak-corrupt`);
      } catch {
        /* the copy failed: start empty anyway */
      }
    }
  }

  all(): Partial<Record<ColonizeSyncedKey, string>> {
    return { ...this.values };
  }

  /** Stores what may be stored and returns what actually changed (empty when nothing did). */
  apply(raw: unknown): ColonizeUiStateSet {
    const changed: ColonizeUiStateSet = {};
    for (const [k, v] of Object.entries(cleanUiStateSet(raw)) as [ColonizeSyncedKey, string | null][]) {
      if (v === null) {
        if (!(k in this.values)) continue;
        delete this.values[k];
      } else {
        if (this.values[k] === v) continue;
        this.values[k] = v;
      }
      changed[k] = v;
    }
    if (Object.keys(changed).length) {
      this.seeded = true;
      this.schedule();
    }
    return changed;
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), WRITE_DELAY_MS);
  }

  /** Writes a pending change now (shutdown, tests). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    if (!this.timer) return;
    this.timer = null;
    try {
      writeFileAtomic(this.file, JSON.stringify({ version: 1, values: this.values }, null, 1));
    } catch (e) {
      console.error("[colonize] could not save ui-state.json:", e);
    }
  }
}

let current: ColonizeUiState | null = null;

/** The one for this user-data folder, read on first use. */
export function colonizeUiState(): ColonizeUiState {
  return (current ??= new ColonizeUiState(path.join(resolveColonizeDataDir(), FILE)));
}

/** Writes what is pending and forgets the copy (shutdown; tests, which change the user-data folder). */
export function closeColonizeUiState(): void {
  current?.flush();
  current = null;
}
