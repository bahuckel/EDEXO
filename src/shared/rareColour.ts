/**
 * Rare colours (1.2.19): a colour logged in at most RARE_COLOUR_MAX_SYSTEMS systems galaxy-wide (EDAstro's codex,
 * server/codexVariantCounts.ts). One threshold and one sentence for the [RARE] mark and the notice.
 */
import { fmtCount } from "./format.js";

/** At most this many systems galaxy-wide makes a colour rare. */
export const RARE_COLOUR_MAX_SYSTEMS = 10;

export interface ColourRarity {
  colour: string;
  galaxySystems: number;
  /** Systems in the body's region; null when the region is unknown. */
  regionSystems: number | null;
  region: string | null;
}

export function isRareColour(r: Pick<ColourRarity, "galaxySystems">): boolean {
  return r.galaxySystems <= RARE_COLOUR_MAX_SYSTEMS;
}

/** "logged in 3 systems galaxy-wide, none in Inner Orion Spur". */
export function rareColourPhrase(r: ColourRarity): string {
  const here =
    r.region && r.regionSystems != null
      ? `, ${r.regionSystems ? fmtCount(r.regionSystems, "system") : "none"} in ${r.region}`
      : "";
  return `logged in ${fmtCount(r.galaxySystems, "system")} galaxy-wide${here}`;
}
