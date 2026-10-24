/**
 * Colonize inside EDEXO's server (1.3.0; was EDEXO-Colonize's Electron main process, `ipcEntry.ts`).
 *
 * Started on the first request from a Colonize window, not at boot: a commander who never opens it pays nothing
 * (no journal window read, no buy index in memory, no folder watch, no network). Once started it runs until the
 * server stops. It follows EDEXO's own journal reading (journalTap.ts), keeps its files under
 * `<user data>/colonize/` (paths.ts), uses EDEXO's EDSM key, and pushes to the windows through EDEXO's WebSocket.
 *
 * Everything that runs on its own (the background start, the folder watch, the scans) is guarded: a failure is
 * logged, never thrown into the server process, which would close the desktop app.
 */
import path from "node:path";
import { finishedSellerRefs } from "../../shared/colonize/buyIndexClear";
import { KEY_DEPOT_REF_PINS } from "../../shared/colonize/uiStateKeys";
import type { OwnColony } from "../../shared/colonize/types";
import { readEdsmCredentials } from "../edsmCredentials.js";
import { resolveColonizeDataDir } from "../paths.js";
import { closeColonizeUiState, colonizeUiState } from "./uiState";
import { refreshColonizeHud, setColonizeHudSource } from "./hudSummary";
import { ColonizeStore } from "./colonizeStore";
import { flushSystemCoordsCache, loadSystemCoordsCache, peekSystemCoords, setLocalSystemCoords } from "./galaxySystemCoords";
import { setLocalStationFacts } from "./localStationFacts";
import type { LocalGalaxy } from "./localGalaxy";
import { buyIndexHandlers } from "./ipc/buyIndexHandlers";
import { checkoutHandlers } from "./ipc/checkoutHandlers";
import { debugHandlers } from "./ipc/debugHandlers";
import type { ColonizeHandlers, ColonizePush, IpcContext } from "./ipc/handlerTypes";
import { createInaraWatchControl, inaraHandlers, type InaraWatchControl } from "./ipc/inaraHandlers";
import { journalHandlers } from "./ipc/journalHandlers";
import { parseConstructionDepots } from "./ipc/payload";
import { scanHandlers } from "./ipc/scanHandlers";
import { siteHandlers } from "./ipc/siteHandlers";
import { colonizeSnapshotNotifySig } from "./ipc/snapshotNotify";
import { getMaterialBuyIndex, type MaterialBuyIndex } from "./materialBuyIndex";
import { setMaterialBuyScanPush } from "./materialBuyScanHub";

export type ColonizeServiceDeps = {
  /** EDEXO's journal folder (HttpServerOptions.getJournalDir). */
  journalDir: () => string;
  /** To every open Colonize window. */
  push: ColonizePush;
  /** The commander's claimed systems (EDEXO's journal store). */
  ownColonies?: () => OwnColony[];
  /** EDEXO's own coordinates and station facts, before EDSM and Spansh (localGalaxy.ts). */
  localGalaxy?: LocalGalaxy;
  /** A visited system's position by address, from EDEXO's journal store (the HUD's "N ly away"). */
  systemPosition?: (systemAddress: number) => [number, number, number] | null;
};

export type ColonizeService = {
  handlers: ColonizeHandlers;
  store: ColonizeStore;
  /** Resolves once the background start (state, journal window, buy index) is done; never rejects. */
  ready: Promise<void>;
  stop: () => Promise<void>;
};

/**
 * Every handler, keyed by contract method. The annotation is the point: leave one out, add one the contract does
 * not name, or return the wrong shape, and this does not compile.
 */
function allHandlers(ctx: IpcContext, inara: InaraWatchControl): ColonizeHandlers {
  return {
    ...journalHandlers(ctx),
    ...debugHandlers(ctx),
    ...scanHandlers(ctx),
    ...buyIndexHandlers(ctx),
    ...checkoutHandlers(ctx),
    ...inaraHandlers(ctx, inara),
    ...siteHandlers(),
  };
}

let running: ColonizeService | null = null;

/** The running service, started on first call. */
export function colonizeService(deps: ColonizeServiceDeps): ColonizeService {
  if (running) return running;
  const dataDir = resolveColonizeDataDir();
  const store = new ColonizeStore(dataDir, {
    journalDir: deps.journalDir,
    edsmApiKey: () => readEdsmCredentials()?.apiKey ?? null,
    edsmCommanderName: () => readEdsmCredentials()?.commanderName ?? null,
    ownColonies: deps.ownColonies,
  });
  let buyIndex: MaterialBuyIndex | null = null;
  const materialBuyIndex = (): MaterialBuyIndex => (buyIndex ??= getMaterialBuyIndex(dataDir));

  // Not awaited: coordinate look-ups wait for this read themselves.
  // The old EDEXO-Colonize app's positions are read in once (discuss item 8); Windows only, where it ran.
  const legacyCoords = process.env.APPDATA ? path.join(process.env.APPDATA, "edexo-colonize", "system-coords.json") : null;
  void loadSystemCoordsCache(dataDir, legacyCoords).catch((e) => console.error("[colonize] system-coords load failed:", e));

  let lastNotifySig = "";
  store.setNotify(() => {
    try {
      const snap = store.getSnapshot();
      const sig = colonizeSnapshotNotifySig(snap);
      if (sig === lastNotifySig) return;
      lastNotifySig = sig;
      deps.push("onUpdate", snap);
      refreshColonizeHud();
    } catch (e) {
      console.error("[colonize] snapshot push failed (skipped):", e);
    }
  });
  setMaterialBuyScanPush(deps.push);
  setLocalSystemCoords(deps.localGalaxy ? (name) => deps.localGalaxy!.systemCoords(name) : null);
  setLocalStationFacts(deps.localGalaxy ? (sys, st) => deps.localGalaxy!.stationFacts(sys, st) : null);
  setColonizeHudSource(() => ({
    snap: store.getSnapshot(),
    ui: colonizeUiState().all(),
    pos: {
      // Both from what is held already: the journal's positions and the coordinates the plan looked up.
      ship: (s) => {
        const addr = s.navContext.systemAddress;
        return (addr != null ? deps.systemPosition?.(addr) : null) ?? (s.navContext.starSystem ? peekSystemCoords(s.navContext.starSystem) : null);
      },
      system: peekSystemCoords,
    },
  }));

  const ctx: IpcContext = { store, push: deps.push, buyIndex: materialBuyIndex, userDataDir: dataDir };
  const inara = createInaraWatchControl(ctx);
  const handlers = allHandlers(ctx, inara);

  // Staggered like the old app: saved depots first (a window can draw), then the journal window, then the
  // heavy buy-index load and clean-up.
  const ready = (async () => {
    try {
      await store.load();
      await new Promise<void>((r) => setImmediate(r));
      await store.restartTail();
      await new Promise<void>((r) => setImmediate(r));
      const index = materialBuyIndex();
      await index.load();
      index.sanitizeSellHits();
      const depots = parseConstructionDepots(store.getSnapshot().activeDepots ?? []);
      if (depots.length) index.purgeConstructionDepotStations(depots);
      await index.flush();
      // Sellers gathered round sites finished over 30 days ago stop feeding plans (discuss item 6).
      const snap = store.getSnapshot();
      const old = finishedSellerRefs(
        [...(snap.activeDepots ?? []), ...(snap.completedDepots ?? []), ...(snap.archivedDepots ?? [])],
        depotRefPinsFrom(colonizeUiState().all()[KEY_DEPOT_REF_PINS]),
        (n) => index.refKey(n),
      );
      const dropped = await index.pruneRefs(old);
      if (dropped) console.log(`[colonize] dropped ${dropped} sellers near sites finished over 30 days ago`);
    } catch (e) {
      console.error("[colonize] background start failed:", e);
    }
  })();
  void inara.restart().catch((e) => console.error("[colonize] Inara folder watch failed:", e));

  const service: ColonizeService = {
    handlers,
    store,
    ready,
    stop: async () => {
      if (running === service) running = null;
      inara.stop();
      setMaterialBuyScanPush(null);
      setColonizeHudSource(null);
      setLocalSystemCoords(null);
      setLocalStationFacts(null);
      try {
        await buyIndex?.flush();
      } catch {
        /* the next start reloads what is on disk */
      }
      await flushSystemCoordsCache().catch(() => {});
      await store.shutdown();
    },
  };
  running = service;
  return service;
}

/** The hub pins as saved in ui-state.json (market id -> reference system). */
function depotRefPinsFrom(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const j = raw ? (JSON.parse(raw) as unknown) : null;
    if (j && typeof j === "object") for (const [k, v] of Object.entries(j)) if (typeof v === "string" && v.trim()) out[k] = v.trim();
  } catch {
    /* none */
  }
  return out;
}

/** Stop it if it runs (server shutdown, tests). */
export async function stopColonizeService(): Promise<void> {
  await running?.stop();
  closeColonizeUiState();
}

/** Whether a Colonize window ever started it this run. */
export function colonizeServiceRunning(): boolean {
  return running != null;
}
