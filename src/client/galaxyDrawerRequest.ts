/**
 * Open the galaxy map on one of its drawers from elsewhere, in the Galaxy tab (Colonize's "Find colony sites"). It was
 * a link to `/?screen=galaxy&drawer=finder` in a new window (owner, 2026-10-23: "opens galaxy map in new window instead
 * of a tab"). Kept until the map takes it, since the map may not be mounted yet, and announced for one that already
 * is - the pattern of the header's "Next boxel" (expeditionFocus.ts). A module of its own, so the request does not pull
 * the lazy map into the window that asks.
 */
import { tabStore } from "./tabs/tabStore";

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

/** A plain click opens the tab; a modified one (new window, new tab) keeps the link's own behaviour. */
export function onGalaxyDrawerLinkClick(drawer: RequestableDrawer) {
  return (e: { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault(): void }) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openGalaxyDrawer(drawer);
  };
}
