import { promises as fs, watchFile, unwatchFile } from "node:fs";
import path from "node:path";
import { normalizeConstructionProgress } from "../../shared/colonize/constructionProgress";
import type { ColonizeSnapshot, DepotSnapshot, DockMarketBrief, OwnColony } from "../../shared/colonize/types";
import { isConstructionDepotStation } from "../../shared/colonize/constructionDepot";
import {
  applyMarketJsonToJournalShop,
  applyShopDistanceLyToJournalRecords,
  journalShopsToShopHistory,
  migrateJournalShopRecord,
  type JournalShopRecord,
} from "../../shared/colonize/journalShopHistory";
import {
  emptyDepot,
  internalToSnapshot,
  isDepotCompleted,
  sortDepotSnapshots,
  syncContributionProgressSample,
  type DepotInternal,
  type ResourceInternal,
} from "./depotState";
import {
  applyJournalObject,
  createJournalState,
  engagedDepotRefs,
  ownedCarrierStocks,
  replaceShipCargo,
  type JournalState,
} from "./journalEvents";
import { journalWindowCutoffUtcMs, listJournalFilesChronological, readJournalEvents } from "./journalFs";
import { emptyCarrierStock, type CarrierStock } from "../../shared/colonize/carrierStock";
import { readJournalFromOffset, type JournalLineAt } from "../journalWatcher.js";
import { onJournalReread, onLiveJournalLine } from "../journalTap.js";
import type { JournalLine } from "../../shared/types.js";
import { backupUnreadableJson, readJson, writeJsonAtomic } from "./jsonFs";
import { parseMarketId } from "../../shared/colonize/marketId";

/**
 * Optional prefix + player-chosen site name. When the commander renames the facility, the journal may keep
 * a prefix ("Ground Installation: …") or become a plain custom StationName; we still key by MarketID.
 */

const STATE_FILENAME = "edexo-colonize-state.json";

/** What the store takes from EDEXO instead of keeping its own settings (1.3.0: one folder, one EDSM key). */
export type ColonizeStoreDeps = {
  /** EDEXO's journal folder, read each time (the commander can change it in the launcher). */
  journalDir: () => string;
  /** EDEXO's EDSM API key (Options), for wing cargo; null when none is saved. */
  edsmApiKey: () => string | null;
  /** The systems the commander claimed, from EDEXO's journal store (shared/ownAssets.ts). */
  ownColonies?: () => OwnColony[];
};

/** A journal file as a key for `reached`: one spelling per file whatever the caller passed. */
function fileKey(p: string): string {
  const r = path.resolve(p);
  return process.platform === "win32" ? r.toLowerCase() : r;
}

type StateFileV1 = {
  v: 1;
  depots: Record<string, DepotInternal>;
};

type StateFileV2 = {
  v: 2;
  depots: Record<string, DepotInternal>;
};

type StateFileV3 = {
  v: 3;
  depots: Record<string, DepotInternal>;
  journalShops?: Record<string, JournalShopRecord>;
  /** The journal folder whose whole history was read once for construction sites (`scanJournalHistory`). */
  historyScannedDir?: string;
  /** Which version of that read it was: a newer build that reads more events reads the history once more. */
  historyScannedVersion?: number;
  /** His own carriers, confirmed and with what the journal saw them carry (they outlive the 7-day window). */
  carriers?: Record<string, CarrierStock>;
  confirmedCarrierIds?: string[];
  carrierTransferKeys?: string[];
};

/** Bump when HISTORY_EVENTS reads more: every journal folder is read once more on the next start. */
const HISTORY_VERSION = 2;
/** Transfers remembered so none is counted twice; the oldest go first past this (years of hauling fit). */
const CARRIER_TRANSFER_KEYS_MAX = 50_000;

/**
 * What the one-time history pass reads: the two construction events, and the docking and jumps that say which
 * system a site is in. Nothing else: cargo, markets, wings and carriers before the 7-day window are stale.
 */
const HISTORY_EVENTS = [
  // v1: construction sites and where they are
  "ColonisationConstructionDepot",
  "ColonisationContribution",
  "Docked",
  "Location",
  "FSDJump",
  "CarrierJump",
  // v2 (owner, 2026-10-22): markets he docked at and bought from, for Search and the plan; his carrier and its cargo
  "Market",
  "MarketBuy",
  "Undocked",
  "CarrierStats",
  "CarrierBuy",
  "CarrierLocation",
  "CargoTransfer",
];

export class ColonizeStore {
  /**
   * Everything a journal line can change. Held as a plain record so the reducers in
   * `journalEvents.ts` can be driven by a test with no Electron, no disk and no timers.
   */
  private readonly journal: JournalState = createJournalState();
  private readonly statePath: string;
  private lastError: string | null = null;
  private historyScannedDir: string | null = null;
  private historyScannedVersion = 0;
  private notify: (() => void) | null = null;
  /**
   * Following EDEXO's journal reading (journalTap.ts) instead of a tail of its own. `reached`: per file, the byte
   * up to which its lines were applied, by a window read, a catch-up or the live feed; a live line ending at or
   * before it was already applied and is skipped. `held`: live lines that came in while a read was running,
   * applied (or skipped) when it is done.
   */
  private following: (() => void)[] = [];
  private readonly reached = new Map<string, number>();
  private held: { line: JournalLine; at: JournalLineAt }[] | null = null;
  private liveJournalPath: string | null = null;
  /** Last station economy string from Docked (for Supply archetype hint). */
  private cargoWatchPath: string | null = null;
  private marketWatchPath: string | null = null;
  private cargoResyncTimer: ReturnType<typeof setTimeout> | null = null;
  private marketResyncTimer: ReturnType<typeof setTimeout> | null = null;
  /** `mtime:size` of the last `Market.json` parsed; see `loadMarketFromDisk`. */
  private marketFileSig: string | null = null;
  /** Journal `Market` / `MarketBuy` — rebuilt on each replay window. */
  /** Bumped on any depot/shop mutation — invalidates snapshot caches. */
  /** True while a journal replay window is being parsed. */
  private replayBusy = false;
  /** Window reads and catch-ups queue behind one another; see `restartTail`. */
  private restartChain: Promise<void> = Promise.resolve();
  private depotSnapCacheGen = -1;
  private depotSnapCache: DepotSnapshot[] = [];
  private shopHistoryCacheGen = -1;
  private shopHistoryCache: ColonizeSnapshot["journalShopHistory"] = [];
  /** Other CMDRs in wing from journal `WingJoin`; cleared on `WingLeave`. */
  private readonly cargoWatchListener = (): void => {
    this.scheduleCargoResyncFromDisk();
  };
  private readonly marketWatchListener = (): void => {
    this.scheduleMarketResyncFromDisk();
  };

  constructor(
    dataDir: string,
    private readonly deps: ColonizeStoreDeps,
  ) {
    this.statePath = path.join(dataDir, STATE_FILENAME);
    /** Sidecar files are the store's business; a journal event only asks for a re-read. */
    this.journal.requestCargoResync = () => this.scheduleCargoResyncFromDisk();
    this.journal.requestMarketResync = () => this.scheduleMarketResyncFromDisk();
  }

  private applyLine(line: JournalLine): boolean {
    return applyJournalObject(this.journal, line as Record<string, unknown>);
  }

  setNotify(fn: () => void): void {
    this.notify = fn;
  }

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  /** State writes queue behind one another; see `persistState`. */
  private persistQueue: Promise<void> = Promise.resolve();

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistState().catch((e) => {
        console.error("[edexo-colonize] persistState failed:", e);
      });
    }, 300);
  }

  private scheduleNotify(): void {
    if (!this.notify) return;
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.notify?.();
    }, 900);
  }

  /** A store-level edit (settings, archive, distances, replay): redraw and save. */
  private bump(): void {
    this.journal.mutationGen++;
    this.schedulePersist();
    this.scheduleNotify();
  }

  /** `persistGen` a save was last scheduled for; see `bumpFromJournal`. */
  private persistScheduledGen = -1;

  /**
   * PERF-M3. A live journal line always redraws, but only rewrites the state file when it touched
   * a depot or a journal shop. Cargo, docking and wing events change nothing that is saved.
   */
  private bumpFromJournal(): void {
    this.scheduleNotify();
    if (this.journal.persistGen === this.persistScheduledGen) return;
    this.persistScheduledGen = this.journal.persistGen;
    this.schedulePersist();
  }

  /** State that is shown but never saved (hold, docked market, last error): redraw only. */
  private bumpVolatile(): void {
    this.scheduleNotify();
  }

  /** Cheap depot refs for construction-depot exclusion — no resource/history copies. */

  /** All depot snapshots — cached per mutation generation (deep copies are expensive). */
  private allDepotSnapshots(): DepotSnapshot[] {
    if (this.depotSnapCacheGen !== this.journal.mutationGen) {
      this.depotSnapCache = Object.values(this.journal.depots).map(internalToSnapshot);
      this.depotSnapCacheGen = this.journal.mutationGen;
    }
    return this.depotSnapCache;
  }

  private migrateDepot(raw: unknown): DepotInternal {
    const d = raw as DepotInternal & { contributions?: unknown };
    const mid = typeof d.marketId === "string" ? d.marketId : String(d.marketId ?? "");
    const base = emptyDepot(mid || "0");
    const { contributions: _omitContrib, ...rest } = d;
    const progress =
      typeof d.progress === "number" && Number.isFinite(d.progress)
        ? normalizeConstructionProgress(d.progress)
        : null;
    const resources = Array.isArray(d.resources)
      ? d.resources.map((r) => {
          const row = r as ResourceInternal;
          return {
            name: typeof row.name === "string" ? row.name : "",
            nameLocalised: typeof row.nameLocalised === "string" ? row.nameLocalised : "",
            required:
              typeof row.required === "number" && Number.isFinite(row.required)
                ? Math.max(0, row.required)
                : 0,
            provided:
              typeof row.provided === "number" && Number.isFinite(row.provided)
                ? Math.max(0, row.provided)
                : 0,
            payment: typeof row.payment === "number" && Number.isFinite(row.payment) ? row.payment : 0,
          };
        })
      : [];
    return {
      ...base,
      ...rest,
      marketId: mid || base.marketId,
      progress,
      engaged: Boolean(d.engaged),
      userArchived: Boolean(d.userArchived),
      resources,
      contributions: Array.isArray(d.contributions) ? d.contributions : [],
      progressHistory: Array.isArray(d.progressHistory) ? d.progressHistory : [],
      contributionProgressHistory: Array.isArray(d.contributionProgressHistory)
        ? d.contributionProgressHistory
        : [],
    };
  }

  private backfillContributionProgressHistory(d: DepotInternal): void {
    if (d.contributionProgressHistory.length > 0 || !d.contributions.length || !d.resources.length) return;
    const ts = d.contributions.reduce<string | null>((best, c) => {
      if (!c.lastTimestamp) return best;
      return !best || c.lastTimestamp > best ? c.lastTimestamp : best;
    }, null);
    if (!ts) return;
    syncContributionProgressSample(d, ts);
  }

  /**
   * Older versions only set `engaged` from Docked (orbital pattern) or Contribution — not from
   * `ColonisationConstructionDepot`, so construction telemetry could sit in state invisible to the UI.
   */
  private reEngageDepotsWithConstructionData(): void {
    for (const d of Object.values(this.journal.depots)) {
      if (d.engaged) continue;
      const hinted =
        d.resources.length > 0 ||
        d.progress != null ||
        d.complete ||
        d.failed ||
        Boolean(d.constructionSiteLabel?.trim());
      if (hinted) d.engaged = true;
    }
  }

  private loadCarriersFromState(raw: StateFileV3): void {
    const carriers = raw.carriers && typeof raw.carriers === "object" ? raw.carriers : {};
    for (const [id, c] of Object.entries(carriers)) {
      if (!c || typeof c !== "object" || typeof c.carrierId !== "string") continue;
      this.journal.carriers[id] = {
        ...emptyCarrierStock(id),
        ...c,
        tonsByCommodity: { ...(c.tonsByCommodity ?? {}) },
        labels: { ...(c.labels ?? {}) },
      };
    }
    for (const id of Array.isArray(raw.confirmedCarrierIds) ? raw.confirmedCarrierIds : []) {
      if (typeof id === "string" && this.journal.carriers[id]) this.journal.confirmedCarrierIds.add(id);
    }
    for (const k of Array.isArray(raw.carrierTransferKeys) ? raw.carrierTransferKeys : []) {
      if (typeof k === "string") this.journal.carrierTransferKeys.add(k);
    }
  }

  private loadJournalShopsFromState(raw: Record<string, unknown>): void {
    this.journal.journalShops.clear();
    const shopsRaw = raw.journalShops;
    if (!shopsRaw || typeof shopsRaw !== "object") return;
    const loaded = new Map<string, JournalShopRecord>();
    for (const val of Object.values(shopsRaw as Record<string, unknown>)) {
      const rec = migrateJournalShopRecord(val);
      if (rec) loaded.set(rec.marketId, rec);
    }
    // Apply the same caps as persist so legacy oversized state files shrink on first run.
    for (const rec of Object.values(compactJournalShopsForPersist(loaded))) {
      this.journal.journalShops.set(rec.marketId, rec);
    }
  }

  async load(): Promise<void> {
    const raw = await readJson<StateFileV3 | StateFileV2 | StateFileV1 | null>(this.statePath, null);
    if (!raw || typeof raw !== "object") {
      this.journal.depots = {};
      this.journal.journalShops.clear();
      return;
    }
    const v = (raw as { v?: unknown }).v;
    const depotsRaw = (raw as { depots?: unknown }).depots;
    if (v === 1 || v === 2 || v === 3) {
      if (depotsRaw && typeof depotsRaw === "object") {
        const next: Record<string, DepotInternal> = {};
        for (const [k, val] of Object.entries(depotsRaw as Record<string, unknown>)) {
          next[k] = this.migrateDepot(val);
          if (v === 1) next[k]!.engaged = false;
        }
        this.journal.depots = next;
        this.reEngageDepotsWithConstructionData();
        for (const d of Object.values(this.journal.depots)) {
          this.backfillContributionProgressHistory(d);
        }
      } else {
        this.journal.depots = {};
      }
      if (v === 3) this.loadJournalShopsFromState(raw as Record<string, unknown>);
      else this.journal.journalShops.clear();
      const scanned = (raw as { historyScannedDir?: unknown }).historyScannedDir;
      this.historyScannedDir = typeof scanned === "string" ? scanned : null;
      const version = (raw as { historyScannedVersion?: unknown }).historyScannedVersion;
      this.historyScannedVersion = typeof version === "number" ? version : this.historyScannedDir ? 1 : 0;
      this.loadCarriersFromState(raw as StateFileV3);
    } else {
      /**
       * A version this build does not understand — most likely a newer one after a downgrade.
       * The next persist would overwrite it, so keep a copy before starting empty.
       */
      void backupUnreadableJson(
        this.statePath,
        typeof v === "number" || typeof v === "string" ? v : "unknown",
      );
      this.lastError =
        "Saved state was written by a different version and could not be read. A copy was kept next to it; construction progress will rebuild from your journals.";
      this.journal.depots = {};
      this.journal.journalShops.clear();
    }
    this.journal.mutationGen++;
  }

  getJournalDir(): string {
    return this.deps.journalDir();
  }

  /** Persisted journal Market / MarketBuy records — used by Search alongside the buy index. */
  getJournalShopRecords(): JournalShopRecord[] {
    return [...this.journal.journalShops.values()];
  }

  getEdsmApiKey(): string | null {
    return this.deps.edsmApiKey();
  }

  applyJournalShopDistances(distanceBySystem: Record<string, number>, constructionRefs: string[] = []): void {
    const refs =
      constructionRefs.length > 0
        ? constructionRefs
        : Object.values(this.journal.depots)
            .map((d) => d.starSystem?.trim() || "")
            .filter(Boolean);
    applyShopDistanceLyToJournalRecords(this.journal.journalShops, distanceBySystem, refs);
    this.bump();
  }

  getSnapshot(): ColonizeSnapshot {
    const journalDir = this.getJournalDir();
    const livePath = this.following.length ? this.liveJournalPath : null;
    const all = this.allDepotSnapshots();
    const engaged = all.filter((d) => {
      const int = this.journal.depots[d.marketId];
      return int?.engaged === true;
    });
    const activeDepots = sortDepotSnapshots(
      engaged.filter((d) => {
        const int = this.journal.depots[d.marketId];
        return int && !int.userArchived && !isDepotCompleted(int);
      }),
    );
    const completedDepots = sortDepotSnapshots(
      engaged.filter((d) => {
        const int = this.journal.depots[d.marketId];
        return int && !int.userArchived && isDepotCompleted(int);
      }),
    );
    const archivedDepots = sortDepotSnapshots(
      engaged.filter((d) => {
        const int = this.journal.depots[d.marketId];
        return int?.userArchived === true;
      }),
    );

    const shipCargo = Array.from(this.journal.shipCargoByName.values()).sort((a, b) =>
      (a.nameLocalised || a.name).localeCompare(b.nameLocalised || b.name),
    );

    if (this.shopHistoryCacheGen !== this.journal.mutationGen) {
      this.shopHistoryCache = journalShopsToShopHistory(this.journal.journalShops.values(), engaged);
      this.shopHistoryCacheGen = this.journal.mutationGen;
    }

    return {
      ownColonies: this.deps.ownColonies?.() ?? [],
      journalDir,
      journalDirConfigured: true,
      edsmApiKeyPresent: Boolean(this.deps.edsmApiKey()),
      liveJournalPath: livePath,
      activeDepots,
      completedDepots,
      archivedDepots,
      liveDocked: this.journal.liveDocked,
      navContext: {
        starSystem: this.journal.lineCtx.starSystem,
        systemAddress: this.journal.lineCtx.systemAddress,
      },
      lastDockedEconomy: this.journal.lastDockedEconomy,
      shipCargo,
      shipCargoTimestamp: this.journal.shipCargoTimestamp,
      shipCargoCapacity: this.journal.shipCargoCapacity,
      dockMarket: this.journal.dockMarket,
      journalShopHistory: this.shopHistoryCache,
      replayBusy: this.replayBusy,
      wingRoster: [...this.journal.wingRoster],
      carriers: ownedCarrierStocks(this.journal),
      lastError: this.lastError,
    };
  }

  setDepotArchived(marketId: string, archived: boolean): void {
    const d = this.journal.depots[marketId];
    if (!d || !d.engaged) return;
    d.userArchived = archived;
    this.journal.depots[marketId] = d;
    this.bump();
  }

  private engage(key: string): void {
    const d = this.journal.depots[key] ?? emptyDepot(key);
    d.engaged = true;
    this.journal.depots[key] = d;
  }

  private scheduleCargoResyncFromDisk(): void {
    if (this.cargoResyncTimer) clearTimeout(this.cargoResyncTimer);
    this.cargoResyncTimer = setTimeout(() => {
      this.cargoResyncTimer = null;
      void this.loadShipCargoFromDisk();
    }, 400);
  }

  private async loadShipCargoFromDisk(): Promise<void> {
    const p = path.join(this.getJournalDir(), "Cargo.json");
    try {
      const raw = await fs.readFile(p, "utf8");
      const j = JSON.parse(raw) as Record<string, unknown>;
      if (j.event === "Cargo" && j.Vessel === "Ship" && Array.isArray(j.Inventory)) {
        const cap = typeof j.Capacity === "number" ? j.Capacity : null;
        if (
          replaceShipCargo(
            this.journal,
            j.Inventory,
            typeof j.timestamp === "string" ? j.timestamp : null,
            cap,
          )
        ) {
          this.bumpVolatile();
        }
        return;
      }
    } catch {
      /* missing or invalid */
    }
    if (this.journal.shipCargoByName.size > 0) {
      this.journal.shipCargoByName = new Map();
      this.journal.shipCargoTimestamp = null;
      this.bumpVolatile();
    }
  }

  private scheduleMarketResyncFromDisk(): void {
    if (this.marketResyncTimer) clearTimeout(this.marketResyncTimer);
    this.marketResyncTimer = setTimeout(() => {
      this.marketResyncTimer = null;
      void this.loadMarketFromDisk();
    }, 400);
  }

  private async loadMarketFromDisk(): Promise<void> {
    const p = path.join(this.getJournalDir(), "Market.json");
    let raw: string;
    let sig: string;
    try {
      const st = await fs.stat(p);
      sig = `${st.mtimeMs}:${st.size}`;
      /**
       * PERF-M10. Opening a market fires the journal `Market` event AND changes `Market.json`,
       * which the file watcher sees up to 1.5 s later — outside the 400 ms debounce, so the same
       * file was parsed twice. A file that has not changed since the last good parse is skipped.
       */
      if (sig === this.marketFileSig) return;
      raw = await fs.readFile(p, "utf8");
    } catch {
      this.marketFileSig = null;
      if (this.journal.dockMarket) {
        this.journal.dockMarket = null;
        this.bumpVolatile();
      }
      return;
    }
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      /** Caught mid-write: leave the signature unset so the finished file is read. */
      return;
    }
    this.marketFileSig = sig;
    if (j.event !== "Market") return;
    const stationName = typeof j.StationName === "string" ? j.StationName : "—";
    const starSystem = typeof j.StarSystem === "string" ? j.StarSystem : "—";
    const ts = typeof j.timestamp === "string" ? j.timestamp : null;
    const marketId = parseMarketId(j.MarketID);
    const items = j.Items;
    const rowCount = Array.isArray(items) ? items.length : 0;
    const next: DockMarketBrief = { marketId, stationName, starSystem, timestamp: ts, rowCount };
    const prev = this.journal.dockMarket;
    const briefUnchanged =
      prev &&
      prev.marketId === next.marketId &&
      prev.timestamp === next.timestamp &&
      prev.rowCount === next.rowCount &&
      prev.stationName === next.stationName;
    if (!briefUnchanged) this.journal.dockMarket = next;

    const engagedDepots = engagedDepotRefs(this.journal);
    let itemsSaved = false;
    if (
      marketId &&
      stationName !== "—" &&
      starSystem !== "—" &&
      !isConstructionDepotStation(engagedDepots, {
        marketId,
        systemName: starSystem,
        stationName,
      })
    ) {
      itemsSaved = applyMarketJsonToJournalShop(this.journal.journalShops, j);
    }

    if (itemsSaved) this.bump();
    else if (!briefUnchanged) this.bumpVolatile();
  }

  private startCargoWatch(): void {
    this.stopCargoWatch();
    const p = path.join(this.getJournalDir(), "Cargo.json");
    this.cargoWatchPath = p;
    try {
      watchFile(p, { interval: 1500 }, this.cargoWatchListener);
    } catch {
      this.cargoWatchPath = null;
    }
  }

  private stopCargoWatch(): void {
    if (!this.cargoWatchPath) return;
    try {
      unwatchFile(this.cargoWatchPath, this.cargoWatchListener);
    } catch {
      /* */
    }
    this.cargoWatchPath = null;
  }

  private startMarketWatch(): void {
    this.stopMarketWatch();
    const p = path.join(this.getJournalDir(), "Market.json");
    this.marketWatchPath = p;
    try {
      watchFile(p, { interval: 1500 }, this.marketWatchListener);
    } catch {
      this.marketWatchPath = null;
    }
    void this.loadMarketFromDisk();
  }

  private stopMarketWatch(): void {
    if (!this.marketWatchPath) return;
    try {
      unwatchFile(this.marketWatchPath, this.marketWatchListener);
    } catch {
      /* */
    }
    this.marketWatchPath = null;
  }

  async replayJournalWindow(): Promise<void> {
    this.replayBusy = true;
    this.scheduleNotify();
    try {
      await this.replayJournalWindowInner();
    } finally {
      this.replayBusy = false;
      this.scheduleNotify();
    }
  }

  /**
   * Once per journal folder (owner, 2026-10-21): the construction sites in every journal before the 7-day window,
   * so a site last visited weeks ago is there on the first start instead of after the next dock. Read before the
   * window, whose reset then clears what the old docking left behind (where the ship is docked, the system).
   * True when it ran to the end; the folder is remembered only after the window read succeeds too.
   */
  private async scanJournalHistory(dir: string, minMs: number): Promise<boolean> {
    try {
      const all = await listJournalFilesChronological(dir, null);
      const inWindow = new Set(await listJournalFilesChronological(dir, minMs));
      for (const file of all) {
        if (inWindow.has(file)) continue;
        await readJournalEvents(file, HISTORY_EVENTS, (j) => this.applyLine(j as JournalLine));
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      return true;
    } catch (e) {
      console.error("[colonize] journal history read failed:", e);
      return false;
    }
  }

  private async replayJournalWindowInner(): Promise<void> {
    this.lastError = null;
    const historyDir = this.getJournalDir();
    const scanHistory = this.historyScannedDir !== historyDir || this.historyScannedVersion < HISTORY_VERSION;
    // The old docking would otherwise say which carrier the ship is on; the window reset below clears the rest.
    const dockedCarrier = this.journal.dockedCarrierId;
    const historyRead = scanHistory && (await this.scanJournalHistory(historyDir, journalWindowCutoffUtcMs()));
    this.journal.dockedCarrierId = dockedCarrier;
    this.journal.shipCargoByName.clear();
    this.journal.shipCargoTimestamp = null;
    this.journal.shipCargoCapacity = null;
    this.journal.dockMarket = null;
    /** Replay clears the docked market, so the file must be read again even if it has not changed. */
    this.marketFileSig = null;
    this.journal.liveDocked = null;
    this.journal.lastDockedEconomy = null;
    this.journal.wingRoster = [];
    /*
      The shops (markets visited, purchases) are kept, not cleared: they come from the whole history and the saved
      state, and the week read again below only adds to them (purchases are recorded once; owner, 2026-10-22: Search
      found nothing because they were wiped at every start).
    */
    this.journal.mutationGen++;
    const dir = this.getJournalDir();
    const minMs = journalWindowCutoffUtcMs();
    let files: string[];
    try {
      files = await listJournalFilesChronological(dir, minMs);
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.bump();
      return;
    }
    this.journal.lineCtx = { starSystem: null, systemAddress: null };
    /**
     * Contributions and the two history series are deliberately NOT cleared here.
     * Replay only reads the last 7 days, so wiping them meant a project older than
     * a week lost every contribution and progress sample on each launch. The
     * appenders below skip anything at or before what is already recorded, so
     * re-reading the window is idempotent and the pre-window totals survive.
     */
    this.journal.mutationGen++;
    this.reached.clear();
    try {
      for (const file of files) {
        const end = await readJournalFromOffset(file, 0, (line) => {
          this.applyLine(line);
        });
        this.reached.set(fileKey(file), end);
        this.liveJournalPath = file;
        // Yield between files so the server stays responsive during long replays.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
    }
    if (historyRead && !this.lastError) {
      this.historyScannedDir = historyDir;
      this.historyScannedVersion = HISTORY_VERSION;
    }
    this.bump();
  }

  /**
   * Serialised: `replayWeek` or `chooseJournalDir` during the startup replay used to
   * run two passes over the same journals at once, and every contribution landed twice.
   */
  async restartTail(): Promise<void> {
    const run = this.restartChain.then(
      () => this.restartTailInner(),
      () => this.restartTailInner(),
    );
    this.restartChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async restartTailInner(): Promise<void> {
    this.stopCargoWatch();
    this.stopMarketWatch();
    if (this.cargoResyncTimer) {
      clearTimeout(this.cargoResyncTimer);
      this.cargoResyncTimer = null;
    }
    if (this.marketResyncTimer) {
      clearTimeout(this.marketResyncTimer);
      this.marketResyncTimer = null;
    }
    this.stopFollowing();
    /*
      Follow first, then read: live lines that arrive during the read are held and checked against how far the read
      got, so none falls between the two and none is applied twice.
    */
    this.held = [];
    this.following.push(
      onLiveJournalLine((line, at) => this.offerLive(line, at)),
      onJournalReread(() => void this.catchUp()),
    );
    try {
      await this.replayJournalWindow();
      await this.loadShipCargoFromDisk();
    } finally {
      this.releaseHeld();
    }
    this.startCargoWatch();
    this.startMarketWatch();
    this.bump();
  }

  /** A live line from EDEXO's tail (journalTap.ts). */
  private offerLive(line: JournalLine, at: JournalLineAt): void {
    if (this.held) {
      this.held.push({ line, at });
      return;
    }
    this.applyLive(line, at);
  }

  private applyLive(line: JournalLine, at: JournalLineAt): void {
    const key = fileKey(at.path);
    const reached = this.reached.get(key);
    if (reached !== undefined && at.end <= reached) return;
    this.reached.set(key, at.end);
    this.liveJournalPath = at.path;
    // A copy: the line is EDEXO's too, and parts of it are kept in the depot records.
    if (this.applyLine(structuredClone(line))) this.bumpFromJournal();
  }

  private releaseHeld(): void {
    const held = this.held ?? [];
    this.held = null;
    for (const { line, at } of held) this.applyLive(line, at);
  }

  /**
   * The journals were read again from disk (a new journal file at a game start, a folder change): those lines never
   * pass through the live feed, so read whatever each file in the window has past where this store got to.
   */
  catchUp(): Promise<void> {
    const run = this.restartChain.then(
      () => this.catchUpInner(),
      () => this.catchUpInner(),
    );
    this.restartChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async catchUpInner(): Promise<void> {
    if (!this.following.length) return;
    this.held ??= [];
    let changed = false;
    try {
      const files = await listJournalFilesChronological(this.getJournalDir(), journalWindowCutoffUtcMs());
      for (const file of files) {
        const key = fileKey(file);
        const from = this.reached.get(key) ?? 0;
        let size = 0;
        try {
          size = (await fs.stat(file)).size;
        } catch {
          continue;
        }
        if (size <= from) continue;
        const end = await readJournalFromOffset(file, from, (line) => {
          if (this.applyLine(line)) changed = true;
        });
        this.reached.set(key, end);
        this.liveJournalPath = file;
      }
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
    } finally {
      this.releaseHeld();
    }
    if (changed) this.bump();
    else this.bumpVolatile();
  }

  private stopFollowing(): void {
    for (const off of this.following) off();
    this.following = [];
    this.held = null;
  }

  /**
   * Serialised like `MaterialBuyIndex`: a write slower than the 300 ms persist debounce used to
   * overlap the next one, and the two racers collided on the same state file.
   */
  async persistState(): Promise<void> {
    const run = this.persistQueue.then(async () => {
      const journalShops = compactJournalShopsForPersist(this.journal.journalShops);
      const payload: StateFileV3 = {
        v: 3,
        depots: this.journal.depots,
        journalShops,
        ...(this.historyScannedDir ? { historyScannedDir: this.historyScannedDir, historyScannedVersion: this.historyScannedVersion } : {}),
        carriers: this.journal.carriers,
        confirmedCarrierIds: [...this.journal.confirmedCarrierIds],
        carrierTransferKeys: [...this.journal.carrierTransferKeys].slice(-CARRIER_TRANSFER_KEYS_MAX),
      };
      await writeJsonAtomic(this.statePath, payload, false);
    });
    this.persistQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Drop cached market visits (Inara/Spansh/index stay in material-buy-index.json). */
  async clearJournalShopCache(): Promise<void> {
    this.journal.journalShops.clear();
    this.shopHistoryCache = [];
    this.shopHistoryCacheGen = -1;
    this.journal.mutationGen++;
    await this.persistState();
    this.bump();
  }

  async shutdown(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.cargoResyncTimer) {
      clearTimeout(this.cargoResyncTimer);
      this.cargoResyncTimer = null;
    }
    this.stopCargoWatch();
    this.stopMarketWatch();
    if (this.marketResyncTimer) {
      clearTimeout(this.marketResyncTimer);
      this.marketResyncTimer = null;
    }
    this.stopFollowing();
    await this.persistState();
  }
}

/** Keep this many shops without purchases (most recent first); shops with purchases always stay. */
const PERSIST_SHOPS_MAX = 60;
/** Cap stale full market catalogs per shop; purchase rows are never pruned. */
const PERSIST_MARKET_ITEMS_MAX = 150;

function capShopRecord(rec: JournalShopRecord): JournalShopRecord {
  const items = rec.marketItems ?? [];
  if (items.length <= PERSIST_MARKET_ITEMS_MAX) return rec;
  return { ...rec, marketItems: items.slice(0, PERSIST_MARKET_ITEMS_MAX) };
}

function compactJournalShopsForPersist(
  shops: Map<string, JournalShopRecord>,
): Record<string, JournalShopRecord> {
  const recs = [...shops.values()];
  const withPurchases = recs.filter((r) => r.purchases.length > 0);
  const withoutPurchases = recs
    .filter((r) => r.purchases.length === 0)
    .sort((a, b) => Date.parse(b.visitedAt) - Date.parse(a.visitedAt))
    .slice(0, PERSIST_SHOPS_MAX);
  const out: Record<string, JournalShopRecord> = {};
  for (const rec of [...withPurchases, ...withoutPurchases]) {
    out[rec.marketId] = capShopRecord(rec);
  }
  return out;
}
