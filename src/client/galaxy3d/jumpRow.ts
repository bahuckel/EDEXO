/**
 * A jumponium body row and its one-line summary, apart from the drawer (discuss item 26, owner 2026-10-23: the map's
 * drawers load when first opened; the hover tip and the side card need these at once).
 */
import { jumpElement, type JumpElement } from "@shared/jumponium";

export interface JumpRow {
  id: string;
  system: string;
  body: string;
  x: number;
  y: number;
  z: number;
  type: string | null;
  gravityG: number | null;
  distLs: number | null;
  pct: Partial<Record<JumpElement, number>>;
  own: boolean;
  distLy: number;
}

/** An element's share as the drawer and the card show it. */
export const pctLabel = (v: number) => (v >= 10 ? v.toFixed(1) : v.toFixed(2));

/** "Po 1.12 % · Y 2.30 %": a body's elements, carbon left out, for the map's hover and card. */
export function jumpLine(r: Pick<JumpRow, "pct">): string {
  return (Object.entries(r.pct) as [JumpElement, number][])
    .filter(([k]) => !jumpElement(k).common)
    .map(([k, v]) => `${jumpElement(k).symbol} ${pctLabel(v)} %`)
    .join(" · ");
}
