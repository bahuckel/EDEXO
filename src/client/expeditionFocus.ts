/**
 * The two things the header's "Next boxel" (NextBoxelCard.tsx) needs from the expedition planner: the way to open
 * the map on a boxel, and the short credits format.
 *
 * Apart from ExpeditionDrawer.tsx (audit 2026-10-22): importing them from there put the drawer, the galaxy map's
 * menus (G3dMenu with its help texts), PickList and the clusters code into the first load of every app window, for
 * a header line. They stay in the lazy galaxy map's chunk now. One module, so `pendingFocus` is one value for the
 * card that sets it and the map that takes it; ExpeditionDrawer re-exports all of it.
 */
import type { ExpeditionBoxelDTO } from "@shared/dto/expedition";

type Xyz = { x: number; y: number; z: number };

/**
 * Open the map on a boxel from elsewhere (the header's "Next boxel", plan 2.7): kept until the map takes it,
 * since the map may not be mounted yet, and announced for a map that already is.
 */
export const EXPEDITION_FOCUS_EVENT = "edexo:expedition-focus";
let pendingFocus: { key: string; center: Xyz; cubeLy: number } | null = null;
export function requestExpeditionFocus(b: Pick<ExpeditionBoxelDTO, "key" | "center" | "cubeLy">): void {
  pendingFocus = { key: b.key, center: b.center, cubeLy: b.cubeLy };
  window.dispatchEvent(new CustomEvent(EXPEDITION_FOCUS_EVENT));
}
export function takeExpeditionFocus(): { key: string; center: Xyz; cubeLy: number } | null {
  const f = pendingFocus;
  pendingFocus = null;
  return f;
}

/** Credits, short: 7.9 M, 1.2 B. */
export function crShort(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)} k`;
  return String(Math.round(v));
}
