/**
 * The galaxy map's drawers that load when first opened (discuss item 26, owner 2026-10-23): the map's own chunk is
 * smaller and opens sooner. They are fetched in the background once the map has drawn (preloadGalaxyDrawers), so a
 * drawer opened later is there at once; one opened before that shows a short "Loading" in its place.
 */
import { lazy } from "react";

const neutron = () => import("../NeutronDrawer");
const jumponium = () => import("./JumponiumDrawer");
const finder = () => import("./FinderDrawer");
const navRoute = () => import("../GalaxyNavRoutePanel");
const search = () => import("../GalaxySearchPanel");
const codex = () => import("./CodexMenu");
const carriers = () => import("../CarriersStations");

export const NeutronDrawer = lazy(() => neutron().then((m) => ({ default: m.NeutronDrawer })));
export const JumponiumDrawer = lazy(() => jumponium().then((m) => ({ default: m.JumponiumDrawer })));
export const FinderDrawer = lazy(() => finder().then((m) => ({ default: m.FinderDrawer })));
export const GalaxyNavRoutePanel = lazy(() => navRoute().then((m) => ({ default: m.GalaxyNavRoutePanel })));
export const GalaxySearchPanel = lazy(() => search().then((m) => ({ default: m.GalaxySearchPanel })));
export const CodexMenu = lazy(() => codex().then((m) => ({ default: m.CodexMenu })));
export const CarriersStationsTabs = lazy(() => carriers().then((m) => ({ default: m.CarriersStationsTabs })));
export const CarriersStationsBody = lazy(() => carriers().then((m) => ({ default: m.CarriersStationsBody })));

let preloaded = false;
/** Fetch every drawer while the browser is idle; once a session. */
export function preloadGalaxyDrawers(): void {
  if (preloaded) return;
  preloaded = true;
  const go = () => {
    for (const load of [neutron, jumponium, finder, navRoute, search, codex, carriers]) void load().catch(() => {});
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(go, { timeout: 4000 });
  else window.setTimeout(go, 1500);
}

/** In a drawer's place while it loads. */
export function DrawerLoading() {
  return (
    <aside className="g3d-drawer g3d-menu" aria-busy="true">
      <p className="g3d-panel__note">Loading…</p>
    </aside>
  );
}
