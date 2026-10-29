/**
 * The neutron route on the map (owner, 2026-10-28: the line "disappears when in a different menu", and "route points
 * for stop, refuel and so on should be shown"): its line and a dot on every stop, drawn whichever drawer is open.
 * Kept here, outside the lazily loaded Neutron drawer, so the map draws it again after the drawer or the galaxy tab
 * was closed.
 */
import type { MarkerItem } from "./engineTypes";

/** A stop of the planned or flown route: the planner's hop, or the live route's. */
export interface NeutronMark {
  name: string;
  x: number;
  y: number;
  z: number;
  kind: "start" | "neutron" | "waypoint";
  jumps: number;
  boosted: number;
  refuel?: boolean;
  refuelHalf?: boolean;
}

let kept: NeutronMark[] = [];
export const keptNeutronMarks = (): NeutronMark[] => kept;
export function keepNeutronMarks(marks: NeutronMark[]): void {
  kept = marks;
}

/** The route line's colour; the neutron stars' dots in it, refuel stops amber, your own stops white. */
export const NEUTRON_LINE_COLOUR = 0x9a7bff;
const NEUTRON: [number, number, number] = [0.6, 0.48, 1];
const REFUEL: [number, number, number] = [1, 0.76, 0.24];
const STOP: [number, number, number] = [1, 1, 1];

/** A dot on every stop after the start (the ship's own marker is there), its index in the route as the id. */
export function neutronMarkers(marks: NeutronMark[]): MarkerItem[] {
  return marks.slice(1).map((m, i) => ({
    id: String(i + 1),
    x: m.x,
    y: m.y,
    z: m.z,
    color: m.refuel ? REFUEL : m.kind === "waypoint" ? STOP : NEUTRON,
    size: m.kind === "waypoint" ? 9 : 7,
  }));
}

/** What to do at stop `i`, for the hover card and the side panel. */
export function neutronStopLine(marks: NeutronMark[], i: number): string {
  const m = marks[i];
  if (!m) return "";
  const next = marks[i + 1];
  const todo: string[] = [];
  if (m.refuel) todo.push(m.refuelHalf ? "scoop to half a tank" : "scoop");
  if (next?.boosted) todo.push("supercharge");
  const what = m.kind === "waypoint" ? (next ? "Your stop" : "Destination") : m.refuel ? "Refuel stop" : "Neutron star";
  const doing = todo.length ? `: ${todo.join(", then ")}` : "";
  return `${what}${doing} · stop ${i} of ${marks.length - 1}`;
}
