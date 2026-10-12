/**
 * The expedition planner's answers (plan 2.4, 2026-10-11): `/api/expedition/field`, `/plan`, `/boxel`,
 * built by `server/expeditionService.ts` over `server/expedition.ts`.
 */

export interface ExpeditionBoxelDTO {
  /** Stable id: `<code>:<cx,cy,cz>:<position>`. */
  key: string;
  code: string;
  /** "Phraa Blao AB-C d1", or null where the sector has no known name. */
  name: string | null;
  /** A hand-named sector also names systems in this sector cell: the generated name may be the other one's. */
  mixed: boolean;
  center: { x: number; y: number; z: number };
  cubeLy: number;
  distanceLy: number;
  region: string | null;
  /** Estimated systems in the boxel. */
  systems: number;
  /** Share of known systems with biology, for its region and mass code. */
  pBio: number;
  /** Systems of the galaxy index (someone recorded biology) inside the boxel. */
  recorded: number;
  /** The commander's own visited systems inside the boxel. */
  visited: number;
  /** Systems somebody flew since 2025 and found without biology (Spansh), no longer counted as unflown. */
  barren?: number;
  /** Expected first-footfall credits in its unrecorded systems. */
  ev: number;
  /** Jumps to reach it plus one per system in it. */
  jumps: number;
  evPerJump: number;
  topGenera: { genus: string; share: number }[];
  /** Target-species mode: expected bodies of the species, and whether its position rule can be met. */
  speciesBodies?: number;
  passesGate?: boolean;
  /**
   * Looking for bodies, stars or worth (plan 5.2): what its unflown systems should hold of it (systems with
   * one, or gas giants for the dense kind) and that per jump.
   */
  matches?: number;
  matchesPerJump?: number;
  /** On a route (plan 5.2): the detour of going by it, its distance from the line, and how far along (0-1). */
  detourLy?: number;
  offLy?: number;
  along?: number;
}

/**
 * Target-species mode: the species' position rule (plan 2.6) — in words, the points it is measured from near
 * the field with the radius each one allows, and how many boxels met it.
 */
export interface ExpeditionRuleDTO {
  text: string;
  points: { name: string; x: number; y: number; z: number; radiusLy: number }[];
  /** More points than were sent (the nearest are kept). */
  truncated: boolean;
  boxelsChecked: number;
  boxelsPassing: number;
}

export interface ExpeditionFieldDTO {
  from: { x: number; y: number; z: number };
  radiusLy: number;
  jumpRangeLy: number;
  /** Boxels scored, before the limit. */
  scored: number;
  /** Mass codes left out because the radius holds too many of their boxels. */
  skipped: string[];
  species: string | null;
  /** What it looked for: "exobio", "body:elw", "star:Neutron Star", "value:20" (millions). */
  target?: string;
  /** A route's end and corridor, or null for a sphere. */
  to?: { x: number; y: number; z: number } | null;
  widthLy?: number | null;
  /** The species' position rule, or null when it has none (or no species is picked). */
  rule: ExpeditionRuleDTO | null;
  boxels: ExpeditionBoxelDTO[];
  /** The tables behind it. */
  builtAt: string;
}

export interface ExpeditionPlanStopDTO {
  key: string;
  name: string | null;
  center: { x: number; y: number; z: number };
  /** Straight-line distance from the previous stop (the ship for the first). */
  legLy: number;
  legJumps: number;
  ev: number | null;
}

export interface ExpeditionPlanDTO {
  from: { x: number; y: number; z: number };
  jumpRangeLy: number;
  stops: ExpeditionPlanStopDTO[];
  totalLy: number;
  totalJumps: number;
}

export interface ExpeditionCandidatesDTO {
  boxel: ExpeditionBoxelDTO;
  /** Procedural names nobody has recorded, in system-number order. */
  candidates: string[];
  /** Systems in the boxel the journals or the galaxy index already know. */
  knownSystems: number;
}
