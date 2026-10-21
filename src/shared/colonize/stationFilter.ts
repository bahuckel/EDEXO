import type { Ly } from "./systemDistanceLy";
import type { DepotSnapshot } from "./types";

/** Ground / planetary markets are only auto-included within this Ly of the reference. */
export const SURFACE_STATION_MAX_LY = 15;

/** Live Spansh scans run only when the buy index has no seller within this Ly. */
export const LIVE_SCAN_NEARBY_LY = 59;

export function normSystemName(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

export function normStationName(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Exact normalized station identity — use for depot exclusion (never fuzzy). */
export function exactStationNamesMatch(a: string, b: string): boolean {
  const x = normStationName(a);
  const y = normStationName(b);
  return Boolean(x && y && x === y);
}

/** Fuzzy match — journal dock name vs Spansh / UI station name. */
export function stationNamesMatch(a: string, b: string): boolean {
  const x = normStationName(a);
  const y = normStationName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export type DockedStationRef = {
  systemName: string;
  stationName: string;
};

export function matchesDockedStation(
  station: { systemName: string; stationName: string },
  docked?: DockedStationRef | null,
): boolean {
  if (!docked?.stationName?.trim() || !docked.systemName?.trim()) return false;
  return normSystemName(station.systemName) === normSystemName(docked.systemName) && stationNamesMatch(station.stationName, docked.stationName);
}

const ORBITAL_TYPE_RE =
  /coriolis|ocellus|orbis|starport|outpost|planetary\s*outpost|fleet\s*carrier|asteroid\s*base|megaship|installation(?!:)|carrier|dredger|military|commercial/i;

export function isSurfaceStationLabel(stationName: string): boolean {
  const n = stationName.trim();
  if (!n) return false;
  return /settlement|ground\s*installation|planetary\s*port|odyssey|crater|troop|surface\s*port|mega\s*ship|colonisation|colonization/i.test(
    n,
  );
}

function isOrbitalStationLabel(stationName: string): boolean {
  const n = stationName.trim();
  if (!n) return false;
  return ORBITAL_TYPE_RE.test(n);
}

export function isSurfaceStationType(
  stationType: string | null | undefined,
  isPlanetaryFlag?: boolean,
  stationName?: string,
): boolean {
  if (isPlanetaryFlag === true) return true;
  const name = (stationName || "").trim();
  if (name && isOrbitalStationLabel(name)) return false;
  if (name && isSurfaceStationLabel(name)) return true;
  const t = (stationType || "").trim();
  if (!t) return false;
  if (ORBITAL_TYPE_RE.test(t) && !/settlement|planetary\s*port|ground/i.test(t)) return false;
  return /ground\s*installation|planetary\s*port|settlement|surface|odyssey|^crater|troop/i.test(t);
}

export function collectConstructionSystems(depots: DepotSnapshot[]): string[] {
  const out = new Set<string>();
  for (const d of depots) {
    const s = d.starSystem?.trim();
    if (s) out.add(s);
  }
  return [...out];
}

/**
 * Orbital / space stations are always eligible.
 * Surface stations only when: user opted into all ground, OR &lt; 15 Ly, OR in a construction system.
 */
export type StationKindFilter = "any" | "space" | "ground";
export type MinLandingPad = "any" | "M" | "L";

export function parseMinLandingPad(v: unknown, largePadOnlyFallback?: boolean): MinLandingPad {
  if (v === "any" || v === "M" || v === "L") return v;
  return largePadOnlyFallback ? "L" : "any";
}

export function parseStationKindFilter(v: unknown): StationKindFilter {
  if (v === "any" || v === "space" || v === "ground") return v;
  return "any";
}

/** No station type at all, or the literal "unknown" some sources stamp instead of omitting it. */
function isUnknownStationType(stationType: string | null | undefined): boolean {
  const t = (stationType ?? "").trim().toLowerCase();
  return !t || t === "unknown";
}

/**
 * Coriolis / Ocellus / Orbis / Starport — excludes outposts, settlements, fleet carriers,
 * small/medium pads.
 *
 * An unknown type is optimistic (treated as large) so a station is not hidden purely
 * because the source omitted the field; `stationMeetsMinPad` is where a hard pad
 * requirement decides what to do about that.
 */
export function isLargePadStationType(stationType: string | null | undefined): boolean {
  if (isUnknownStationType(stationType)) return true;
  const t = (stationType ?? "").trim().toLowerCase();
  if (/fleet\s*carrier|^carrier$|outpost|settlement|surface station|small|medium/i.test(t)) return false;
  return true;
}

export function stationMeetsMinPad(
  min: MinLandingPad | undefined,
  pad?: string | null,
  stationType?: string | null,
): boolean {
  const need = min && min !== "any" ? min : null;
  if (!need) return true;
  const p = (pad ?? "").trim().toUpperCase();
  const rank: Record<string, number> = { S: 1, M: 2, L: 3 };
  if (p === "S" || p === "M" || p === "L") return (rank[p] ?? 0) >= (need === "L" ? 3 : 2);
  /**
   * No pad and no usable type: refuse. A hard pad requirement exists to keep a big ship
   * out of a place it cannot dock, so an unevidenced station must not satisfy it.
   */
  if (isUnknownStationType(stationType)) return false;
  const large = isLargePadStationType(stationType);
  if (need === "L") return large;
  return large || /outpost|carrier/i.test(stationType ?? "");
}

export function stationMeetsKindFilter(
  isPlanetaryOrGround: boolean,
  kind: StationKindFilter | undefined,
): boolean {
  if (!kind || kind === "any") return true;
  if (kind === "space") return !isPlanetaryOrGround;
  return isPlanetaryOrGround;
}

export function isFleetCarrierStationType(stationType: string | null | undefined): boolean {
  return /fleet\s*carrier|^carrier$/i.test((stationType ?? "").trim());
}

export function allowSurfaceStation(args: {
  isPlanetaryOrGround: boolean;
  distanceLy: Ly;
  systemName: string;
  constructionSystems: string[];
  includeAllPlanetaryAndGround?: boolean;
}): boolean {
  if (!args.isPlanetaryOrGround) return true;
  if (args.includeAllPlanetaryAndGround) return true;
  /** Unknown is not "near": `null < 15` is true in JavaScript, which is how this used to let one through. */
  if (args.distanceLy != null && args.distanceLy < SURFACE_STATION_MAX_LY) return true;
  const sys = normSystemName(args.systemName);
  if (!sys) return false;
  return args.constructionSystems.some((cs) => normSystemName(cs) === sys);
}
