import type { Ly } from "./systemDistanceLy";
import type { MaterialBuyStationHit } from "./materialBuyIndexTypes";

export type BuyIndexStationResult = {
  systemName: string;
  stationName: string;
  marketId: string;
  bodyName: string | null;
  stationType: string | null;
  isPlanetaryOrGround: boolean;
  materialCount: number;
  minDistanceLy: Ly;
  /** From his journal (2026-10-22): times he bought what was searched here, and his last visit. */
  boughtCount?: number;
  lastVisitIso?: string | null;
};

export type BuyIndexStationMaterial = {
  commodityId: string;
  label: string;
  buyPrice: number | null;
  supply: number | null;
  distanceLy: Ly;
  hit: MaterialBuyStationHit;
};
