/**
 * The one description of the bridge between the Colonize window and the server.
 *
 * `colonizeApi.d.ts` used to describe this by hand, beside a preload that listed the channels by
 * hand and handlers that registered them by hand. Three copies drifted twice: a handler returned a
 * shape the declaration did not promise, and a method existed in one place but not the other.
 *
 * Now there is one list of methods and one set of signatures, and every side is derived from
 * them. In EDEXO (since 1.3.0) the two sides are the server and the Colonize window:
 *
 *   - the server's handlers are typed against `ColonizeInvoke` (src/server/colonize/ipc), so a
 *     missing handler, an extra one, or a return value that does not match is a compile error;
 *   - the server routes `POST /api/colonize/rpc/<method>` to them, and the window's client builds
 *     the same object over HTTP; the pushes ride the app's WebSocket.
 *
 * Window chrome, the journal folder and the EDSM key are EDEXO's own, so they are not here; a
 * file or folder the commander picks is picked in the window and handed over as a path or text.
 */
import type { ColonizeUiStateChange } from "../uiStateKeys";
import type { ClearBuyDataScope } from "../buyIndexClear";
import type { BuyIndexStationMaterial, BuyIndexStationResult } from "../buyIndexSearchTypes";
import type { ConstructionDepotRef } from "../constructionDepot";
import type { SystemCoordsByNorm } from "../galaxyDistanceCompute";
import type { MaterialBuyListing } from "../materialBuyIndexTypes";
import type { MaterialBuyScanStatus } from "../materialBuyScanStatus";
import type { ConstructionSiteHit, SiteNeeds } from "../siteLookup";
import type { PartyCarrier } from "../tradeParty";
import type { SpanshSystemDebugClientResult } from "../spanshSystemDebugTypes";
import type { BasketCheckoutBundle, CheckoutRoutingMode, ColonizeSnapshot, SupplyMarketRow } from "../types";
import type { WingMember } from "../wingManifest";

/**
 * Every request method, as a key list: the client builds its object from these keys and the server routes only
 * these names. `satisfies` keeps the list and `ColonizeInvoke` equal both ways. (They used to map to Electron
 * channel strings, which nothing read any more but still shipped in the client bundle.)
 */
export const COLONIZE_INVOKE = {
  getSnapshot: true,
  readMarketSupplyBrief: true,
  debugSpanshSystem: true,
  setDepotArchived: true,
  checkoutBasketMulti: true,
  scheduleActiveBasketScan: true,
  plannerMaterialsAtCap: true,
  schedulePlannerMaterialScan: true,
  syncWingCargoFromEdsm: true,
  getMaterialBuyScanStatus: true,
  resolveSystemDistances: true,
  resolveSystemCoords: true,
  searchConstructionSites: true,
  lookupSiteNeeds: true,
  lookUpPartyCarriers: true,
  searchBuyIndexSystem: true,
  searchBuyIndexStationsForMaterials: true,
  getBuyIndexStationCatalog: true,
  getDepotMaterialListings: true,
  getInaraImportDir: true,
  setInaraImportDir: true,
  openInaraImportDir: true,
  importInaraFile: true,
  clearSavedBuyData: true,
  askSpanshForMaterials: true,
} as const satisfies Record<keyof ColonizeInvoke, true>;

/** Every push, by listener method (keys only, as above). */
export const COLONIZE_EVENTS = {
  onUpdate: true,
  onMaterialBuyScanStatus: true,
  onInaraImport: true,
  onUiState: true,
} as const satisfies Record<keyof ColonizeEvents, true>;

type Fail = { ok: false; err: string };

export type MarketSupplyBriefResponse =
  | {
      ok: true;
      marketId: string | null;
      stationName: string;
      starSystem: string;
      stationEconomy: string | null;
      timestamp: string | null;
      rows: SupplyMarketRow[];
    }
  | Fail;

export type CheckoutBasketItemPayload = {
  id: string;
  name: string;
  nameLocalised: string;
  quantityTons: number;
};

export type CheckoutFiltersPayload = {
  maxDistanceLy?: number | null;
  minSupply?: number | null;
  largePadOnly?: boolean;
  minLandingPad?: "any" | "M" | "L";
  stationKind?: "any" | "space" | "ground";
  excludeFleetCarriers?: boolean;
  includePlanetaryAndGround?: boolean;
  constructionSystems?: string[];
  dockedStation?: { systemName: string; stationName: string } | null;
  constructionDepots?: ConstructionDepotRef[];
  maxSystemsPerMaterial?: number | null;
  knownShopStations?: { systemName: string; stationName: string }[];
  shopMarketSnapshots?: {
    systemName: string;
    stationName: string;
    marketId?: string;
    constructionDistanceLy?: number | null;
    offers: { commodityId: string; label: string; supply: number; buyPrice: number | null }[];
  }[];
};

export type InaraImportOutcome =
  | {
      ok: true;
      fileName: string;
      commodityLabel: string;
      nearSystem: string;
      merged: number;
      skipped: number;
    }
  | { ok: false; fileName: string; err: string };

type InaraDirResponse = { ok: true; dir: string; defaultDir: string };

/** Every request the window can make, as the window sees it. */
export type ColonizeInvoke = {
  getSnapshot: () => Promise<ColonizeSnapshot>;
  setDepotArchived: (marketId: string, archived: boolean) => Promise<ColonizeSnapshot>;
  /** Reads Market.json from the configured journal folder; the caller does not choose it. */
  readMarketSupplyBrief: () => Promise<MarketSupplyBriefResponse>;
  debugSpanshSystem: (payload: {
    systemName: string;
    includeStationMarkets?: boolean;
    stationNameFilter?: string;
  }) => Promise<SpanshSystemDebugClientResult>;
  /** One IPC for all construction refs — main runs the per-ref loop with yields. */
  checkoutBasketMulti: (payload: {
    referenceSystems: string[];
    journalDir?: string | null;
    includePlanetaryAndGround?: boolean;
    filters?: CheckoutFiltersPayload;
    routingMode?: CheckoutRoutingMode;
    skipCache?: boolean;
    forceLiveScan?: boolean;
    cacheOnly?: boolean;
    items: CheckoutBasketItemPayload[];
  }) => Promise<{ ok: true; bundle: BasketCheckoutBundle } | Fail>;
  scheduleActiveBasketScan: (payload: {
    referenceSystem: string;
    items: CheckoutBasketItemPayload[];
  }) => Promise<{ ok: true } | Fail>;
  plannerMaterialsAtCap: (payload: {
    referenceSystems: string[];
    items: CheckoutBasketItemPayload[];
    maxSystemsPerMaterial: number;
    /** A site's own cap by reference system, lower case (discuss item 1); the rest use maxSystemsPerMaterial. */
    maxSystemsByRef?: Record<string, number>;
    constructionDepots?: ConstructionDepotRef[];
  }) => Promise<{ ok: true; atCap: boolean; allFound: boolean } | Fail>;
  schedulePlannerMaterialScan: (payload: {
    referenceSystems: string[];
    items: CheckoutBasketItemPayload[];
    maxSystemsPerMaterial?: number | null;
    maxSystemsByRef?: Record<string, number>;
    constructionDepots?: ConstructionDepotRef[];
    /** "Look for sellers now": look even when every material already has a seller. */
    force?: boolean;
  }) => Promise<{ ok: true; scheduled: boolean; atCap: boolean; allFound: boolean } | Fail>;
  syncWingCargoFromEdsm: (payload: {
    roster: { commanderName: string; lastSeenIso: string }[];
    existing?: WingMember[];
  }) => Promise<{ ok: true; members: WingMember[]; notes: string[] } | Fail>;
  getMaterialBuyScanStatus: () => Promise<MaterialBuyScanStatus>;
  resolveSystemDistances: (payload: {
    fromSystems: string[];
    toSystems: string[];
  }) => Promise<{ ok: true; distances: Record<string, number> } | Fail>;
  /** Galaxy x/y/z keyed by normalized system name; a system nobody could place is left out. */
  resolveSystemCoords: (payload: { systems: string[] }) => Promise<{ ok: true; coords: SystemCoordsByNorm } | Fail>;
  /** Construction sites by name on Spansh; distances from `referenceSystem` when given. */
  searchConstructionSites: (payload: {
    query: string;
    referenceSystem?: string;
  }) => Promise<{ ok: true; sites: ConstructionSiteHit[] } | Fail>;
  /** What a site still needs, from Raven Colonial — `found: false` when nobody registered it. */
  lookupSiteNeeds: (payload: { systemName: string; marketId: string }) => Promise<{ ok: true; needs: SiteNeeds } | Fail>;
  /** Trade-party carriers by callsign, from Spansh (~15 min behind EDDN). */
  lookUpPartyCarriers: (payload: {
    callsigns: string[];
    referenceSystem?: string;
  }) => Promise<{ ok: true; carriers: PartyCarrier[] } | Fail>;
  searchBuyIndexSystem: (payload: { query: string }) => Promise<{ ok: true; stations: BuyIndexStationResult[] } | Fail>;
  searchBuyIndexStationsForMaterials: (payload: {
    query: string;
    systemName?: string;
  }) => Promise<{ ok: true; stations: BuyIndexStationResult[] } | Fail>;
  getBuyIndexStationCatalog: (payload: {
    systemName: string;
    stationName: string;
    marketId?: string | null;
  }) => Promise<{ ok: true; materials: BuyIndexStationMaterial[] } | Fail>;
  getDepotMaterialListings: (payload: {
    referenceSystem: string;
    distanceOrigin?: string;
    needs: { id: string; label: string; quantityTons: number }[];
    constructionDepots?: ConstructionDepotRef[];
    distanceBySystem?: Record<string, number>;
  }) => Promise<{ ok: true; listings: MaterialBuyListing[] } | Fail>;
  getInaraImportDir: () => Promise<InaraDirResponse>;
  /** A folder the commander picked in the window; null goes back to the default. */
  setInaraImportDir: (dir: string | null) => Promise<InaraDirResponse | Fail>;
  openInaraImportDir: () => Promise<{ ok: true } | Fail>;
  /** A scrape file the commander picked in the window, as its name and text. */
  importInaraFile: (payload: { fileName: string; text: string }) => Promise<InaraImportOutcome | Fail>;
  clearSavedBuyData: (payload?: { scope?: ClearBuyDataScope }) => Promise<{ ok: true; scope: ClearBuyDataScope } | Fail>;
  /** Search → Ask Spansh: sellers of each commodity asked for, near a system, saved with the others. */
  askSpanshForMaterials: (payload: { query: string; referenceSystem: string }) => Promise<{ ok: true; saved: number } | Fail>;
};

/** Every push from main, by listener method → payload. */
export type ColonizeEvents = {
  onUpdate: ColonizeSnapshot;
  onMaterialBuyScanStatus: MaterialBuyScanStatus;
  onInaraImport: InaraImportOutcome;
  /** Another window saved settings or progress (uiStateKeys.ts); `from` names it, so it can skip its own echo. */
  onUiState: ColonizeUiStateChange;
};

export type ColonizeListeners = {
  [K in keyof ColonizeEvents]: (fn: (payload: ColonizeEvents[K]) => void) => () => void;
};

/** What the Colonize window's client offers its components (HTTP + WebSocket underneath). */
export type ColonizeApi = ColonizeInvoke & ColonizeListeners;
