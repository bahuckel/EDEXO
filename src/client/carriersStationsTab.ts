/**
 * Carriers & Stations' tabs, title and remembered tab, apart from the panels (discuss item 26): the galaxy map reads
 * these at once, and loads the panels when its drawer first opens.
 */
import { isStr, usePersistedState } from "./usePersistedState";

export type CarriersStationsTab = "carriers" | "stations" | "tritium";
export const CARRIERS_STATIONS_TABS: { key: CarriersStationsTab; label: string }[] = [
  { key: "carriers", label: "Carriers" },
  { key: "stations", label: "Stations" },
  { key: "tritium", label: "Find Tritium" },
];
const isTab = (v: unknown): v is CarriersStationsTab => isStr(v) && CARRIERS_STATIONS_TABS.some((t) => t.key === v);

export const CARRIERS_STATIONS_TITLE = "Carriers & Stations";

type Point = { x: number; y: number; z: number };

/** What a picked row hands the map: where it is, and the Stations layer's id for a station's system. */
export interface CarriersStationsPick {
  at: Point;
  kind: "carrier" | "station" | "tritium";
  stationSys?: number;
}

export function useCarriersStationsTab() {
  return usePersistedState<CarriersStationsTab>("carriers.tab", "carriers", isTab);
}
