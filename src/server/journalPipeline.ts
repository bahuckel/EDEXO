/*
  The journal pipeline of the running app (split out of edexoBootstrap.ts, discuss item 30, 1.3.1): the full
  re-merge of every log (or the cache plus what is new), its boot progress and timings, and the live tail that
  follows the newest log. Restarts run one at a time and re-merges never overlap.
*/
import path from "node:path";
import type { JournalBootProgressDTO, JournalLine } from "../shared/types.js";
import type { GameStateStore } from "./gameState.js";
import {
  startJournalWatcher,
  readJournalFull,
  readJournalFromOffset,
  listJournalFilesChronological,
  type JournalLineAt,
  type JournalListFilterOpts,
  type JournalTailSeed,
  type JournalWatcherHandle,
} from "./journalWatcher.js";
import { emitJournalReread } from "./journalTap.js";
import { getCachedSpeciesDatabase } from "./snapshot.js";
import { loadOrganicSampleSessionFromDisk } from "./organicSampleSessionFile.js";
import {
  buildJournalFileManifest,
  removeJournalMergeCache,
  saveJournalMergeCache,
  tryPrepareJournalCacheLoad,
} from "./journalMergeCache.js";
import { backfillCommanderPosition } from "./commanderPositionBackfill.js";
import { journalFolderIsReadable, makeReplayLineApplier } from "./journalReplayGuards.js";

export type JournalPipelineDeps = {
  store: GameStateStore;
  projectRoot: string;
  quietConsole: boolean;
  getJournalDir: () => string;
  getJournalListFilterOpts: () => JournalListFilterOpts;
  /** A fresh live-line handler for each watcher. */
  createLiveJournalLine: () => (line: JournalLine, at: JournalLineAt) => void;
  notices: { invalidate(): void };
  unknownExobio: { offer(line: JournalLine): void };
  pushFlush: () => void;
  refreshLiveHudFromJournalDir: () => void;
  primeEddnFromNewestJournal: () => Promise<void>;
};

export function createJournalPipeline({
  store,
  projectRoot,
  quietConsole,
  getJournalDir,
  getJournalListFilterOpts,
  createLiveJournalLine,
  notices,
  unknownExobio,
  pushFlush,
  refreshLiveHudFromJournalDir,
  primeEddnFromNewestJournal,
}: JournalPipelineDeps) {
  let journalPath: string | null = null;
  let journalFilesMerged = 0;
  let journalBootProgress: JournalBootProgressDTO | null = {
    percent: 0,
    phase: "starting",
    filesDone: 0,
    filesTotal: 0,
    message: "Starting journal service…",
  };
  let watcher: JournalWatcherHandle | null = null;

  let bootMergeLastFlush = 0;
  const pushMergeProgress = () => {
    const t = Date.now();
    if (t - bootMergeLastFlush < 110) return;
    bootMergeLastFlush = t;
    pushFlush();
  };

  /*
    Boot timing (owner, 2026-09-13, "startup speed"): every phase of the journal resync is clocked
    and one console line reports them, so a slow start can be read off the log instead of guessed.
  */
  const bootClock = { t0: 0, marks: [] as Array<[string, number]>, last: 0 };
  const bootStart = (): void => {
    bootClock.t0 = performance.now();
    bootClock.last = bootClock.t0;
    bootClock.marks = [];
  };
  const bootMark = (label: string): void => {
    const now = performance.now();
    bootClock.marks.push([label, now - bootClock.last]);
    bootClock.last = now;
  };
  /** The last journal boot's path and timings, for Copy diagnostics. */
  let lastBoot: { path: string; summary: string; at: string } | null = null;
  const bootReport = (path: string): void => {
    const total = performance.now() - bootClock.t0;
    const parts = bootClock.marks.map(
      ([l, ms]) => `${l} ${ms >= 1000 ? (ms / 1000).toFixed(1) + " s" : Math.round(ms) + " ms"}`,
    );
    const summary = `${parts.join(" · ")} · total ${(total / 1000).toFixed(1)} s`;
    lastBoot = { path, summary, at: new Date().toISOString() };
    if (quietConsole) return;
    console.info(`Journal boot (${path}): ${summary}`);
  };

  /**
   * The in-flight full re-merge, so two callers can never run one at once.
   *
   * {@link resyncAllJournalFilesInner} begins with `store.resetAll()` and then spends about fifteen
   * seconds re-reading every log into that store. Two of them overlapping is not slow, it is
   * **destructive**: the second wipes what the first has built, and whichever finishes last writes
   * the remains to the cache as a complete merge. The commander's 19,000-body history came back as
   * 215 bodies and one codex species that way, recorded as all 271 files merged.
   *
   * The watcher is the usual source of a second call (see its own guard), but it is not the only
   * one — `restartJournalPipeline` and a journal-folder change call this too, and a guard that only
   * lives in the watcher would leave those free to collide with it. Callers share the running
   * promise instead of starting a rival: they all want the same thing, which is a store that has
   * finished merging.
   */
  let resyncInFlight: { inputs: string; run: Promise<JournalTailSeed | null> } | null = null;

  /** What a resync reads: the folder and the history window. A run for other inputs is not shared. */
  const resyncInputs = (): string => `${path.normalize(getJournalDir())}|${store.journalHistoryPreset}`;

  /**
   * Resolves with where the live tail must start in the newest journal: the byte the replay reached
   * (combined plan 1.1b), so the watcher neither skips nor repeats what the game wrote meanwhile.
   */
  function resyncAllJournalFiles(): Promise<JournalTailSeed | null> {
    if (resyncInFlight) {
      if (resyncInFlight.inputs === resyncInputs()) return resyncInFlight.run;
      /*
        The folder or the history window changed after the running resync listed its files (combined
        plan 1.2). Joining it would leave the store merged from the old set, and its cache saved under
        the new preset: wait for it, then run again for what is asked now.
      */
      return resyncInFlight.run.catch(() => null).then(() => resyncAllJournalFiles());
    }
    // The EDDN sender learns the session from the newest file after every re-merge: a rotation
    // replays the new file's Fileheader and LoadGame here, where the live tail never sees them.
    const run = resyncAllJournalFilesInner()
      .then(primeEddnFromNewestJournal)
      .then((): JournalTailSeed | null =>
        journalPath !== null ? { path: journalPath, size: journalSeedBytes } : null,
      )
      .then((seed) => {
        // Lines read this way never reach the live tail: followers catch up on the files themselves.
        emitJournalReread();
        return seed;
      })
      .finally(() => {
        if (resyncInFlight?.run === run) resyncInFlight = null;
      });
    resyncInFlight = { inputs: resyncInputs(), run };
    return run;
  }

  /** Let the event loop run (the launcher, the tray, HTTP) between the long steps of a start. */
  const nextTurn = (): Promise<void> => new Promise((r) => setImmediate(r));

  /** Where the live tail starts in the newest journal: the byte the last resync reached (1.1b). */
  let journalSeedBytes = 0;

  async function resyncAllJournalFilesInner(): Promise<void> {
    bootStart();
    store.resetAll();
    notices.invalidate();
    journalBootProgress = {
      percent: 4,
      phase: "listing",
      filesDone: 0,
      filesTotal: 0,
      message: "Reading Elite Dangerous journal folder…",
    };
    pushFlush();
    const files = await listJournalFilesChronological(getJournalDir(), getJournalListFilterOpts());
    bootMark(`list ${files.length} files`);
    journalFilesMerged = files.length;
    if (files.length === 0) {
      journalPath = null;
      journalBootProgress = null;
      // Only a folder that is really there and empty: a journal drive not mounted yet must not cost
      // the cache, and a full replay, at the next start (combined plan 1.2).
      if (journalFolderIsReadable(getJournalDir())) removeJournalMergeCache(projectRoot);
      refreshLiveHudFromJournalDir();
      pushFlush();
      return;
    }

    const journalDirNorm = path.normalize(getJournalDir());
    journalBootProgress = {
      percent: 12,
      phase: "listing",
      filesDone: 0,
      filesTotal: files.length,
      message: `Checking ${files.length} journal log file(s) against the cache…`,
    };
    pushFlush();
    const manifest = await buildJournalFileManifest(files);
    /*
      Where reading stopped, per file (combined plan 1.1b). The manifest's sizes are taken before the
      replay, and the newest journal can grow while it runs: the cache must record the byte the replay
      actually reached, and the live tail must start there, or lines are applied twice or never.
    */
    const consumed = new Map<string, number>();
    // One bad line must not end the merge (combined plan 1.2; journalReplayGuards.ts).
    const replayApplier = makeReplayLineApplier((line) => {
      store.apply(line);
      unknownExobio.offer(line);
    });
    const applyReplayLine = replayApplier.apply;
    const settleManifest = (): void => {
      for (let i = 0; i < files.length; i++) {
        const end = consumed.get(files[i]!);
        if (end !== undefined) manifest[i] = { ...manifest[i]!, size: end };
      }
      journalSeedBytes = manifest[manifest.length - 1]!.size;
    };
    /** The end of a replay, from the cache or from every file: tail the newest log, restore the session, push. */
    const finishReplay = (): void => {
      settleManifest();
      journalPath = files[files.length - 1]!;
      store.resetFootTravelRuntime();
      loadOrganicSampleSessionFromDisk(projectRoot, store, getCachedSpeciesDatabase());
      journalBootProgress = null;
      refreshLiveHudFromJournalDir();
      pushFlush();
    };
    bootMark("manifest");
    const cacheResult =
      process.env.EDEXO_DISABLE_JOURNAL_CACHE === "1"
        ? { hit: false as const }
        : await tryPrepareJournalCacheLoad(
            projectRoot,
            journalDirNorm,
            files,
            manifest,
            store.journalHistoryPreset,
          );

    if (cacheResult.hit) {
      journalBootProgress = {
        percent: 35,
        phase: "merging",
        filesDone: 0,
        filesTotal: files.length,
        message: "Restoring merged journal state from cache…",
      };
      pushFlush();
      /**
       * A payload the store cannot read is a cache miss, not an empty history. Falling through to
       * the full replay is the only safe answer: carrying on would apply the new journal lines to an
       * empty store and then save that over a good cache.
       */
      bootMark("cache read");
      // A turn between the steps of a start (plan F): the windows run on this thread too.
      await nextTurn();
      const hydrated = store.hydrateJournalMergePayload(cacheResult.payload);
      bootMark("hydrate");
      await nextTurn();
      if (!hydrated) {
        // Leave the store as `resyncAllJournalFiles` found it and fall through to the full replay.
        store.resetAll();
        if (!quietConsole) {
          console.warn("Journal cache could not be read — rebuilding from the logs.");
        }
      } else {
        if (cacheResult.steps.length > 0) {
          const stepCount = cacheResult.steps.length;
          let stepsDone = 0;
          journalBootProgress = {
            percent: 70,
            phase: "merging",
            filesDone: 0,
            filesTotal: stepCount,
            message: `Applying ${stepCount} journal log file(s) written since the last run…`,
          };
          pushFlush();
          for (const step of cacheResult.steps) {
            if (step.kind === "tail") {
              consumed.set(
                step.path,
                await readJournalFromOffset(step.path, step.startByte, applyReplayLine),
              );
            } else {
              consumed.set(step.path, await readJournalFull(step.path, applyReplayLine));
            }
            stepsDone += 1;
            journalBootProgress = {
              percent: 70 + Math.floor((25 * stepsDone) / stepCount),
              phase: "merging",
              filesDone: stepsDone,
              filesTotal: stepCount,
              message: `Applying new journal lines — file ${stepsDone} of ${stepCount}…`,
            };
            pushMergeProgress();
          }
          bootMark(`replay ${stepCount} new file(s)`);
        } else {
          journalBootProgress = {
            percent: 90,
            phase: "merging",
            filesDone: files.length,
            filesTotal: files.length,
            message: "Journal unchanged since the last run — finishing up…",
          };
          pushFlush();
        }
        await backfillCommanderPosition(store, files);
        bootMark("position backfill");
        finishReplay();
        bootMark("session + first push");
        if (cacheResult.steps.length > 0 || cacheResult.loadedFromLegacy) {
          await saveJournalMergeCache(
            journalDirNorm,
            manifest,
            store,
            projectRoot,
            store.journalHistoryPreset,
          );
          bootMark("cache save");
        }
        bootReport("cache");
        if (!quietConsole) {
          const s = cacheResult.steps.length;
          if (s === 0 && !cacheResult.loadedFromLegacy) {
            console.info(
              "Journal fast path: full cache hit (log set unchanged) — skipped replaying all files.",
            );
          } else if (s === 0 && cacheResult.loadedFromLegacy) {
            console.info(
              "Journal fast path: full cache hit — journal cache moved to app data (survives rebuilds).",
            );
          } else {
            console.info(
              `Journal fast path: cache + ${s} incremental replay step(s); state saved to app data cache.`,
            );
          }
        }
        return;
      }
    }

    journalBootProgress = {
      percent: 15,
      phase: "merging",
      filesDone: 0,
      filesTotal: files.length,
      message: `Merging ${files.length} journal log file(s) (oldest → newest)…`,
    };
    pushFlush();
    bootMergeLastFlush = Date.now();
    for (let i = 0; i < files.length; i++) {
      consumed.set(files[i]!, await readJournalFull(files[i]!, applyReplayLine));
      const done = i + 1;
      const pct = 15 + Math.floor((80 * done) / files.length);
      journalBootProgress = {
        percent: Math.min(pct, 95),
        phase: "merging",
        filesDone: done,
        filesTotal: files.length,
        message: `Merging journal logs — file ${done} of ${files.length}…`,
      };
      pushMergeProgress();
    }
    finishReplay();
    bootMark(`replay ${files.length} file(s)`);
    await saveJournalMergeCache(journalDirNorm, manifest, store, projectRoot, store.journalHistoryPreset);
    bootMark("cache save");
    bootReport("full read");
  }

  /*
    Restarts run one at a time (combined plan 1.2). Boot, a journal-folder change and a history-window
    change all restart the pipeline, and since the replay yields to the event loop the launcher can ask
    for one while another runs: both saw no watcher, both started one, and every live line was applied
    twice.
  */
  let pipelineChain: Promise<void> = Promise.resolve();

  function restartJournalPipeline(): Promise<void> {
    const run = pipelineChain.then(restartJournalPipelineNow, restartJournalPipelineNow);
    pipelineChain = run.catch(() => undefined);
    return run;
  }

  async function restartJournalPipelineNow(): Promise<void> {
    if (watcher) {
      await watcher.close();
      watcher = null;
    }
    // The byte the replay reached in the newest journal (1.1b), not its size now: lines written since
    // are the watcher's to apply.
    const seed = await resyncAllJournalFiles();
    if (watcher) await (watcher as JournalWatcherHandle).close();
    watcher = startJournalWatcher(
      getJournalDir(),
      createLiveJournalLine(),
      resyncAllJournalFiles,
      seed,
      getJournalListFilterOpts,
      () => store.journalPollMs,
    );
  }

  return {
    restart: restartJournalPipeline,
    /** The newest journal, which the live tail follows; null before the first merge or with no logs. */
    path: (): string | null => journalPath,
    filesMerged: (): number => journalFilesMerged,
    bootProgress: (): JournalBootProgressDTO | null => journalBootProgress,
    /** The boot failed after the server was listening: the screens stop showing it. */
    endBootProgress: (): void => {
      journalBootProgress = null;
    },
    /** The last journal boot's path and timings, for Copy diagnostics. */
    lastBoot: () => lastBoot,
    retimePoll: (): void => {
      watcher?.retimePoll();
    },
    close: async (): Promise<void> => {
      if (watcher) await watcher.close();
    },
  };
}
