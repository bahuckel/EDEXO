/**
 * The body the Encyclopedia compares every species with (moved out of EncyclopediaModal.tsx, audit
 * 2026-10-22; EncyclopediaModal re-exports it for App and HeaderBar).
 */
import type { EstimatedSurfaceTempBand, PlanetScan, SpeciesMatchContext } from "@shared/types";

export type EncyclopediaSpawnCompare = {
  /** Matches `BodyExoState.key` — sent to encyclopedia exomastery API for “vs BODY tab” habitat match. */
  bodyKey: string | null;
  scan: PlanetScan | null;
  estimatedSurfaceTempK: EstimatedSurfaceTempBand | null;
  speciesMatchContext: SpeciesMatchContext | null;
  /** BODY: tab designation for the encyclopedia caption line. */
  bodyTabLabel?: string;
};
