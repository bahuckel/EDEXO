/*
  EDSM, Canonn and EDDN for the running app (split out of edexoBootstrap.ts, discuss item 30, 1.3.1): EDSM
  hydration on jump, the EDSM upload catch-up and its live loop, and the Canonn and EDDN senders fed from the live
  journal tail.
*/
import path from "node:path";
import { readFileSync } from "node:fs";
import type { JournalLine } from "../shared/types.js";
import type { GameStateStore } from "./gameState.js";
import { readJournalFull } from "./journalWatcher.js";
import { readEdsmCredentials } from "./edsmCredentials.js";
import { EdsmAutoFetcher } from "./edsmAutoFetch.js";
import { CANONN_CLIENT_VERSION, CanonnUploader } from "./canonnUpload.js";
import { EddnUploader } from "./eddnUpload.js";
import { fetchEdsmBodiesAsExplorationRecords } from "./edsmSystemHydration.js";
import { runEdsmCatchUp, type EdsmCatchUpScope } from "./edsmCatchUp.js";

export type CommunityUploadsDeps = {
  store: GameStateStore;
  push: () => void;
  getJournalDir: () => string;
  getJournalPath: () => string | null;
};

export function createCommunityUploads({ store, push, getJournalDir, getJournalPath }: CommunityUploadsDeps) {
  /**
   * Auto-hydration on jump (§50). Enabled only when the toggle is on **and** the commander has
   * stored their own EDSM key — the key is the consent, the toggle is the switch.
   */
  const edsmAutoFetcher = new EdsmAutoFetcher({
    isEnabled: () => store.edsmAutoFetchEnabled && readEdsmCredentials() !== null,
    needsHydration: (systemAddress, arrived) =>
      /*
       * On arrival the system is in the journal, so not knowing it means something is off and we
       * leave it alone. A jump destination is somewhere the commander has *not* been — that is the
       * whole point of asking early — so the journal-knows-it half of the gate cannot apply.
       */
      (arrived ? store.isKnownJournalSystem(systemAddress) : true) &&
      !store.hasMappableJournalExplorationForSystem(systemAddress),
    hydrate: async (systemAddress, systemName) => {
      const edsm = await fetchEdsmBodiesAsExplorationRecords(
        systemName,
        systemAddress,
        readEdsmCredentials(),
      );
      if (!edsm.ok) return { ok: false, error: edsm.error };
      store.replaceEdsmExplorationForSystem(systemAddress, edsm.records);
      push();
      return { ok: true };
    },
  });

  /**
   * One catch-up at a time.
   *
   * Two concurrent runs would both start from the same watermark and send the whole history twice —
   * harmless to EDSM, which discards duplicates, and exactly the kind of traffic a volunteer service
   * should not have to absorb from one client.
   */
  let edsmCatchUpRunning = false;
  let edsmCatchUpCancelled = false;

  /**
   * How often the live upload looks for new journal lines, and how far back it reaches.
   *
   * Three minutes because exploration data is not time-critical and a quiet tick costs nothing: the
   * discard list is cached for a day and unchanged journals are never opened, so a tick with no new
   * play makes no network request at all.
   *
   * A **week**, not everything. Wide enough to heal a gap from an app that was closed for a few days,
   * narrow enough that switching this on cannot silently start uploading four years — that is what
   * the button and its dropdown are for, and it should stay a deliberate act.
   */
  const EDSM_LIVE_INTERVAL_MS = 3 * 60 * 1000;
  const EDSM_LIVE_SCOPE = "week" as const;

  /**
   * One catch-up, whoever asked for it.
   *
   * The button and the timer go through here so there is exactly one place that decides whether a
   * run may start. Two runs would read the same watermark and send the history twice.
   */
  function startEdsmRun(scope: EdsmCatchUpScope, silent = false): { ok: boolean; error?: string } {
    if (!store.edsmUploadEnabled) return { ok: false, error: "Turn EDSM upload on first." };
    const credentials = readEdsmCredentials();
    if (!credentials) return { ok: false, error: "Store your EDSM commander name and API key first." };
    if (edsmCatchUpRunning) return { ok: false, error: "A catch-up is already running." };
    edsmCatchUpRunning = true;
    edsmCatchUpCancelled = false;
    void runEdsmCatchUp({
      journalDir: getJournalDir(),
      credentials,
      scope,
      isCancelled: () => edsmCatchUpCancelled,
      onProgress: (p) => {
        /*
          A live tick that found nothing does not touch the panel.

          Otherwise every three minutes the progress line would blink through "0 / 214 journals" and
          back, which reads as something going wrong. A tick that actually sends is worth showing.
        */
        if (silent && p.eventsSent === 0 && !p.error) return;
        store.setEdsmUploadProgress(p);
        push();
      },
    })
      .catch((e: unknown) => {
        // `runEdsmCatchUp` does not throw, so this is belt and braces — but a rejected promise that
        // left the flag set would make the button dead until a restart.
        console.error("[edsm] catch-up:", e);
      })
      .finally(() => {
        edsmCatchUpRunning = false;
        push();
      });
    return { ok: true };
  }

  /**
   * The live loop.
   *
   * Unref'd so it never holds the process open, and it asks `startEdsmRun` rather than checking the
   * switches itself — a commander who turns the upload off mid-tick gets the same refusal the button
   * would get.
   */
  const edsmLiveTimer = setInterval(() => {
    if (!store.edsmLiveUploadEnabled) return;
    startEdsmRun(EDSM_LIVE_SCOPE, true);
  }, EDSM_LIVE_INTERVAL_MS);
  edsmLiveTimer.unref?.();

  /**
   * Contributing discoveries back to Canonn, when the commander has asked for it.
   *
   * Off unless the toggle says otherwise, and fed only from the live tail — the historical replay
   * calls `store.apply` directly, which is what keeps switching it on from uploading four years of
   * journals in one burst. See `canonnUpload.ts` for what is sent and what the commander gives up.
   */
  const canonnUploader = new CanonnUploader({
    isEnabled: () => store.canonnUploadEnabled,
    cmdrName: () => store.commanderName,
    onResult: (ok) => store.recordCanonnUploadResult(ok),
    gameState: () => {
      const addr = store.currentSystemAddress;
      const pos = addr != null ? store.systemPositions.get(addr) : undefined;
      const name = store.currentSystem?.trim();
      if (!name) return null;
      return {
        systemName: name,
        ...(pos ? { systemCoordinates: [pos.x, pos.y, pos.z] as [number, number, number] } : {}),
        clientVersion: CANONN_CLIENT_VERSION,
        isBeta: false,
        platform: "PC" as const,
      };
    },
  });
  if (store.canonnUploadEnabled) void canonnUploader.loadWhitelist();

  /**
   * Sending live events to EDDN, when the commander has asked for it. Same live-only arrangement as
   * Canonn: `offer` is called from the live tail only. After every re-merge the sender re-learns the
   * session (game version, expansion flags, current system) from the newest journal file through
   * `observe` — see `primeEddnFromNewestJournal` — and that path never sends.
   */
  const eddnUploader = new EddnUploader({
    isEnabled: () => store.eddnUploadEnabled,
    cmdrName: () => store.commanderName,
    onResult: (ok) => store.recordEddnUploadResult(ok),
    testMode: process.env.EDEXO_EDDN_TEST === "1",
    readStatus: () => {
      try {
        return JSON.parse(readFileSync(path.join(getJournalDir(), "Status.json"), "utf8")) as Record<
          string,
          unknown
        >;
      } catch {
        return null;
      }
    },
    readNavRoute: () => {
      try {
        return JSON.parse(readFileSync(path.join(getJournalDir(), "NavRoute.json"), "utf8")) as unknown;
      } catch {
        return null;
      }
    },
  });

  /** Re-learn the session from the newest log without sending anything. */
  async function primeEddnFromNewestJournal(): Promise<void> {
    eddnUploader.resetSession();
    const journalPath = getJournalPath();
    if (!journalPath) return;
    try {
      await readJournalFull(journalPath, (line) => eddnUploader.observe(line));
    } catch {
      /* the sender stays unprimed, which means it sends nothing until the next Fileheader */
    }
  }

  /**
   * `StartJump` is the countdown and names the destination; the rest are arrivals.
   *
   * Asking at the countdown spends the hyperspace transit on the request instead of making the
   * commander wait once they are already there. A `StartJump` with `JumpType: "Supercruise"` names
   * no system and is ignored.
   */
  function maybeAutoFetchOnArrival(line: JournalLine): void {
    const event = line.event;
    const systemName = typeof line.StarSystem === "string" ? line.StarSystem : "";
    const systemAddress = typeof line.SystemAddress === "number" ? line.SystemAddress : NaN;
    if (!systemName || !Number.isFinite(systemAddress)) return;
    if (event === "StartJump") {
      if (line.JumpType !== "Hyperspace") return;
      edsmAutoFetcher.onJumpStarted(systemAddress, systemName);
      return;
    }
    if (event !== "FSDJump" && event !== "CarrierJump" && event !== "Location") return;
    edsmAutoFetcher.onArrivedInSystem(systemAddress, systemName);
  }

  return {
    canonnUploader,
    eddnUploader,
    maybeAutoFetchOnArrival,
    primeEddnFromNewestJournal,
    startEdsmRun,
    cancelEdsmRun: (): void => {
      edsmCatchUpCancelled = true;
    },
  };
}
