/**
 * The launcher's status: read straight from the store's fields, no snapshot build and no one-shot state. Moved out of
 * edexoBootstrap.ts (2026-10-27, size cap); unchanged.
 */
import { existsSync, statSync } from "node:fs";
import type { AppStatusDTO } from "../shared/types.js";
import type { GameStateStore } from "./gameState.js";
import type { createJournalPipeline } from "./journalPipeline.js";
import type { createCommanderWatch } from "./commanderWatch.js";
import { pollRatesDto } from "../shared/pollRates.js";
import { radarRadiusDto } from "../shared/radarRadius.js";
import { readLanAccess } from "./launcherPrefs.js";
import { organicLiveSummary } from "./snapshot.js";
import { getSpeciesDataWarnings } from "./speciesTreeLoader.js";

export interface StatusReaderDeps {
  store: GameStateStore;
  journal: Pick<ReturnType<typeof createJournalPipeline>, "path" | "filesMerged" | "bootProgress">;
  commanderWatch: ReturnType<typeof createCommanderWatch>;
  getJournalDir: () => string;
  bindHost: string;
  port: number;
  lanExposed: boolean;
  lanKeyRequired: boolean;
  /** The launcher's LAN access switch is offered (cli.lanToggle). */
  lanToggle: boolean;
  lanUrlsWithKey: () => string[];
}

export function createStatusReader({
  store,
  journal,
  commanderWatch,
  getJournalDir,
  bindHost,
  port,
  lanExposed,
  lanKeyRequired,
  lanToggle,
  lanUrlsWithKey,
}: StatusReaderDeps): () => AppStatusDTO {
  /**
   * Launcher-sized status. Reads store fields directly — no snapshot build, no one-shot state.
   */
  return (): AppStatusDTO => {
    const journalDir = getJournalDir();
    let journalDirConfiguredOk = false;
    try {
      journalDirConfiguredOk = existsSync(journalDir) && statSync(journalDir).isDirectory();
    } catch {
      journalDirConfiguredOk = false;
    }
    return {
      mode: lanExposed ? "server" : "client",
      bindHost,
      port,
      lanUrls: lanExposed ? lanUrlsWithKey() : [],
      lanKeyRequired,
      lanAccess: lanToggle ? { saved: readLanAccess() ?? lanExposed, active: lanExposed } : null,
      journalDir,
      journalDirConfiguredOk,
      journalPath: journal.path(),
      journalFileCount: journal.filesMerged(),
      journalHistoryPreset: store.journalHistoryPreset,
      lastJournalEventIso: store.lastEventIso,
      commanderName: store.commanderName,
      journalBoot: journal.bootProgress(),
      speciesDataWarnings: getSpeciesDataWarnings(),
      pollRates: pollRatesDto(store.statusPollMs, store.journalPollMs),
      radarRadius: radarRadiusDto(store.minimapRadiusM),
      live: organicLiveSummary(store),
      feederEnabled: store.feederEnabled,
      commanders: commanderWatch.state(),
    };
  };
}
