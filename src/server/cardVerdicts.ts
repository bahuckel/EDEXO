/**
 * The Encyclopedia's condition cards, graded by the matcher (plan 1.10, code review B9, 2026-10-11).
 *
 * The cards (`shared/speciesSpawnConditionCards.ts`) work out their own tier from the codex conditions,
 * and every rescue the matcher gained since — the planet class seen in the observations, the 2 %
 * numeric tolerance, the colour table's D/W fold, volcanism seen off the list — was a place for them
 * to drift: on the spawn fixture 19 planet-class, 10 supported-star and 1 volcanism card were red on a
 * species the matcher shows. So the tier now comes from `speciesMatchesCriteria`'s own reasons on the
 * body: a wall is red, a soft miss yellow, a pass blue. A card the matcher did not grade keeps its own.
 *
 * Reasons carry the card they grade where the field alone would not say (`MatchReason.card`); the rest
 * go by field. The matcher's demotion passes (system bodies, starlight, regional) run only on a
 * system's candidates and are not part of this.
 */
import type { EstimatedSurfaceTempBand, MatchReason, PlanetScan, SpeciesEntry, SpeciesMatchContext } from "../shared/types.js";
import { resolvePlanetTemperatureBand, speciesMatchesCriteria } from "./matchSpecies.js";
import { DEMOTED_NOTE } from "./demotionPasses.js";

export type CardVerdict = { tier: "blue" | "yellow" | "red"; detail: string };

/** A field's own card, for reasons that do not name one. */
const FIELD_CARD: Record<string, string> = {
  PlanetClass: "planet-class",
  AtmosphereType: "atmosphere-type",
  Landable: "landable-yes",
  Volcanism: "volcanism",
  SurfaceGravity: "surface-gravity",
  StarType: "parent-star-type",
  Orbit: "orbit-distance",
  Location: "known-systems",
  Arrival: "arrival-distance",
  SurfacePressure: "pressure-category",
  Signals: "geological-signals",
  Presence: "presence",
  SurfaceTemperature: "surface-temperature",
};

const RANK = { blue: 0, yellow: 1, red: 2 } as const;

/** The matcher's wording without the demotion boilerplate every soft miss ends with. */
function shortDetail(d: string): string {
  return d.split(DEMOTED_NOTE).join("").trim();
}

export function cardVerdictsFromReasons(failures: MatchReason[], passed: MatchReason[]): Record<string, CardVerdict> {
  const out: Record<string, CardVerdict> = {};
  const put = (r: MatchReason, tier: CardVerdict["tier"]) => {
    const card = r.card ?? FIELD_CARD[r.field];
    if (!card) return;
    const was = out[card];
    if (!was || RANK[tier] > RANK[was.tier]) out[card] = { tier, detail: shortDetail(r.detail) };
  };
  for (const r of passed) put(r, r.soft ? "yellow" : "blue");
  for (const r of failures) put(r, r.soft ? "yellow" : "red");
  return out;
}

/** Every card the matcher grades for this species on this body. */
export function cardVerdictsFor(
  entry: SpeciesEntry,
  scan: PlanetScan,
  est: EstimatedSurfaceTempBand | null,
  ctx: SpeciesMatchContext | null | undefined,
): Record<string, CardVerdict> {
  const range = est ? { tMin: est.minK, tMax: est.maxK, tMid: est.midK } : null;
  const band = resolvePlanetTemperatureBand(scan, range);
  const r = speciesMatchesCriteria(entry, scan, band, range, ctx ?? null);
  return r.ok ? cardVerdictsFromReasons([], r.reasons) : cardVerdictsFromReasons(r.reasons, r.passed ?? []);
}
