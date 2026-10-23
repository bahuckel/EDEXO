/**
 * The Systems tab of My discoveries: its columns, its filters and its table (moved out of
 * DiscoveriesTables.tsx, audit 2026-10-22).
 *
 * A render function, not a component: see tabContext.ts.
 */
import type { DiscoverySystemRow } from "@shared/types";
import { fuzzyRankAny } from "../fuzzyMatch";
import { CopySystemButton } from "../CopySystemButton";
import { Table, type Column } from "../ui/DataTable";
import { ChipRow, featureOptions, hasPickedFeature, Search, topValues } from "./filters";
import { count, cr, date } from "./format";
import type { DiscoveriesTabContext } from "./tabContext";

export function renderSystemsTab({
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
  const columns: Column<DiscoverySystemRow>[] = [
    {
      key: "name",
      label: "System",
      value: (r) => r.name,
      render: (r) => (
        <>
          {onNavigateSystem ? (
            <button type="button" className="disc-link" onClick={() => onNavigateSystem(r.systemAddress)}>
              {r.name}
            </button>
          ) : (
            r.name
          )}
          <CopySystemButton system={r.name} />
        </>
      ),
    },
    { key: "region", label: "Region", value: (r) => r.region, render: (r) => r.region ?? "—" },
    {
      key: "star",
      label: "Star",
      value: (r) => r.primaryStarType,
      render: (r) => r.primaryStarType ?? "—",
      title: "Type of the arrival star",
    },
    { key: "stars", label: "Stars", numeric: true, value: (r) => r.stars, render: (r) => count(r.stars) },
    {
      key: "bodies",
      label: "Bodies",
      numeric: true,
      value: (r) => r.bodies,
      render: (r) => count(r.bodies),
    },
    {
      key: "landables",
      label: "Land",
      numeric: true,
      value: (r) => r.landables,
      render: (r) => count(r.landables),
      title: "Landable bodies",
    },
    {
      key: "bio",
      label: "Bio",
      numeric: true,
      value: (r) => r.bioSignals,
      render: (r) => count(r.bioSignals),
      title: "Biological signals across the system",
    },
    {
      key: "species",
      label: "Species",
      numeric: true,
      value: (r) => r.speciesConfirmed,
      render: (r) => count(r.speciesConfirmed),
      title: "Species confirmed on foot here",
    },
    {
      key: "firsts",
      label: "Firsts",
      numeric: true,
      value: (r) => r.firstDiscoveries,
      render: (r) => count(r.firstDiscoveries),
      title: "Bodies you were the first to discover",
    },
    {
      key: "estimated",
      label: "Estimated",
      numeric: true,
      value: (r) => r.estimatedCredits,
      render: (r) => cr(r.estimatedCredits),
      title: "What the app values the system's scan data at",
    },
    {
      key: "sold",
      label: "Sold",
      numeric: true,
      value: (r) => (r.soldExplorationCredits ?? 0) + (r.soldExobiologyCredits ?? 0) || null,
      render: (r) => {
        const e = r.soldExplorationCredits;
        const b = r.soldExobiologyCredits;
        if (e == null && b == null) return <span className="dim">—</span>;
        return (
          <span title={`Cartographic ${cr(e ?? 0)} · Exobiology ${cr(b ?? 0)}`}>
            {cr((e ?? 0) + (b ?? 0))}
          </span>
        );
      },
      title:
        "What selling actually paid. Exobiology is exact; cartographic is apportioned across a sale by body count.",
    },
    { key: "visited", label: "Visited", value: (r) => r.firstVisit, render: (r) => date(r.firstVisit) },
  ];

  const regions = topValues(data.systems, (r) => r.region);
  const filtered = data.systems.filter((r) => {
    if (classFilter.size && !(r.region && classFilter.has(r.region))) return false;
    if (flagFilter.has("bio") && r.bioSignals <= 0) return false;
    if (flagFilter.has("species") && r.speciesConfirmed <= 0) return false;
    /*
      Two different questions, and they used to share one chip.

      "First discovery" now means the system is his — the game decides that on the main star, and
      it is what puts his name on it. The old behaviour, at least one body he was first to scan,
      is still worth having and keeps its own chip: a system somebody else found where he still
      took bodies nobody had.

      The owner reported the old chip "showing systems that I recognize that I wasnt the first
      there", which is exactly what a body-count filter does.
    */
    if (flagFilter.has("sysfirst") && r.firstDiscoveredSystem !== true) return false;
    if (flagFilter.has("firsts") && r.firstDiscoveries <= 0) return false;
    if (flagFilter.has("footfall") && r.firstFootfalls <= 0) return false;
    if (flagFilter.has("sold") && r.soldExplorationCredits == null && r.soldExobiologyCredits == null)
      return false;
    if (flagFilter.has("unsold") && (r.soldExplorationCredits != null || r.soldExobiologyCredits != null))
      return false;
    if (flagFilter.has("earthlike") && r.earthLikes <= 0) return false;
    if (flagFilter.has("water") && r.waterWorlds <= 0) return false;
    if (flagFilter.has("ammonia") && r.ammoniaWorlds <= 0) return false;
    if (flagFilter.has("terra") && r.terraformables <= 0) return false;
    if (flagFilter.has("full") && !r.fullyScanned) return false;
    if (!hasPickedFeature(featureFilter, r.featureKeys)) return false;
    if (!q) return true;
    return fuzzyRankAny([r.name, r.region ?? "", r.primaryStarType ?? ""], q) != null;
  });

  return (
    <>
      <Search
        query={query}
        setQuery={setQuery}
        n={filtered.length}
        of={data.systems.length}
        what="systems"
      />
      <ChipRow label="Region" options={regions} picked={classFilter} onToggle={toggleClass} />
      <ChipRow
        label="Has"
        options={[
          { key: "bio", label: "Biology" },
          { key: "species", label: "Species found" },
          { key: "sysfirst", label: "First discovery" },
          { key: "firsts", label: "Has first-scanned bodies" },
          { key: "footfall", label: "First footfall" },
          { key: "earthlike", label: "Earth-like" },
          { key: "water", label: "Water world" },
          { key: "ammonia", label: "Ammonia world" },
          { key: "terra", label: "Terraformable" },
          { key: "full", label: "Fully scanned" },
          { key: "sold", label: "Sold" },
          { key: "unsold", label: "Unsold" },
        ]}
        picked={flagFilter}
        onToggle={toggleFlag}
      />
      <ChipRow
        label="Feature"
        options={featureOptions(data.systems)}
        picked={featureFilter}
        onToggle={toggleFeature}
      />
      <Table
        rows={filtered}
        columns={columns}
        sort={sort}
        onSort={onSort}
        rowKey={(r) => String(r.systemAddress)}
        csvName="discoveries systems"
        empty="No systems match."
        layout={layout}
        resetKey={`${q}|${tab}`}
      />
    </>
  );
}
