/*
  The bell's routes: records, Notify me settings, read / unread / clear and the test notice (split out of
  edexoBootstrap.ts, plan 2026-11-10 Phase 7.1).
*/
import type { NotifySettingsDTO } from "../shared/notices.js";
import type { HttpServerOptions } from "./httpServerTypes.js";
import type { NoticesContext, NoticesService } from "./notices.js";
import { fetchGalacticRecords, readGalacticRecordsStatus } from "./galacticRecords.js";
import { readPoiStatus } from "./edastroPoi.js";
import { readCarrierStatus } from "./edastroCarriers.js";
import { setCodexFirstLowChanceKept } from "./snapshot.js";

type NoticesKeys =
  | "getNotifySettings"
  | "getRecords"
  | "fetchGalacticRecords"
  | "setNotifyPrefs"
  | "markNoticesRead"
  | "markNoticesUnread"
  | "clearReadNotices"
  | "sendTestNotice";

export function notifySettingsOf(notices: NoticesService, noticesContext: NoticesContext): NotifySettingsDTO {
  return {
    prefs: notices.prefs(),
    jumpLy: notices.jumpLy(noticesContext),
    poiDataReady: readPoiStatus().haveData,
    carrierDataReady: readCarrierStatus().haveData,
  };
}

export function noticesOptions({
  notices,
  noticesContext,
  push,
}: {
  notices: NoticesService;
  noticesContext: NoticesContext;
  push: () => void;
}): Pick<HttpServerOptions, NoticesKeys> {
  const notifySettings = () => notifySettingsOf(notices, noticesContext);
  /** A change to the bell's list goes out with the next push; none, nothing to send. */
  const pushed = (n: number): number => {
    if (n) push();
    return n;
  };
  return {
    getNotifySettings: notifySettings,
    getRecords: () => ({ rows: notices.records(noticesContext), galactic: readGalacticRecordsStatus() }),
    fetchGalacticRecords: async (force) => {
      await fetchGalacticRecords({ force });
      return { rows: notices.records(noticesContext), galactic: readGalacticRecordsStatus() };
    },
    setNotifyPrefs: (raw) => {
      const lowBefore = notices.prefs().codexFirstLowChance;
      notices.setPrefs(raw);
      // The switch changes rows of bodies already computed.
      if (notices.prefs().codexFirstLowChance !== lowBefore)
        setCodexFirstLowChanceKept(() => notices.prefs().codexFirstLowChance ?? true);
      push();
      return notifySettings();
    },
    markNoticesRead: (ids) => pushed(notices.markRead(ids)),
    markNoticesUnread: (ids) => pushed(notices.markUnread(ids)),
    clearReadNotices: () => pushed(notices.clearRead()),
    sendTestNotice: () => {
      notices.sendTest(new Date().toISOString());
      push();
    },
  };
}
