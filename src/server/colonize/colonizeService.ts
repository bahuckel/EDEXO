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
import { readEdsmCredentials } from "../edsmCredentials.js";
import { resolveColonizeDataDir } from "../paths.js";
import { closeColonizeUiState } from "./uiState";
import { ColonizeStore } from "./colonizeStore";
import { flushSystemCoordsCache, loadSystemCoordsCache } from "./galaxySystemCoords";
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
  });
  let buyIndex: MaterialBuyIndex | null = null;
  const materialBuyIndex = (): MaterialBuyIndex => (buyIndex ??= getMaterialBuyIndex(dataDir));

  // Not awaited: coordinate look-ups wait for this read themselves.
  void loadSystemCoordsCache(dataDir).catch((e) => console.error("[colonize] system-coords load failed:", e));

  let lastNotifySig = "";
  store.setNotify(() => {
    try {
      const snap = store.getSnapshot();
      const sig = colonizeSnapshotNotifySig(snap);
      if (sig === lastNotifySig) return;
      lastNotifySig = sig;
      deps.push("onUpdate", snap);
    } catch (e) {
      console.error("[colonize] snapshot push failed (skipped):", e);
    }
  });
  setMaterialBuyScanPush(deps.push);

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

/** Stop it if it runs (server shutdown, tests). */
export async function stopColonizeService(): Promise<void> {
  await running?.stop();
  closeColonizeUiState();
}

/** Whether a Colonize window ever started it this run. */
export function colonizeServiceRunning(): boolean {
  return running != null;
}
