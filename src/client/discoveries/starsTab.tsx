/**
 * The Stars tab of My discoveries: its columns, its filters and its table (moved out of
 * DiscoveriesTables.tsx, audit 2026-10-22).
 *
 * A render function, not a component: see tabContext.ts.
 */
import type { DiscoveryStarRow } from "@shared/types";
import { fuzzyRankAny } from "../fuzzyMatch";
import { CopySystemButton } from "../CopySystemButton";
import { Table, type Column } from "../ui/DataTable";
import { ChipRow, featureOptions, hasPickedFeature, Search, topValues } from "./filters";
import { cr, date, num } from "./format";
import type { DiscoveriesTabContext } from "./tabContext";

export function renderStarsTab({
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
}: DiscoveriesTabContext) {
  const columns: Column<DiscoveryStarRow>[] = [
    {
      key: "name",
      label: "Star",
      value: (r) => r.bodyName,
      render: (r) => (
        <>
          {onNavigateSystem ? (
            <button type="button" className="disc-link" onClick={() => onNavigateSystem(r.systemAddress)}>
              {r.bodyName}
            </button>
          ) : (
            r.bodyName
          )}
          <CopySystemButton system={r.system} />
        </>
      ),
    },
    {
      key: "type",
      label: "Class",
      value: (r) => r.starType,
      render: (r) => `${r.starType}${r.subclass != null ? r.subclass : ""}`,
    },
    { key: "lum", label: "Lum", value: (r) => r.luminosity, render: (r) => r.luminosity ?? "—" },
    {
      key: "mass",
      label: "Mass",
      numeric: true,
      value: (r) => r.solarMasses,
      render: (r) => (r.solarMasses == null ? "—" : `${num(r.solarMasses, 3)} M☉`),
    },
    {
      key: "radius",
      label: "Radius",
      numeric: true,
      value: (r) => r.radiusSolar,
      render: (r) => (r.radiusSolar == null ? "—" : `${num(r.radiusSolar, 3)} R☉`),
      title: "Solar radii, as the game shows a star",
    },
    {
      key: "temp",
      label: "Temp",
      numeric: true,
      value: (r) => r.surfaceTemperatureK,
      render: (r) => (r.surfaceTemperatureK == null ? "—" : `${num(r.surfaceTemperatureK)} K`),
    },
    {
      key: "estimated",
      label: "Estimated",
      numeric: true,
      value: (r) => r.estimatedCredits,
      render: (r) => cr(r.estimatedCredits),
    },
    { key: "region", label: "Region", value: (r) => r.region, render: (r) => r.region ?? "—" },
    {
      key: "system",
      label: "System",
      value: (r) => r.system,
      render: (r) => (
        <>
          {r.system}
          <CopySystemButton system={r.system} />
        </>
      ),
    },
    { key: "when", label: "Scanned", value: (r) => r.scannedAt, render: (r) => date(r.scannedAt) },
  ];

  /*
    Every star type, for the same reason as planet class.

    The cap of 16 hid seven of this commander's 23, and they were the ones worth filtering for:
    neutron stars (2), Wolf-Rayet (1), Herbig Ae/Be (2) and three white-dwarf classes. A black hole
    survived at rank 12 by luck rather than design. Twenty-three chips is the same order as the
    seventeen on Bodies and reads as one row.
  */
  const types = topValues(data.stars, (r) => r.starType, Infinity);
  const filtered = data.stars.filter((r) => {
    if (classFilter.size && !classFilter.has(r.starType)) return false;
    // Same question, same answer as the other two tabs. A secondary star in somebody else's system
    // is his to have scanned first and still not his system.
    if (flagFilter.has("first") && r.firstDiscoveredSystem !== true) return false;
    if (flagFilter.has("bodyfirst") && !r.firstDiscoverer) return false;
    if (!hasPickedFeature(featureFilter, r.featureKeys)) return false;
    if (!q) return true;
    return fuzzyRankAny([r.bodyName, r.system, r.starType, r.luminosity ?? "", r.region ?? ""], q) != null;
  });

  return (
    <>
      <Search query={query} setQuery={setQuery} n={filtered.length} of={data.stars.length} what="stars" />
      <ChipRow label="Class" options={types} picked={classFilter} onToggle={toggleClass} />
      <ChipRow
        label="Only"
        options={[
          { key: "first", label: "First discovery" },
          { key: "bodyfirst", label: "First to scan this star" },
        ]}
        picked={flagFilter}
        onToggle={toggleFlag}
      />
      <ChipRow
        label="Feature"
        options={featureOptions(data.stars)}
        picked={featureFilter}
        onToggle={toggleFeature}
      />
      <Table
        rows={filtered}
        columns={columns}
        sort={sort}
        onSort={onSort}
        rowKey={(r) => r.key}
        csvName="discoveries stars"
        empty="No stars match."
        layout={layout}
        resetKey={`${q}|${tab}`}
      />
    </>
  );
}
