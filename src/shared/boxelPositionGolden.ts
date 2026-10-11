/**
 * Golden boxel positions for stars, worlds and signals (owner, 2026-10-06): the same letters in every sector
 * where a target is more common than in the rest of its mass code. From the Spansh galaxy dump
 * (docs/perf/boxel_position_study.py + boxel_golden.py, Bonferroni over every position x target, both halves of
 * the galaxy), kept only when it still holds in boxels at least 90 % explored (boxel_golden_survey.py: survey
 * bias) and is at least 1.75x over all boxels. Most sit in the sector's lowest layers, near the galactic plane.
 * [target, mass code, position, systems, hits, rest's share, liftInExploredBoxels]; written by
 * docs/perf/boxel_position_golden_ts.py to data/boxel/boxel-position-golden.json (plan 2.1, 2026-10-11).
 */
import golden from "../../data/boxel/boxel-position-golden.json";

type PositionRow = readonly [string, string, number, number, number, number, number];

// JSON reads a tuple back as a plain array; the generator writes exactly these seven fields.
export const BOXEL_POSITION_GOLDEN: readonly PositionRow[] = golden as unknown as readonly PositionRow[];
