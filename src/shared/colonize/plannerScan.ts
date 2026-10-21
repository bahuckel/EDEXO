import type { ColonizeSnapshot, DepotSnapshot } from "./types";

/** Default ref for material search — pinned hub, else first build system. */
export function primaryCheckoutReferenceSystem(
  snap: ColonizeSnapshot | null,
  depotRef: (d: DepotSnapshot) => string,
  override?: string,
): string {
  if (override?.trim()) return override.trim();
  const first = snap?.activeDepots?.[0];
  if (first) {
    const r = depotRef(first)?.trim();
    if (r) return r;
  }
  return (
    snap?.liveDocked?.starSystem?.trim() ||
    snap?.navContext?.starSystem?.trim() ||
    snap?.completedDepots[0]?.starSystem?.trim() ||
    ""
  );
}

/** Pinned shopping hub or depot star — used for Spansh buy search origin only. */
export function plannerConstructionReferenceSystems(
  snap: ColonizeSnapshot,
  depotRef: (d: DepotSnapshot) => string,
): string[] {
  const systems = new Set<string>();
  for (const d of snap.activeDepots) {
    const pinned = depotRef(d)?.trim();
    const build = d.starSystem?.trim();
    if (pinned) systems.add(pinned);
    else if (build) systems.add(build);
  }
  return [...systems];
}

/** Distinct construction-site stars from active depots (display order, first-seen casing). */
export function uniqueConstructionSystems(depots: DepotSnapshot[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of depots) {
    const s = d.starSystem?.trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** Actual construction site star systems — Milky Way Ly is always from here, never the pinned hub. */
export function constructionSiteSystems(
  snap: ColonizeSnapshot,
  depotRef?: (d: DepotSnapshot) => string,
): string[] {
  const systems = new Set<string>();
  for (const d of snap.activeDepots) {
    const build = d.starSystem?.trim();
    if (build) {
      systems.add(build);
      continue;
    }
    // Journal replay may not have replayed FSD yet — pinned ref is the user's construction star.
    const pinned = depotRef?.(d)?.trim();
    if (pinned) systems.add(pinned);
  }
  return [...systems];
}
