/**
 * Everything the commander has scanned, searchable — systems, bodies and stars.
 *
 * "My exobiology" showed the 373 species he had confirmed on foot, which is the certain end of a far
 * larger record: 3,406 systems, 18,127 bodies and 5,196 stars sit in the merged journals with their
 * physics already resolved, and none of it was reachable from the app. These are those three tables.
 *
 * ## One table shape, three column sets
 *
 * The three tabs differ only in their columns and their filters, so they share a renderer rather
 * than repeating a table three times. A column declares how to read a row, how to show it, and how
 * to sort it — the alternative, a `switch` per cell, is how the two species lists came to disagree
 * about photographs.
 *
 * ## Sorted, filtered and windowed
 *
 * 18,127 rows will not go in the DOM. The list is cut to {@link PAGE} after filtering and sorting,
 * with a count of what was left out, because a commander searching for a body wants the match and
 * not the scrollbar. Sorting happens before the cut, so "most valuable" means most valuable of
 * everything rather than of the first few hundred.
 */
import type { GreenGiantMark, GreenGiantVerdict } from "@shared/greenGasGiant";
import { useCallback, useDeferredValue, useEffect, useState } from "react";
import type { DiscoveriesDTO, DiscoveryBodyRow } from "@shared/types";
import type { DiscoveriesLayout } from "./ui/DataTable";
import { useToggleSet } from "./discoveries/filters";
import type { GreenEdit } from "./discoveries/GreenMarkControl";
import type { DiscoveriesTab, DiscoveriesTabContext } from "./discoveries/tabContext";
import { renderSystemsTab } from "./discoveries/systemsTab";
import { renderBodiesTab } from "./discoveries/bodiesTab";
import { renderStarsTab } from "./discoveries/starsTab";

// The table and its page size live in ui/ since the audit of 2026-10-22; re-exported for
// MyExobiologyModal and the tests, which import them from here.
export { PAGE } from "./ui/tablePage";
export { Table, type Column, type DiscoveriesLayout } from "./ui/DataTable";

// The tab type lives with the tabs since the audit of 2026-10-22; MyExobiologyModal imports it from here.
export type { DiscoveriesTab } from "./discoveries/tabContext";

export function DiscoveriesTables({
  data,
  tab,
  layout = "list",
  onNavigateSystem,
}: {
  data: DiscoveriesDTO;
  tab: DiscoveriesTab;
  layout?: DiscoveriesLayout;
  onNavigateSystem?: (systemAddress: number, bodyKey?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "estimated", dir: -1 });
  const [classFilter, toggleClass, clearClass] = useToggleSet();
  /*
    The commander's green gas giant calls made in this window (owner, 2026-09-30: "a True/False for
    the commander to mark them"). The server answers with the new verdict; it is shown at once and the
    list is not fetched again.
  */
  const [greenEdits, setGreenEdits] = useState<Map<string, GreenEdit>>(new Map());
  const greenOf = useCallback(
    (r: DiscoveryBodyRow): GreenEdit =>
      greenEdits.get(r.key) ?? { verdict: r.greenGiant ?? null, mark: r.greenMark ?? null },
    [greenEdits],
  );
  const markGreen = useCallback((r: DiscoveryBodyRow, mark: GreenGiantMark | null) => {
    const bodyId = Number(r.key.slice(r.key.indexOf(":") + 1));
    void fetch("/api/ggg/mark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemAddress: r.systemAddress, bodyId, mark }),
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ verdict: GreenGiantVerdict | null }>) : null))
      .then((j) => {
        if (!j) return;
        setGreenEdits((prev) => new Map(prev).set(r.key, { verdict: j.verdict, mark }));
      })
      .catch(() => {});
  }, []);
  const [flagFilter, toggleFlag, clearFlags] = useToggleSet();
  const [featureFilter, toggleFeature, clearFeatures] = useToggleSet();

  // Each tab has its own natural ordering and its own filter vocabulary; carrying one tab's sort
  // into another silently shows a table ordered by a column it does not have.
  useEffect(() => {
    setQuery("");
    clearClass();
    clearFlags();
    clearFeatures();
    setSort({ key: tab === "stars" ? "mass" : "estimated", dir: -1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const onSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: -1 }));

  const q = deferred.trim();

  const ctx: DiscoveriesTabContext = {
    data,
    tab,
    layout,
    onNavigateSystem,
    query,
    setQuery,
    q,
    sort,
    onSort,
    classFilter,
    toggleClass,
    flagFilter,
    toggleFlag,
    featureFilter,
    toggleFeature,
    greenOf,
    markGreen,
  };
  // Plain calls, not components, so a tab switch keeps the table mounted: see discoveries/tabContext.ts.
  if (tab === "systems") return renderSystemsTab(ctx);
  if (tab === "bodies") return renderBodiesTab(ctx);
  return renderStarsTab(ctx);
}
