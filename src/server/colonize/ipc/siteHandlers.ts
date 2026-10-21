/** Phase 9: look up a construction site by name and what it needs; follow trade-party carriers. */
import { parseMarketId } from "../../../shared/colonize/marketId";
import { lookupSiteNeeds, searchConstructionSites } from "../siteLookup";
import { lookUpPartyCarriers } from "../tradeParty";
import { errMessage, type ColonizeHandlers } from "./handlerTypes";
import { asRecord, trimmedString } from "./payload";

export function siteHandlers() {
  return {
    searchConstructionSites: async (payload) => {
      const p = asRecord(payload);
      const query = trimmedString(p.query);
      if (!query) return { ok: false as const, err: "Type part of the station's name." };
      try {
        return {
          ok: true as const,
          sites: await searchConstructionSites(query, trimmedString(p.referenceSystem)),
        };
      } catch (e) {
        return { ok: false as const, err: `Spansh search failed: ${errMessage(e)}` };
      }
    },

    lookupSiteNeeds: async (payload) => {
      const p = asRecord(payload);
      const systemName = trimmedString(p.systemName);
      const marketId = parseMarketId(p.marketId);
      if (!systemName || !marketId) return { ok: false as const, err: "Pick a site first." };
      try {
        return { ok: true as const, needs: await lookupSiteNeeds(systemName, marketId) };
      } catch (e) {
        return { ok: false as const, err: `Raven Colonial look-up failed: ${errMessage(e)}` };
      }
    },

    lookUpPartyCarriers: async (payload) => {
      const p = asRecord(payload);
      const callsigns = Array.isArray(p.callsigns)
        ? p.callsigns.filter((c): c is string => typeof c === "string")
        : [];
      try {
        return {
          ok: true as const,
          carriers: await lookUpPartyCarriers(callsigns, trimmedString(p.referenceSystem)),
        };
      } catch (e) {
        return { ok: false as const, err: `Spansh carrier look-up failed: ${errMessage(e)}` };
      }
    },
  } satisfies Partial<ColonizeHandlers>;
}
