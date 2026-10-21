import type { Ly } from "./systemDistanceLy";
import type { CarrierStock } from "./carrierStock";
import type { ConstructionDepotRef } from "./constructionDepot";
import type { MaterialBuyListing } from "./materialBuyIndexTypes";
import type { ShopHistoryEntry } from "./shopHistory";

export type NavigationContext = {
  starSystem: string | null;
  systemAddress: number | null;
};

/** Renderer + main shared snapshot */
export type ResourceRow = {
  name: string;
  nameLocalised: string;
  required: number;
  provided: number;
  payment: number | null;
};

/** Your personal deliveries to a construction site (from `ColonisationContribution`). */
export type ContributionRecord = {
  commodityId: string;
  name: string;
  nameLocalised: string;
  totalTons: number;
  lastTimestamp: string | null;
};

export type ProgressHistoryPoint = {
  timestamp: string;
  progress: number;
};

export type DepotSnapshot = {
  marketId: string;
  starSystem: string | null;
  systemAddress: number | null;
  /** Raw station / construction name from Docked */
  stationName: string | null;
  constructionSiteLabel: string | null;
  progress: number | null;
  complete: boolean;
  failed: boolean;
  lastTimestamp: string | null;
  resources: ResourceRow[];
  /** Cumulative tons you contributed (journal replay + live tail). */
  contributions: ContributionRecord[];
  /** Progress samples from `ColonisationConstructionDepot` for timeline charts. */
  progressHistory: ProgressHistoryPoint[];
  /** Your delivery share over time (from `ColonisationContribution`). */
  contributionProgressHistory: ProgressHistoryPoint[];
};

export type LiveDockedInfo = {
  marketId: string;
  stationName: string;
  starSystem: string | null;
  timestamp: string | null;
} | null;

/** One line in the ship’s cargo hold from journal `Cargo` / `Cargo.json` (Vessel Ship only). */
export type ShipCargoLine = {
  name: string;
  nameLocalised: string;
  count: number;
};

export type BasketCheckoutItem = {
  id: string;
  name: string;
  nameLocalised: string;
  /** Tons still needed (depot gap minus cargo on hand when added from tracker). */
  quantityTons: number;
};

export type CheckoutRoutingMode = "fewest_stops" | "nearest" | "cheapest";

export type CheckoutFilters = {
  includePlanetaryAndGround: boolean;
  maxDistanceLy: number | null;
  minSupply: number | null;
  largePadOnly: boolean;
  minLandingPad?: "any" | "M" | "L";
  stationKind?: "any" | "space" | "ground";
  excludeFleetCarriers: boolean;
  /** Construction site systems — surface markets in these systems are allowed. */
  constructionSystems?: string[];
  /** Commander's current dock — always eligible even when surface &gt; 15 Ly. */
  dockedStation?: { systemName: string; stationName: string } | null;
  /** Stations from dock history — always kept in scan results. */
  knownShopStations?: { systemName: string; stationName: string }[];
  /** Market.json snapshots from dock history — inject when Spansh omits a visited station. */
  /** Active construction depots — never treated as buy stations. */
  constructionDepots?: ConstructionDepotRef[];
  /** Background Spansh scans stop once this many distinct seller systems are saved per SKU. */
  maxSystemsPerMaterial?: number | null;
  shopMarketSnapshots?: {
    systemName: string;
    stationName: string;
    marketId?: string;
    constructionDistanceLy?: number | null;
    offers: { commodityId: string; label: string; supply: number; buyPrice: number | null }[];
  }[];
};

export type CheckoutOfferSource = "journal" | "edsm" | "spansh" | "inara";

export type CheckoutCommodityOffer = {
  id: string;
  label: string;
  spanshCommodity: string;
  quantityNeeded: number;
  buyPrice: number | null;
  supply: number | null;
  /** Where price/stock was resolved. */
  dataSource?: CheckoutOfferSource;
};

/** Spansh-powered station routing for basket checkout (Inara API has no market data). */
export type CheckoutStationGroup = {
  groupIndex: number;
  systemName: string;
  stationName: string;
  distanceLy: Ly;
  marketId: string;
  commodityIds: string[];
  commodityLabels: string[];
  spanshCommodities: string[];
  commodities: CheckoutCommodityOffer[];
  /** Sum of buy_price × quantity when prices known. */
  estimatedCost: number | null;
  /** Spansh: planetary port / similar (see `stationType`). */
  isPlanetaryOrGround?: boolean;
  /** Spansh station `type` when present (e.g. Coriolis Starport, Settlement). */
  stationType?: string | null;
  /** Orbiting body or planet (Spansh `body_name`). */
  bodyName?: string | null;
  /** Spansh `market_updated_at` or journal `Market.json` timestamp when known. */
  marketUpdatedAt?: string | null;
};

/** Every Spansh station that stocks at least one needed commodity (full scan, not just route stops). */
export type CheckoutStationCatalogEntry = {
  systemName: string;
  stationName: string;
  marketId: string;
  distanceLy: Ly;
  isPlanetaryOrGround: boolean;
  stationType: string | null;
  bodyName?: string | null;
  commodities: CheckoutCommodityOffer[];
};

export type BasketCheckoutResult = {
  referenceSystem: string;
  groups: CheckoutStationGroup[];
  /** All qualifying buy stations from EDSM / Spansh — used by logistics planner. */
  catalogStations?: CheckoutStationCatalogEntry[];
  /** Every known seller per material (nearest first), including persisted index rows. */
  materialListings?: MaterialBuyListing[];
  unresolved: { id: string; label: string; quantityNeeded: number; tried: string[] }[];
  /** `market_json` = docked station file; `edsm` = EDSM market API; `spansh` = Spansh fallback. */
  dataSource?: "market_json" | "edsm" | "spansh";
  routingMode?: CheckoutRoutingMode;
  /** When checkout runs per construction site. */
  depotLabel?: string | null;
  /** Journal construction star — 3D Ly is measured from here (not pinned shopping hub). */
  constructionSiteSystem?: string | null;
  /** Market snapshot age when data is from `market_json`. */
  marketTimestamp?: string | null;
};

export type ShoppingRunItem = {
  id: string;
  label: string;
  quantityNeeded: number;
  stopIndex: number;
  stationName: string;
  systemName: string;
  bodyName?: string | null;
  done: boolean;
};

export type ShoppingRunState = {
  createdAt: string;
  items: ShoppingRunItem[];
};

/** Live dock market from `Market.json` (game client or EDMC). */
export type DockMarketBrief = {
  marketId: string | null;
  stationName: string;
  starSystem: string;
  timestamp: string | null;
  rowCount: number;
};

export type BasketCheckoutBundle = {
  plans: BasketCheckoutResult[];
};

/** Wing mates from journal `WingJoin` / cleared on `WingLeave`. */
export type WingRosterEntry = {
  commanderName: string;
  lastSeenIso: string;
};

/** A system the commander claimed (journal `ColonisationSystemClaim`, kept by EDEXO: shared/ownAssets.ts). */
export type OwnColony = { name: string; systemAddress: number; claimedAt: string };

export type ColonizeSnapshot = {
  /** The commander's colonies: what is built there is his own; a site elsewhere is helping someone else. */
  ownColonies: OwnColony[];
  journalDir: string;
  journalDirConfigured: boolean;
  /** Stored locally for future Inara commander/events integration (not used for market search). */
  /** EDSM API key saved for wing cargo sync (private inventories). */
  edsmApiKeyPresent: boolean;
  /** Other CMDRs in your wing (journal). Used for EDSM cargo sync. */
  wingRoster: WingRosterEntry[];
  /** Your own carriers and what the journal says they hold. Never someone else's. */
  carriers: CarrierStock[];
  liveJournalPath: string | null;
  /** Your active builds: docked at this construction or contributed, and not yet finished. */
  activeDepots: DepotSnapshot[];
  /** Finished tracked builds (expandable in UI). */
  completedDepots: DepotSnapshot[];
  /** Hidden via “Archive” until restored. */
  archivedDepots: DepotSnapshot[];
  /** Latest journal Docked / Undocked-derived location (not construction-only). */
  liveDocked: LiveDockedInfo;
  /** Last known position from Location / FSDJump / CarrierJump (may differ while dock UI omits jumps). */
  navContext: NavigationContext;
  /** Station economy label from last Docked (guessed archetype helper). */
  lastDockedEconomy: string | null;
  /** Live ship cargo (from `Cargo.json` + journal `Cargo` when inventory is inline). */
  shipCargo: ShipCargoLine[];
  /** Journal timestamp of the last cargo snapshot, if known. */
  shipCargoTimestamp: string | null;
  /** Ship cargo hold capacity from `Cargo.json` when known. */
  shipCargoCapacity: number | null;
  /** Latest parsed `Market.json` (refreshes when EDMC/game writes the file). */
  dockMarket: DockMarketBrief | null;
  /** Shops and purchases from journal `Market` / `MarketBuy` in the replay window. */
  journalShopHistory: ShopHistoryEntry[];
  /** True while the startup / rotation journal replay is running (UI busy strip). */
  replayBusy: boolean;
  lastError: string | null;
};
