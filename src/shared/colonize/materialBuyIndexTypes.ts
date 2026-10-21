import type { Ly } from "./systemDistanceLy";
import type { CheckoutOfferSource } from "./types";

/** One station that sells a commodity near a reference system. */
export type MaterialBuyStationHit = {
  systemName: string;
  stationName: string;
  marketId: string;
  distanceLy: Ly;
  buyPrice: number | null;
  supply: number | null;
  spanshCommodity: string;
  dataSource: CheckoutOfferSource;
  stationType?: string | null;
  isPlanetaryOrGround?: boolean;
  /** Inara / market pad size when known: S, M, or L. */
  pad?: string | null;
  /** Orbiting body or planet the station is built on (Spansh `body_name`). */
  bodyName?: string | null;
  marketUpdatedAt?: string | null;
  /** When this row was last confirmed (live search or cache write). */
  foundAtIso: string;
  /** Commander bought this commodity here (journal MarketBuy / dock history). */
  purchaseProven?: boolean;
};

export type MaterialBuyIndexRow = {
  commodityId: string;
  label: string;
  updatedAtIso: string;
  stations: MaterialBuyStationHit[];
};

export type MaterialBuyListing = {
  id: string;
  label: string;
  quantityNeeded: number;
  /** True when every station row came from the on-disk index (no live search this run). */
  servedFromCache: boolean;
  stations: MaterialBuyStationHit[];
};

export type MaterialBuyIndexFile = {
  version: 3;
  /** normSystemName(reference) → commodityId → row */
  systems: Record<string, Record<string, MaterialBuyIndexRow>>;
};
