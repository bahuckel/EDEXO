/**
 * The galaxy map's constants and small helpers: label sizes, the drawers, the commander's own systems'
 * colours and status line, the marker colours and the Targets steps. Moved out of GalaxyMap3D.tsx
 * (audit 2026-10-22).
 */
import type { GalaxyMineDTO } from "@shared/types";
import type { CodexMapSystemDTO } from "@shared/dto/codexMap.js";
import type { EngineLabel } from "./engineTypes";
import { formatValue } from "./clusters";

export const LABEL_H = 18;
/** Label divs kept between frames; a screen shows well under this many names at once. */
export const LABEL_POOL_MAX = 150;
export const labelWidth = (l: EngineLabel) =>
  (l.kind === "region" ? 14 : 10) + l.text.length * (l.kind === "region" ? 7.6 : 6.6);
export const crShort = (n: number | null) => (n == null ? "—" : formatValue(n / 100_000));
export const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export type Colour = 0 | 1 | 2;
export type Drawer =
  | "none"
  | "view"
  | "layers"
  | "search"
  | "filter"
  | "navroute"
  | "codex"
  | "targets"
  | "expedition"
  | "neutron"
  | "stations"
  | "jumponium"
  | "finder";
/** `&drawer=finder` opens the map on a drawer (Colonize's "Find colony sites" link); only the ones a link may name. */
export function drawerFromUrl(): Drawer {
  const d = new URLSearchParams(window.location.search).get("drawer");
  return d === "finder" || d === "stations" || d === "neutron" ? d : "none";
}
/** A Spansh name hit with its coordinates (`/api/system/spansh-search`). */
export type SpanshFindHit = { systemAddress: number; starSystem: string; x?: number; y?: number; z?: number };
export type MineRow = GalaxyMineDTO["systems"][number];

/** The commander's systems: waiting for them amber, done (DSS or plants on foot) green, visited grey. */
export const MINE_UNFINISHED = 16;
/** Visited by the game's own list (VisitedStarsCache.dat), not in the journals (plan 6.1). */
export const MINE_IMPORTED = 128;
export const mineColour = (f: number, waitingShown: boolean): [number, number, number] =>
  f & MINE_UNFINISHED && waitingShown ? [1, 0.62, 0.16] : f & (4 | 8) ? [0.36, 0.9, 0.46] : [0.62, 0.68, 0.8];
export const mineStatus = (r: MineRow) =>
  r.flags & MINE_UNFINISHED
    ? `Still waiting: at least ${crShort(r.unfinishedFloorCr)}`
    : r.flags & (4 | 8)
      ? `Done${r.speciesScanned ? ` · ${r.speciesScanned} species scanned` : " · mapped"}`
      : r.flags & MINE_IMPORTED
        ? "Visited (the game's own list; not in your journals)"
        : "Visited";

export const codexColour: Record<CodexMapSystemDTO["status"], [number, number, number]> = {
  todo: [1, 0.36, 0.3],
  partial: [1, 0.8, 0.26],
  done: [0.36, 0.9, 0.46],
};
export const SEARCH_COLOUR: [number, number, number] = [0.7, 0.5, 1];
/** NavRoute finder markers; green where EDSM does not know the system. */
export const NAVROUTE_COLOUR: [number, number, number] = [0.95, 0.6, 0.2];
export const PLAN_COLOUR: [number, number, number] = [0.84, 0.7, 1];
/** The plotted route's systems you have not been to yet. */
export const NAV_UNVISITED_COLOUR: [number, number, number] = [0.45, 0.85, 1];
/** How many stops the plan can be asked for (G5.3, up to 20 since 5.8); the target is among them. */
export const PLAN_SIZES = [3, 5, 8, 10, 15, 20];
/** Room round a framed plan: the drawer and the panel cover both sides of the map. */
export const PLAN_MARGIN = 1.7;

/** The waiting slider: 0 – 500 M CR in 1 M steps, the same range as the Classic map's. */
export const WAIT_MAX_M = 500;

/**
 * G5's galaxy-wide floor, in million CR at 1×. Steps rather than a linear slider: nearly everything
 * recorded is under 50 M, and a linear 0–500 M slider spends nine tenths of its travel on a handful.
 */
export const WORTH_STEPS_M = [0, 1, 2, 5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300];
