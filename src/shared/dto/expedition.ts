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
  /** Expected first-footfall credits in its unrecorded systems. */
  ev: number;
  /** Jumps to reach it plus one per system in it. */
  jumps: number;
  evPerJump: number;
  topGenera: { genus: string; share: number }[];
  /** Target-species mode: expected bodies of the species, and whether its position rule can be met. */
  speciesBodies?: number;
  passesGate?: boolean;
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
