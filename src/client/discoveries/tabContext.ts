/**
 * What each discoveries tab reads from the DiscoveriesTables component: its data, the search, the sort
 * and the filter sets, which live in the component so a tab switch can reset them.
 *
 * The tabs are render functions called with this, not components (audit 2026-10-22). All three draw a
 * <Table> at the same place in one element tree, so React keeps the table's measured row heights across
 * a tab switch, as it did when the three were branches of one function; a component per tab would
 * remount the table on every switch.
 */
import type { GreenGiantMark } from "@shared/greenGasGiant";
import type { DiscoveriesDTO, DiscoveryBodyRow } from "@shared/types";
import type { DiscoveriesLayout } from "../ui/DataTable";
import type { GreenEdit } from "./GreenMarkControl";

export type DiscoveriesTab = "systems" | "bodies" | "stars";

export interface DiscoveriesTabContext {
  data: DiscoveriesDTO;
  tab: DiscoveriesTab;
  layout: DiscoveriesLayout;
  onNavigateSystem?: (systemAddress: number, bodyKey?: string) => void;
  query: string;
  setQuery: (s: string) => void;
  /** The deferred query, trimmed: what the rows are filtered by. */
  q: string;
  sort: { key: string; dir: 1 | -1 };
  onSort: (key: string) => void;
  classFilter: Set<string>;
  toggleClass: (k: string) => void;
  flagFilter: Set<string>;
  toggleFlag: (k: string) => void;
  featureFilter: Set<string>;
  toggleFeature: (k: string) => void;
  greenOf: (r: DiscoveryBodyRow) => GreenEdit;
  markGreen: (r: DiscoveryBodyRow, mark: GreenGiantMark | null) => void;
}
