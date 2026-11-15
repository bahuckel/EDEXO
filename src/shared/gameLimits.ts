/**
 * The game's limits behind the codex's rounded numbers (2026-10-03), shared by the matcher and the
 * Encyclopedia's spawn-condition cards so the two never disagree on a body at the edge.
 */
import { EARTH_G_MS2 } from "./journalPhysics.js";

/**
 * A codex gravity limit in g is the game's limit in m/s², rounded (2026-10-03). 0.15 g is 1.5 m/s²
 * (0.1530 g) and 0.275 g is 2.7 m/s² (0.2753 g): the corpus has 271 Tubus bodies between 0.150 and
 * 0.153 g and none further, Osseus pumice 22 between 0.275 and 0.2753, Stratum tectonicas' 0.61 runs to
 * 0.611 (6.0 m/s²). Tubus rosarium at 0.150 g on the owner's Dryio Flyuae OT-Y c1-103 3 b was demoted
 * for it. So the limit is read back to the m/s² it came from, at a tenth.
 */
export function gameGravityLimitG(maxG: number | undefined): number | undefined {
  if (maxG === undefined || !Number.isFinite(maxG)) return maxG;
  const ms2 = Math.round(maxG * EARTH_G_MS2 * 10) / 10;
  return Math.max(maxG, ms2 / EARTH_G_MS2);
}

/**
 * A codex ceiling of 195 K is 195.5 K in the game (2026-10-03). On thin carbon dioxide bodies every
 * species capped at 195 K runs on past it and stops: 3,700 corpus bodies of 24 species between 195
 * and 195.5 K (Aleoida gravis 513, Tussock triticum 397, Osseus pellebantus 396 …), a handful beyond.
 * Fungoida gelata and Frutexa acus at 195 K on CO₂ were demoted for it (EDDN ScanOrganic set).
 */
export function gameTemperatureCeilingK(maxK: number, body?: CeilingBody | null): number;
export function gameTemperatureCeilingK(maxK: number | undefined, body?: CeilingBody | null): number | undefined;
export function gameTemperatureCeilingK(maxK: number | undefined, body?: CeilingBody | null): number | undefined {
  if (maxK !== 195) return maxK;
  return body && liftsCarbonDioxideCeiling(body) ? LOW_GRAVITY_CO2_CEILING_K : 195.5;
}

/** What the ceiling needs to know about the body: the journal's own fields. */
export interface CeilingBody {
  SurfaceGravity?: number | null;
  AtmosphereType?: string | null;
}

/**
 * Under this gravity the 195.5 K ceiling does not hold on thin carbon dioxide (1.4.0, 2026-11-14; owner's call).
 *
 * The bodies above 195.5 K in the EDDN year that carry the whole community capped there — Blu Thua RN-S c17-23 7 b
 * (196.7 K, 8 species), Blaa Eork GI-F c26-0 1 b, Graea Hypue HT-P d6-478 11 b, Zuni IY-Z d13-1171 4 d … — are all
 * at 0.042-0.044 g. Across the galaxy dump, thin CO2 between 195.5 and 200 K at 0.08-0.10 atm: 471 bio bodies at
 * g ≥ 0.1 with 1.14 signals on average and none with 4+, 10 under 0.1 g with 8.5 and all of them 4+. Pressure is
 * the same on both sides, so it is gravity (or the air column it holds, p / g). No scanned thin-CO2 body lies
 * between 0.047 and 0.10 g above 195.5 K, so the edge is in that gap.
 */
export const LOW_GRAVITY_CO2_CEILING_G = 0.047;
/** The lifted ceiling: every thin-CO2 body under 0.1 g in the dump sits at or below 199.2 K. */
export const LOW_GRAVITY_CO2_CEILING_K = 200;

function liftsCarbonDioxideCeiling(body: CeilingBody): boolean {
  const g = body.SurfaceGravity;
  if (typeof g !== "number" || !Number.isFinite(g) || g / EARTH_G_MS2 >= LOW_GRAVITY_CO2_CEILING_G) return false;
  // Plain carbon dioxide only: the study had no "-rich" body to say anything about.
  return (body.AtmosphereType ?? "").toLowerCase().replace(/[^a-z]/g, "").replace(/^(hot|thin|thick)+/, "") === "carbondioxide";
}
