/*
  The launcher's EDSM, Canonn and EDDN switches and the two system look-ups that fill a map from them (split out of
  edexoBootstrap.ts, plan 2026-11-10 Phase 7.1).
*/
import type { GameStateStore } from "./gameState.js";
import type { HttpServerOptions } from "./httpServerTypes.js";
import type { createCommunityUploads } from "./communityUploads.js";
import type { createRemoteSystemView } from "./remoteSystemView.js";
import {
  edsmCredentialsStatus,
  forgetEdsmCredentials,
  readEdsmCredentials,
  saveEdsmCredentials,
} from "./edsmCredentials.js";
import { fetchEdsmBodiesAsExplorationRecords } from "./edsmSystemHydration.js";
import { fetchSpanshBodiesAsExplorationRecords } from "./spanshSystemHydration.js";

type UploadSettingsKeys =
  | "hydrateSystemFromEdsm"
  | "hydrateSystemFromSpansh"
  | "getEdsmCredentialsStatus"
  | "setEdsmCredentials"
  | "forgetEdsmCredentials"
  | "setEdsmAutoFetchEnabled"
  | "setEdsmUploadEnabled"
  | "startEdsmCatchUp"
  | "setEdsmLiveUploadEnabled"
  | "cancelEdsmCatchUp"
  | "setCanonnUploadEnabled"
  | "setEddnUploadEnabled";

export function uploadSettingsOptions({
  store,
  persistUserPreferences,
  uploads,
  hydrateGate,
}: {
  store: GameStateStore;
  persistUserPreferences: () => void;
  uploads: ReturnType<typeof createCommunityUploads>;
  hydrateGate: ReturnType<typeof createRemoteSystemView>["hydrateGate"];
}): Pick<HttpServerOptions, UploadSettingsKeys> {
  return {
    hydrateSystemFromEdsm: async (systemAddress, systemName) => {
      const gate = hydrateGate(systemAddress, "EDSM");
      if (gate) return gate;
      const edsm = await fetchEdsmBodiesAsExplorationRecords(
        systemName,
        systemAddress,
        readEdsmCredentials(),
      );
      if (!edsm.ok) return { ok: false, error: edsm.error };
      store.replaceEdsmExplorationForSystem(systemAddress, edsm.records);
      return { ok: true };
    },
    hydrateSystemFromSpansh: async (systemAddress, systemName) => {
      const gate = hydrateGate(systemAddress, "Spansh");
      if (gate) return gate;
      const sp = await fetchSpanshBodiesAsExplorationRecords(systemAddress, systemName);
      if (!sp.ok) return { ok: false, error: sp.error };
      store.replaceEdsmExplorationForSystem(systemAddress, sp.records);
      return { ok: true };
    },
    getEdsmCredentialsStatus: () => edsmCredentialsStatus(),
    setEdsmCredentials: (commanderName, apiKey) => {
      const r = saveEdsmCredentials(commanderName, apiKey);
      if (r.ok) persistUserPreferences();
      return r;
    },
    forgetEdsmCredentials: () => {
      forgetEdsmCredentials();
      // No key, no consent: the toggle goes down with it rather than sitting on waiting for one.
      store.setEdsmAutoFetchEnabled(false);
      persistUserPreferences();
    },
    setEdsmAutoFetchEnabled: (enabled) => {
      if (enabled && !readEdsmCredentials()) {
        return { ok: false, error: "Store your EDSM commander name and API key first." };
      }
      store.setEdsmAutoFetchEnabled(enabled);
      persistUserPreferences();
      return { ok: true };
    },
    setEdsmUploadEnabled: (enabled) => {
      if (enabled && !readEdsmCredentials()) {
        return { ok: false, error: "Store your EDSM commander name and API key first." };
      }
      store.setEdsmUploadEnabled(enabled);
      // Switching the upload off takes the live loop with it, the way deleting the key takes
      // auto-fetch down. A "keep sending" left on under a switch that says off is a lie waiting to
      // be believed the next time the upload is turned back on.
      if (!enabled) store.setEdsmLiveUploadEnabled(false);
      persistUserPreferences();
      return { ok: true };
    },
    startEdsmCatchUp: (scope) => uploads.startEdsmRun(scope),
    setEdsmLiveUploadEnabled: (enabled) => {
      if (enabled && !store.edsmUploadEnabled) {
        return { ok: false, error: "Turn EDSM upload on first." };
      }
      store.setEdsmLiveUploadEnabled(enabled);
      persistUserPreferences();
      return { ok: true };
    },
    cancelEdsmCatchUp: uploads.cancelEdsmRun,
    setCanonnUploadEnabled: (enabled) => {
      store.setCanonnUploadEnabled(enabled);
      persistUserPreferences();
      // Asked for the first time it is switched on, not at boot: a commander who never turns this
      // on should not cost Canonn a request.
      if (enabled) void uploads.canonnUploader.loadWhitelist();
      return { ok: true };
    },
    setEddnUploadEnabled: (enabled) => {
      store.setEddnUploadEnabled(enabled);
      persistUserPreferences();
      return { ok: true };
    },
  };
}
