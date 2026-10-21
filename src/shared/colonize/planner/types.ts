import type { Ly } from "../systemDistanceLy";
import type { DepotSnapshot } from "../types";
import { type ShopHistoryEntry } from "../shopHistory";
import { type BannedStation } from "../stationBans";
import { type DockedStationRef, type MinLandingPad, type StationKindFilter } from "../stationFilter";
import type { SystemCoordsByNorm } from "./legLy";

/** Shapes the planner passes between its stages. */

export type PlannerNeed = {
  commodityId: string;
  label: string;
  tons: number;
  forDepots: string[];
};

export type PlannerStation = {
  key: string;
  systemName: string;
  stationName: string;
  marketId: string;
  distanceLy: Ly;
  isPlanetaryOrGround: boolean;
  stationType?: string | null;
  pad?: string | null;
  bodyName?: string | null;
  offers: Map<string, { label: string; supply: number; buyPrice: number | null }>;
};

export type TripBuyLine = {
  commodityId: string;
  label: string;
  buyTons: number;
  buyPrice: number | null;
  forDepots: string[];
  /** Global tons still needed after this buy is loaded. */
  stillNeedTotal: number;
};

export type TripDeliverMaterial = {
  commodityId: string;
  label: string;
  tons: number;
};

export type TripDeliverDepot = {
  /** The key (S-8). Two sites can share a label; they cannot share a market id. */
  depotMarketId: string;
  /** For display: unique among the active sites, see `uniqueDepotLabels`. */
  depotLabel: string;
  systemName: string;
  materials: TripDeliverMaterial[];
};

export type TripStop = {
  stopIndex: number;
  kind: "buy" | "deliver";
  systemName: string;
  stationName: string;
  distanceLy: Ly;
  marketId?: string;
  isPlanetaryOrGround?: boolean;
  bodyName?: string | null;
  stationType?: string | null;
  recentShop?: boolean;
  boughtBefore?: boolean;
  /** Ly from construction/colonization system to this seller. */
  constructionDistanceLy?: Ly;
  buys: TripBuyLine[];
  deliverTo: string[];
  /** Per construction site — materials to unload on this trip (0-ton sites omitted). */
  deliveries?: TripDeliverDepot[];
  /** Cargo tons in hold after this stop. */
  cargoLoaded: number;
};

export type HaulTrip = {
  tripNumber: number;
  loadTons: number;
  capacity: number;
  /** Approx. one-way Ly to all buy stops on this trip (nearest-neighbor order). */
  buyRouteLy: number;
  stops: TripStop[];
};

export type MissingBuyIndexedItem = {
  id: string;
  label: string;
  quantityTons: number;
};

export type LogisticsPlan = {
  homeSystem: string;
  capacity: number | null;
  cargoOnHand: number;
  cargoFree: number;
  totalRemainingTons: number;
  trips: HaulTrip[];
  warnings: string[];
  /** Materials with no seller in the local buy index — show Local / Spansh actions. */
  missingBuyIndexed: MissingBuyIndexedItem[];
  /** Indexed sellers exist but none pass trip filters — show Local / Spansh actions. */
  missingTripEligible: MissingBuyIndexedItem[];
  /** Buys for the station you are docked at right now (capacity-capped). */
  dockBuys: TripBuyLine[];
  /** Batch buy station key per commodity — aligns buy cards with trip routing. */
  buyStationKeyByCommodityId?: Record<string, string>;
};

/** Rank / distance from the buy-stations list (lower rank = nearer recommendation). */
export type BuyStationPreference = { rank: number; distanceLy: Ly };

export type MaterialBuyStationFilter = {
  largePadOnly?: boolean;
  minLandingPad?: MinLandingPad;
  stationKind?: StationKindFilter;
  excludeFleetCarriers?: boolean;
  maxDistanceLy?: number | null;
  bannedStations?: BannedStation[];
  dockedStation?: DockedStationRef | null;
  constructionSystems?: string[];
  /** Construction depots accept deliveries — never buy stations. */
  constructionDepots?: DepotSnapshot[];
  includeAllPlanetaryAndGround?: boolean;
  shopHistory?: ShopHistoryEntry[];
};

/** Primary closest target + systems already jumped to this trip (opportunistic stack). */
export type PackRouteContext = {
  primaryPreferred: Map<string, string>;
  committedSystems: Set<string>;
};

/** stationKey → commodity ids that listing data proves are sold there. */
export type ListingProof = Map<string, Set<string>>;

export type PackLine = {
  commodityId: string;
  label: string;
  buyTons: number;
  buyPrice: number | null;
  forDepots: string[];
};

export type DepotNeedState = {
  marketId: string;
  label: string;
  systemName: string;
  needs: Map<string, { label: string; tons: number }>;
};

/** Site `marketId` → commodity id → tons allocated to that site on this trip. */
export type TripAllocationMap = Map<string, Map<string, TripDeliverMaterial>>;

export type PackAllocCtx = {
  tripAllocation: TripAllocationMap;
  depotStates: DepotNeedState[];
};

export type PickBuyStationArgs = {
  catalog: Map<string, PlannerStation>;
  proof: ListingProof;
  needs: Map<string, PlannerNeed>;
  freeTons: number;
  history: ShopHistoryEntry[];
  bannedStations: BannedStation[];
  visited: Set<string>;
  activeDepots: DepotSnapshot[];
  constructionSystems: string[];
  includeAllPlanetaryAndGround: boolean;
  dockedStation?: DockedStationRef | null;
  lastStopLy: number | null;
  lastStopSystem: string | null;
  /** S-13: real leg lengths between sellers; without them a leg is the radial difference. */
  systemCoords?: SystemCoordsByNorm;
  largePadOnly?: boolean;
  minLandingPad?: MinLandingPad;
  stationKind?: StationKindFilter;
  excludeFleetCarriers?: boolean;
  maxDistanceLy?: number | null;
  buyPreference?: Map<string, BuyStationPreference>;
  routeCtx: PackRouteContext;
};
