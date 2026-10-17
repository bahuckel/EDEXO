/* ------------------------------------------------------------------ Codex map (owner, 2026-09-27) */

/** The game's codex categories the Codex map offers: Astronomical Bodies, Biological and Geological. */
export type CodexMapKind = "bodies" | "bio";

/** How much of a system's codex entries this commander already has in its region. */
export type CodexMapStatus = "todo" | "partial" | "done";

export interface CodexMapKindSummaryDTO {
  /** EDSM systems the map has for this region and kind. */
  systems: number;
  /** Distinct codex entries among them. */
  entries: number;
  /** …of which this commander has logged in the region. */
  logged: number;
  todo: number;
  partial: number;
  done: number;
}

export interface CodexMapRegionSummaryDTO {
  /** The region as EDSM names it ("The Formidine Rift"). */
  name: string;
  /** `regionJoinKey`, to match the region map's own spelling. */
  joinKey: string;
  kinds: Record<CodexMapKind, CodexMapKindSummaryDTO>;
}

export interface CodexMapRegionsDTO {
  available: boolean;
  /** Attribution line for the screen: the data is EDSM's. */
  source: string;
  regions: CodexMapRegionSummaryDTO[];
}

export interface CodexMapEntryDTO {
  /** EDSM type / journal Name key, e.g. `codex_ent_stratum_07_m`. */
  key: string;
  name: string;
  logged: boolean;
}

export interface CodexMapSystemDTO {
  /** id64 as a string: it can exceed 2^53. */
  systemAddress: string;
  name: string;
  /** Approximate galactic x and z (boxel centre), ly. */
  x: number;
  z: number;
  status: CodexMapStatus;
  entries: CodexMapEntryDTO[];
}

/** Colours logged in a region by anyone but not in the commander's codex there, rarest first (1.2.19). */
export interface CodexGapsDTO {
  region: string;
  /** Colours logged in the region (EDAstro), and how many of them are in the commander's codex. */
  known: number;
  logged: number;
  gaps: { key: string; name: string; regionSystems: number; galaxySystems: number }[];
}

/** The nearest system in a region known to have a codex entry (1.2.19, a click on a codex gap). */
export interface CodexNearestDTO {
  systemAddress: string;
  name: string;
  x: number;
  y: number;
  z: number;
  distanceLy: number;
  known: number;
  complete: boolean;
}

export interface CodexMapRegionDTO {
  region: string;
  kind: CodexMapKind;
  systems: CodexMapSystemDTO[];
}
