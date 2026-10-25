/*
  The live `Status.json` read for the running app (split out of edexoBootstrap.ts, discuss item 30, 1.3.1): the
  directory watch, the interval backstop at the commander's poll rate, and re-arming either without losing the
  tick. The tick itself is the bootstrap's: it reads the store and pushes.
*/
import { watch } from "node:fs";
import { clampStatusPollMs } from "../shared/pollRates.js";
import type { GameStateStore } from "./gameState.js";
import { guarded } from "./guarded.js";

/**
 * `Status.json`, driven by the game's own writes instead of by the clock.
 *
 * A poll can only ever be a guess at when the game wrote: slower and the HUD lags, faster and it
 * re-reads bytes that have not changed. Watching the directory turns it round — the read happens
 * because the game wrote, and lands within milliseconds of it.
 *
 * It does not make the data fast, because the data is not fast. measured on 2026-09-18 while running, jumping and turning on foot: the file is rewritten about 0.7 times a second and its *contents* change about 0.33 times a second, median gap 3.0 s, fastest 2.0 s.
 * So this is about *latency*, not rate: it removes the delay we were adding, and nothing more.
 * Anything smoother than 0.33 Hz on screen has to be predicted, not polled for.
 *
 * The **directory** rather than the file: a watch on the file itself dies if the game ever
 * replaces it rather than rewriting in place, and comes back attached to an inode nobody writes
 * to again, which is a HUD that silently stops updating.
 *
 * The interval stays as a backstop. `fs.watch` is best-effort on Windows — it can miss events
 * under load, and it does not exist at all on some network paths — so the poll is what guarantees
 * the HUD keeps moving; the watch is what makes it prompt.
 */
export function createStatusPoller({ store, getJournalDir }: { store: GameStateStore; getJournalDir: () => string }) {
  let footStatusPollTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * The `Status.json` tick, kept as a value so the interval can be re-armed at a new rate without
   * rebuilding the closure it lives in (it owns the jump-key memo, which must survive a retime).
   */
  let footStatusTick: (() => void) | null = null;
  /** The interval the armed timer was created with; see {@link armFootStatusPoll}. */
  let footStatusArmedMs = 0;
  let footStatusFsWatcher: ReturnType<typeof watch> | null = null;
  /** Coalesces the duplicate events one write produces, and caps the work a busy file can cause. */
  let lastFootStatusRunAt = 0;
  const FOOT_STATUS_MIN_GAP_MS = 40;

  function runFootStatusTickFromWatch(): void {
    if (footStatusTick == null) return;
    const now = Date.now();
    if (now - lastFootStatusRunAt < FOOT_STATUS_MIN_GAP_MS) return;
    lastFootStatusRunAt = now;
    try {
      footStatusTick();
    } catch (e) {
      console.error("[edexo-compare] Status.json watch tick:", e);
    }
  }

  function startFootStatusWatch(): void {
    footStatusFsWatcher?.close();
    footStatusFsWatcher = null;
    try {
      footStatusFsWatcher = watch(getJournalDir(), { persistent: false }, (_ev, name) => {
        if (name && String(name).toLowerCase() !== "status.json") return;
        runFootStatusTickFromWatch();
      });
    } catch {
      /* no watch on this path; the interval below is still doing the job */
    }
  }

  /** (Re-)arm the `Status.json` poll at `store.statusPollMs`. A no-op when nothing moved. */
  function armFootStatusPoll(force = false): void {
    if (footStatusTick == null) return;
    const next = clampStatusPollMs(store.statusPollMs);
    if (!force && footStatusPollTimer != null && next === footStatusArmedMs) return;
    if (footStatusPollTimer != null) {
      clearInterval(footStatusPollTimer);
      footStatusPollTimer = null;
    }
    footStatusArmedMs = next;
    const tick = footStatusTick;
    footStatusPollTimer = setInterval(
      guarded("Status.json poll", () => tick()),
      next,
    );
  }

  return {
    /** The tick to run; the running interval is stopped until the next {@link armFootStatusPoll}. */
    setTick(tick: () => void): void {
      if (footStatusPollTimer != null) {
        clearInterval(footStatusPollTimer);
        footStatusPollTimer = null;
      }
      footStatusTick = tick;
    },
    arm: armFootStatusPoll,
    watch: startFootStatusWatch,
    /** Counts as a run, so a watch event straight after does not repeat it. */
    noteRan(): void {
      lastFootStatusRunAt = Date.now();
    },
    stop(): void {
      if (footStatusPollTimer != null) {
        clearInterval(footStatusPollTimer);
        footStatusPollTimer = null;
      }
      footStatusFsWatcher?.close();
      footStatusFsWatcher = null;
    },
  };
}
