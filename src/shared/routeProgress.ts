/**
 * How far along a route is (review P11, owner 2026-11-05): "stop 37 of 112" counted every neutron star as a stop. A
 * neutron route reads "jump 37 of 112 · destination 1 of 2"; a route whose every stop is a destination (Spansh
 * exobiology, riches, a carrier's) keeps its stops, with the jumps beside them when there are more.
 */
import type { RouteProgressDTO } from "./dto/neutron.js";

/** From the route's hops (the first is the start) and the hop reached last; pure. */
export function routeProgress(hops: readonly { kind: string; jumps: number }[], at: number): RouteProgressDTO {
  let jump = 0;
  let jumps = 0;
  let dest = 0;
  let dests = 0;
  hops.forEach((h, i) => {
    if (i === 0) return;
    const n = Math.max(0, h.jumps || 0);
    jumps += n;
    if (h.kind === "waypoint") dests++;
    if (i <= at) {
      jump += n;
      if (h.kind === "waypoint") dest++;
    }
  });
  return { jump, jumps, dest, dests, stop: Math.max(0, at), stops: Math.max(0, hops.length - 1) };
}

/** "jump 37 of 112 · destination 1 of 2", or "stop 3 of 10 · jump 14 of 50" when every stop is a destination. */
export function routeProgressText(p: RouteProgressDTO): string {
  if (p.dests >= p.stops) return `stop ${p.stop} of ${p.stops}${p.jumps > p.stops ? ` · jump ${p.jump} of ${p.jumps}` : ""}`;
  return `jump ${p.jump} of ${p.jumps} · destination ${p.dest} of ${p.dests}`;
}

/** The short form for a chip: "37/112" jumps, or stops when every stop is a destination. */
export function routeProgressShort(p: RouteProgressDTO): string {
  return p.dests >= p.stops ? `${p.stop}/${p.stops}` : `${p.jump}/${p.jumps}`;
}

type LiveView = { at: number; total: number; progress?: RouteProgressDTO };
/** The live route's progress; the stops as before from a server without it. */
export const liveProgressText = (v: LiveView): string => (v.progress ? routeProgressText(v.progress) : `stop ${v.at} of ${v.total}`);
export const liveProgressShort = (v: LiveView): string => (v.progress ? routeProgressShort(v.progress) : `${v.at}/${v.total}`);
