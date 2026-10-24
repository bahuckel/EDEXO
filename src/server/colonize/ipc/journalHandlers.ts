/** The store's snapshot and what the commander sets about it (the journal folder and the EDSM key are EDEXO's). */
import type { WingMember } from "../../../shared/colonize/wingManifest";
import { readMarketSupplyBrief } from "../marketSupplyBrief";
import { syncWingCargoFromEdsm } from "../wingCargoSync";
import { errMessage, type ColonizeHandlers, type IpcContext } from "./handlerTypes";
import { asRecord } from "./payload";

export function journalHandlers({ store }: IpcContext) {
  return {
    getSnapshot: () => store.getSnapshot(),

    /**
     * A bad id changes nothing but still answers with the snapshot. It used to answer `undefined`,
     * which the renderer — promised a snapshot — would have stored as its whole state.
     */
    setDepotArchived: (marketId, archived) => {
      if (typeof marketId === "string") store.setDepotArchived(marketId, archived === true);
      return store.getSnapshot();
    },

    /**
     * SEC-6. This used to accept a directory from the renderer and read
     * `<dir>/Market.json` out of it. The store already knows the configured folder,
     * and it is the only one the app should ever read.
     */
    readMarketSupplyBrief: () => readMarketSupplyBrief(store.getJournalDir()),

    syncWingCargoFromEdsm: async (payload) => {
      if (!payload || typeof payload !== "object") return { ok: false as const, err: "Invalid payload." };
      const p = asRecord(payload);
      const rosterRaw = Array.isArray(p.roster) ? p.roster : [];
      const roster = rosterRaw
        .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object"))
        .map((x) => ({
          commanderName: typeof x.commanderName === "string" ? x.commanderName.trim() : "",
          lastSeenIso: typeof x.lastSeenIso === "string" ? x.lastSeenIso : new Date().toISOString(),
        }))
        .filter((x) => x.commanderName.length > 0);
      if (!roster.length) return { ok: false as const, err: "No wing mates in journal roster." };
      const existingRaw = Array.isArray(p.existing) ? p.existing : [];
      const existing = existingRaw.filter((x): x is WingMember =>
        Boolean(x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string"),
      );
      try {
        const { members, notes } = await syncWingCargoFromEdsm({
          roster,
          existing,
          edsmApiKey: store.getEdsmApiKey(),
          edsmCommanderName: store.getEdsmCommanderName(),
        });
        return { ok: true as const, members, notes };
      } catch (e) {
        return { ok: false as const, err: errMessage(e) };
      }
    },
  } satisfies Partial<ColonizeHandlers>;
}
