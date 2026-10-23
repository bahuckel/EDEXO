/**
 * A construction site's materials in the one order every view uses (owner, 2026-10-22): what is still needed first,
 * biggest first; a material delivered in full goes to the bottom (green in the window, gone from the HUD). The window's
 * site cards, its "Docked at your site" panel, the phone view and the HUD summary all read it from here, so they agree.
 */
import { resourceNeedId } from "./commodityKey";
import type { DepotSnapshot, ResourceRow } from "./types";

export type SiteMaterial = {
  /** resourceNeedId: the key cargo and plans use. */
  id: string;
  label: string;
  required: number;
  provided: number;
  /** Still to deliver. */
  left: number;
  /** Delivered in full. */
  done: boolean;
  /** Of what is left, how much is aboard (never more than `left`). */
  aboard: number;
};

export const resourceLeft = (r: Pick<ResourceRow, "required" | "provided">): number => Math.max(0, r.required - r.provided);

export function siteMaterials(d: Pick<DepotSnapshot, "resources">, aboardByKey?: ReadonlyMap<string, number>): SiteMaterial[] {
  const rows: SiteMaterial[] = [];
  for (const r of d.resources) {
    if (!(r.required > 0)) continue;
    const id = resourceNeedId(r);
    const left = resourceLeft(r);
    rows.push({
      id,
      label: r.nameLocalised || r.name,
      required: r.required,
      provided: r.provided,
      left,
      done: left <= 0,
      aboard: Math.min(left, (id && aboardByKey?.get(id)) || 0),
    });
  }
  return rows.sort((a, b) => Number(a.done) - Number(b.done) || b.left - a.left || a.label.localeCompare(b.label));
}

/** Tons required and left, and how far along it is (the journal's own figure when it gave one), 0-100. */
export function siteTotals(d: Pick<DepotSnapshot, "resources" | "progress">): { required: number; remaining: number; pct: number } {
  const required = d.resources.reduce((a, r) => a + r.required, 0);
  const remaining = d.resources.reduce((a, r) => a + resourceLeft(r), 0);
  const pct = d.progress != null ? d.progress * 100 : required > 0 ? ((required - remaining) / required) * 100 : 0;
  return { required, remaining, pct: Math.max(0, Math.min(100, pct)) };
}

/** Tons still needed per commodity across sites (a buy line whose commodity no site needs any more is finished). */
export function tonsLeftById(depots: readonly Pick<DepotSnapshot, "resources">[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of depots) {
    for (const r of d.resources) {
      const id = resourceNeedId(r);
      if (id) out.set(id, (out.get(id) ?? 0) + resourceLeft(r));
    }
  }
  return out;
}
