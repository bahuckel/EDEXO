/**
 * A seller row with what EDEXO's stations index knows about the station (1.3.0, localGalaxy.ts): its largest pad,
 * how far it is from the arrival star, and its type when the row has none. Before this, a pad was known only from an
 * Inara import and otherwise guessed from the station type; now the "Pad" filter reads the real one, and a trip stop
 * can say how long the supercruise is. A pad the row already has (Inara, the game) is kept.
 *
 * Set by the Colonize service while it runs; without it (tests, no stations index) rows pass through unchanged.
 */
import type { LocalStationFacts } from "./localGalaxy";

let facts: ((systemName: string, stationName: string) => LocalStationFacts | null) | null = null;

export function setLocalStationFacts(fn: typeof facts): void {
  facts = fn;
}

type SellerRow = {
  systemName: string;
  stationName: string;
  pad?: string | null;
  stationType?: string | null;
  arrivalLs?: number | null;
};

export function withLocalStationFacts<T extends SellerRow>(row: T): T {
  if (!facts) return row;
  let f: LocalStationFacts | null = null;
  try {
    f = facts(row.systemName, row.stationName);
  } catch {
    return row;
  }
  if (!f) return row;
  return {
    ...row,
    pad: row.pad || f.pad || null,
    stationType: row.stationType || f.type || null,
    arrivalLs: row.arrivalLs ?? f.arrivalLs,
  };
}
