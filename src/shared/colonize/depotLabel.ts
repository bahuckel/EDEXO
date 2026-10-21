import type { DepotSnapshot } from "./types";

type LabelSource = Pick<DepotSnapshot, "marketId" | "constructionSiteLabel" | "stationName" | "starSystem">;

/**
 * What the commander calls a construction site. For display only.
 *
 * S-8. Sites used to be matched by this label, so two sites that resolved to the same name shared
 * one allocation (and both were then handed its total), one set of trip ticks, and one
 * contribution baseline. They are keyed by `marketId` now; the label is what gets printed.
 */
export function depotDisplayLabel(d: LabelSource): string {
  return d.constructionSiteLabel || d.stationName || `Market ${d.marketId}`;
}

/**
 * A label per site that tells same-named sites apart: the system is added when two share a name,
 * and the market id when they share the system too. Sites with a unique name are unchanged.
 */
export function uniqueDepotLabels(depots: readonly LabelSource[]): Map<string, string> {
  const base = new Map(depots.map((d) => [d.marketId, depotDisplayLabel(d)]));
  const count = (labels: Iterable<string>) => {
    const c = new Map<string, number>();
    for (const l of labels) c.set(l, (c.get(l) ?? 0) + 1);
    return c;
  };
  const byName = count(base.values());
  const withSystem = new Map<string, string>();
  for (const d of depots) {
    const label = base.get(d.marketId)!;
    const sys = d.starSystem?.trim();
    withSystem.set(d.marketId, byName.get(label)! > 1 && sys ? `${label} (${sys})` : label);
  }
  const bySystem = count(withSystem.values());
  const out = new Map<string, string>();
  for (const d of depots) {
    const label = withSystem.get(d.marketId)!;
    out.set(d.marketId, bySystem.get(label)! > 1 ? `${label} · ${d.marketId}` : label);
  }
  return out;
}
