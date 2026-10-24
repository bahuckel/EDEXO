/**
 * The galaxy map's drawers that load when first opened (discuss item 26, owner 2026-10-23): the map's own chunk is
 * smaller and opens sooner. They are fetched in the background once the map has drawn (preloadGalaxyDrawers), so a
 * drawer opened later is there at once; one opened before that shows a short "Loading" in its place.
 */
import { lazy, type ComponentType } from "react";

const neutron = () => import("../NeutronDrawer");
const jumponium = () => import("./JumponiumDrawer");
const finder = () => import("./FinderDrawer");
const navRoute = () => import("../GalaxyNavRoutePanel");
const search = () => import("../GalaxySearchPanel");
const codex = () => import("./CodexMenu");
const carriers = () => import("../CarriersStations");

/*
  A chunk that cannot be fetched (a page left open across an app update: the chunk names change) used to throw out of
  the Suspense and blank the whole window (review 2026-10-24). It now loads a drawer that says so instead.
*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawer<M, C extends ComponentType<any>>(load: () => Promise<M>, pick: (m: M) => C, failed: ComponentType = DrawerFailed) {
  return lazy(() => load().then((m) => ({ default: pick(m) }), () => ({ default: failed as unknown as C })));
}
const Nothing = () => null;

export const NeutronDrawer = drawer(neutron, (m) => m.NeutronDrawer);
export const JumponiumDrawer = drawer(jumponium, (m) => m.JumponiumDrawer);
export const FinderDrawer = drawer(finder, (m) => m.FinderDrawer);
export const GalaxyNavRoutePanel = drawer(navRoute, (m) => m.GalaxyNavRoutePanel);
export const GalaxySearchPanel = drawer(search, (m) => m.GalaxySearchPanel);
export const CodexMenu = drawer(codex, (m) => m.CodexMenu);
export const CarriersStationsTabs = drawer(carriers, (m) => m.CarriersStationsTabs, Nothing);
export const CarriersStationsBody = drawer(carriers, (m) => m.CarriersStationsBody);

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

/** In a drawer's place when its chunk could not be fetched. */
function DrawerFailed() {
  return (
    <aside className="g3d-drawer g3d-menu" role="alert">
      <p className="g3d-panel__note">
        This drawer could not be loaded, most likely because the app was updated while this page was open.{" "}
        <button type="button" className="btn-mini" onClick={() => window.location.reload()}>
          Reload
        </button>
      </p>
    </aside>
  );
}
