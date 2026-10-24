/**
 * Open the galaxy map on one of its drawers from elsewhere, in the Galaxy tab (Colonize's "Find colony sites"). It was
 * a link to `/?screen=galaxy&drawer=finder` in a new window (owner, 2026-10-23: "opens galaxy map in new window instead
 * of a tab"). Kept until the map takes it, since the map may not be mounted yet, and announced for one that already
 * is - the pattern of the header's "Next boxel" (expeditionFocus.ts). A module of its own, so the request does not pull
 * the lazy map into the window that asks.
 */
import { heldElsewhere, tabStore } from "./tabs/tabStore";

export type RequestableDrawer = "finder" | "stations" | "neutron";

export const GALAXY_DRAWER_EVENT = "edexo:galaxy-drawer";
let pending: RequestableDrawer | null = null;

export function openGalaxyDrawer(drawer: RequestableDrawer): void {
  pending = drawer;
  window.dispatchEvent(new CustomEvent(GALAXY_DRAWER_EVENT));
  tabStore.open("galaxy");
}

export function takeGalaxyDrawer(): RequestableDrawer | null {
  const d = pending;
  pending = null;
  return d;
}

/**
 * The request without taking it, for a render: a render can be thrown away (the drawer's lazy chunk suspends it on the
 * first open) and run again, and one that took the request left the next without it - the map opened with no Finder
 * (e2e, 2026-10-24). The map takes it once it is on screen.
 */
export function peekGalaxyDrawer(): RequestableDrawer | null {
  return pending;
}

/**
 * A plain click opens the tab; a modified one (new window, new tab) keeps the link's own behaviour. So does a click with
 * tab view off (no Galaxy tab to open: it did nothing) and one while the other app's window holds the Galaxy tab (that
 * window came forward without its drawer, and the request waited here to open the Finder by surprise later; review
 * 2026-10-24): the link opens the map on its drawer in a window of its own.
 */
export function onGalaxyDrawerLinkClick(drawer: RequestableDrawer) {
  return (e: { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault(): void }) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const tabs = tabStore.get();
    if (!tabs.on || (!tabs.tabs.includes("galaxy") && heldElsewhere("galaxy"))) return;
    e.preventDefault();
    openGalaxyDrawer(drawer);
  };
}
