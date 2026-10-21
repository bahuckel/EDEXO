/**
 * The HUD's Colonize section (1.3.0): what is worth a glance in the cockpit. Built on the server
 * (src/server/colonize/hudSummary.ts) from the Colonize window's journal state and its saved trip plan, sent on the
 * `hud` channel as `colonizeHud`.
 */
export type ColonizeHudLine = { label: string; tons: number };

export type ColonizeHudDTO = {
  /** Sites being built: the one docked at first, then the most recently active. At most three. */
  sites: { marketId: string; label: string; system: string | null; pct: number; leftTons: number; docked: boolean }[];
  /** Further sites being built, not listed. */
  moreSites: number;
  /** Docked at one of the sites: what in the hold it still needs. */
  deliver: { site: string; lines: ColonizeHudLine[] } | null;
  /** The next stop of the saved haul plan, when there is one. `here`: docked at it now. */
  next: {
    trip: number;
    trips: number;
    station: string;
    system: string;
    distanceLy: number | null;
    here: boolean;
    buys: (ColonizeHudLine & { done: boolean })[];
    deliverTo: string[];
  } | null;
  /** Tons aboard, and the hold's size when known. */
  hold: { used: number; capacity: number | null };
};
