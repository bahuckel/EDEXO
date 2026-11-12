/**
 * The galaxy map's drawers that are only a frame around a panel from elsewhere (plan 7.3, moved out of
 * GalaxyMap3D.tsx unchanged): Carriers & Stations, NavRoute, Filter and Species search. The panels inside
 * still load when first opened (lazyDrawers.tsx); the map says what a pick does.
 */
import type { ComponentProps } from "react";
import { CARRIERS_STATIONS_TITLE } from "../carriersStationsTab";
import type { GalaxySearchApplied } from "../GalaxySearchPanel";
import { GalaxyFilterPanel } from "../GalaxyFilterPanel";
import { G3D_HELP, MenuHead } from "./G3dMenu";
import { CarriersStationsBody, CarriersStationsTabs, GalaxyNavRoutePanel, GalaxySearchPanel } from "./lazyDrawers";

export function StationsDrawer({
  tab,
  setTab,
  from,
  onPick,
}: ComponentProps<typeof CarriersStationsTabs> & Pick<ComponentProps<typeof CarriersStationsBody>, "from" | "onPick">) {
  return (
    <aside
      className="g3d-drawer g3d-menu g3d-plan g3d-stations-drawer"
      aria-label={CARRIERS_STATIONS_TITLE}
      data-testid="g3d-stations"
    >
      <MenuHead title={CARRIERS_STATIONS_TITLE} help={G3D_HELP.stations} />
      <div className="g3d-menu__section g3d-menu__section--first">
        <CarriersStationsTabs tab={tab} setTab={setTab} />
        <CarriersStationsBody tab={tab} compact from={from} onPick={onPick} />
      </div>
    </aside>
  );
}

export function NavRouteDrawer(p: ComponentProps<typeof GalaxyNavRoutePanel>) {
  return (
    <aside className="g3d-drawer g3d-drawer--filter" aria-label="NavRoute" data-testid="g3d-navroute">
      <MenuHead title="NavRoute" help={G3D_HELP.navroute} />
      <GalaxyNavRoutePanel {...p} />
    </aside>
  );
}

export function FilterDrawer(p: ComponentProps<typeof GalaxyFilterPanel>) {
  return (
    <aside className="g3d-drawer g3d-drawer--filter" aria-label="Filter" data-testid="g3d-filter">
      <MenuHead title="Filter" help={G3D_HELP.filter} />
      <GalaxyFilterPanel {...p} />
    </aside>
  );
}

export function SearchDrawer({
  onApply,
  commanderRegionId,
  search,
}: Pick<ComponentProps<typeof GalaxySearchPanel>, "onApply" | "commanderRegionId"> & {
  search: GalaxySearchApplied | null;
}) {
  return (
    <aside className="g3d-drawer g3d-drawer--search" aria-label="Search" data-testid="g3d-search">
      <MenuHead title="Species search" help={G3D_HELP.search} />
      <GalaxySearchPanel variant="menu" onApply={onApply} commanderRegionId={commanderRegionId} />
      {search ? (
        <p className="g3d-panel__note">
          {search.label}: {search.matchedSystems.toLocaleString()} systems in{" "}
          {search.spreadCells.toLocaleString()} sectors; the map shows one per sector (
          {search.hits.length.toLocaleString()}).
        </p>
      ) : null}
    </aside>
  );
}
