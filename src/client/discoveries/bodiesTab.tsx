/**
 * The Bodies tab of My discoveries: its columns, its filters (green gas giants among them) and its table
 * (moved out of DiscoveriesTables.tsx, audit 2026-10-22).
 *
 * A render function, not a component: see tabContext.ts.
 */
import { greenGiantLabel, greenGiantScoreText } from "@shared/greenGasGiant";
import type { DiscoveryBodyRow } from "@shared/types";
import { isTerraformableState } from "@shared/terraformState";
import { readableAtmosphereType } from "@shared/atmosphereLabel";
import { fuzzyRankAny } from "../fuzzyMatch";
import { CopySystemButton } from "../CopySystemButton";
import { Table, type Column } from "../ui/DataTable";
import { ChipRow, featureOptions, hasPickedFeature, Search, topValues } from "./filters";
import { cr, date, num } from "./format";
import { GreenMarkControl } from "./GreenMarkControl";
import type { DiscoveriesTabContext } from "./tabContext";

export function renderBodiesTab({
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
}: DiscoveriesTabContext) {
  const columns: Column<DiscoveryBodyRow>[] = [
    {
      key: "name",
      label: "Body",
      value: (r) => r.bodyName,
      // The icon after the body name copies the *system* (owner): the name to paste into the galaxy map.
      render: (r) => (
        <>
          {onNavigateSystem ? (
            <button
              type="button"
              className="disc-link"
              onClick={() => onNavigateSystem(r.systemAddress, r.key)}
            >
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
      key: "class",
      label: "Type",
      value: (r) => r.planetClass,
      render: (r) => (
        <>
          {r.planetClass}
          {(() => {
            const g = greenOf(r);
            return g.verdict ? (
              <span
                className={`disc-ggg disc-ggg--${g.verdict.level}`}
                title={`${greenGiantLabel(g.verdict)}: ${g.verdict.why}`}
              >
                {g.verdict.gggNumber
                  ? `green #${g.verdict.gggNumber}`
                  : `green · ${g.verdict.score != null ? greenGiantScoreText(g.verdict.score) : g.verdict.level}`}
              </span>
            ) : null;
          })()}
          {r.greenMark !== undefined ? <GreenMarkControl row={r} state={greenOf(r)} onMark={markGreen} /> : null}
        </>
      ),
    },
    {
      key: "atmo",
      label: "Atmosphere",
      value: (r) => readableAtmosphereType(r.atmosphere),
      render: (r) => readableAtmosphereType(r.atmosphere) ?? "—",
    },
    {
      key: "grav",
      label: "Gravity",
      numeric: true,
      value: (r) => r.gravityG,
      render: (r) => (r.gravityG == null ? "—" : `${num(r.gravityG, 2)} g`),
    },
    {
      key: "temp",
      label: "Temp",
      numeric: true,
      value: (r) => r.surfaceTemperatureK,
      render: (r) => (r.surfaceTemperatureK == null ? "—" : `${num(r.surfaceTemperatureK)} K`),
    },
    {
      key: "mass",
      label: "Mass",
      numeric: true,
      value: (r) => r.massEM,
      render: (r) => (r.massEM == null ? "—" : `${num(r.massEM, 3)} EM`),
    },
    {
      key: "radius",
      label: "Radius",
      numeric: true,
      value: (r) => r.radiusEarth,
      render: (r) => (r.radiusEarth == null ? "—" : `${num(r.radiusEarth, 3)} R⊕`),
      title: "Earth radii — the game's own frame, and free of the km/miles setting",
    },
    {
      key: "bio",
      label: "Bio",
      numeric: true,
      value: (r) => r.bioSignals,
      render: (r) => (r.bioSignals ? r.bioSignals : <span className="dim">—</span>),
    },
    {
      key: "species",
      label: "Found",
      value: (r) => r.speciesConfirmed.join(", ") || null,
      render: (r) =>
        r.speciesConfirmed.length ? (
          <span title={r.speciesConfirmed.join("\n")}>
            {r.speciesConfirmed.length === 1
              ? r.speciesConfirmed[0]
              : `${r.speciesConfirmed.length} species`}
          </span>
        ) : (
          <span className="dim">—</span>
        ),
      title: "Species you confirmed on foot",
    },
    {
      key: "estimated",
      label: "Estimated",
      numeric: true,
      value: (r) => r.estimatedCredits,
      render: (r) => cr(r.estimatedCredits),
    },
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

  // Every class present, however few: see `topValues`. Seventeen of them on this commander's
  // data, which is a readable row of chips and a complete one.
  const classes = topValues(data.bodies, (r) => r.planetClass, Infinity);
  const filtered = data.bodies.filter((r) => {
    if (classFilter.size && !classFilter.has(r.planetClass)) return false;
    if (flagFilter.has("landable") && r.landable !== true) return false;
    if (flagFilter.has("bio") && !(r.bioSignals && r.bioSignals > 0)) return false;
    if (flagFilter.has("species") && r.speciesConfirmed.length === 0) return false;
    if (flagFilter.has("dss") && !r.dssMapped) return false;
    /*
      "First discovery" asks the same question here as on the Systems tab: is the *system* his.

      It used to read the body's own flag, which is a different and much looser thing — first to
      scan a body in somebody else's system. Filtering Earth-likes gave **25** where the Systems
      tab, asking about the system, gave **6**. Both numbers were correct answers to different
      questions and only one of them is what the label says.

      The body's own flag keeps its own chip, because it is still worth asking.
    */
    if (flagFilter.has("first") && r.firstDiscoveredSystem !== true) return false;
    if (flagFilter.has("bodyfirst") && !r.firstDiscoverer) return false;
    if (flagFilter.has("footfall") && !r.firstFootfall) return false;
    if (flagFilter.has("terra") && !isTerraformableState(r.terraformState)) return false;
    if (flagFilter.has("volcanic") && !r.volcanism) return false;
    if (flagFilter.has("atmo") && !r.atmosphere) return false;
    if (flagFilter.has("green") && !greenOf(r).verdict) return false;
    if (!hasPickedFeature(featureFilter, r.featureKeys)) return false;
    if (!q) return true;
    return (
      fuzzyRankAny(
        [
          r.bodyName,
          r.system,
          r.planetClass,
          r.atmosphere ?? "",
          readableAtmosphereType(r.atmosphere) ?? "",
          r.volcanism ?? "",
          ...r.speciesConfirmed,
          greenOf(r).verdict ? `green gas giant ggg ${greenOf(r).verdict!.level}` : "",
          ...(r.features ?? []),
        ],
        q,
      ) != null
    );
  });

  return (
    <>
      <Search query={query} setQuery={setQuery} n={filtered.length} of={data.bodies.length} what="bodies" />
      <ChipRow label="Type" options={classes} picked={classFilter} onToggle={toggleClass} />
      <ChipRow
        label="Only"
        options={[
          { key: "landable", label: "Landable" },
          { key: "atmo", label: "Has atmosphere" },
          { key: "volcanic", label: "Volcanic" },
          { key: "bio", label: "Biology" },
          { key: "species", label: "Species found" },
          { key: "dss", label: "Mapped" },
          { key: "first", label: "First discovery" },
          { key: "bodyfirst", label: "First to scan this body" },
          { key: "footfall", label: "First footfall" },
          { key: "terra", label: "Terraformable" },
          { key: "green", label: "Green gas giant" },
        ]}
        picked={flagFilter}
        onToggle={toggleFlag}
      />
      <ChipRow
        label="Feature"
        options={featureOptions(data.bodies)}
        picked={featureFilter}
        onToggle={toggleFeature}
      />
      <Table
        rows={filtered}
        columns={columns}
        sort={sort}
        onSort={onSort}
        rowKey={(r) => r.key}
        csvName="discoveries bodies"
        empty="No bodies match."
        layout={layout}
        resetKey={`${q}|${tab}`}
      />
    </>
  );
}
