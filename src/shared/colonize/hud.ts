/**
 * The HUD's Colonize section (1.3.0): what is worth a glance in the cockpit. Built on the server
 * (src/server/colonize/hudSummary.ts) from the Colonize window's journal state and its saved trip plan, sent on the
 * `hud` channel as `colonizeHud`.
 */
export type ColonizeHudLine = { label: string; tons: number };

/** A buy line of the next stop: `have` of `tons` aboard already (its bar), `done` once bought. */
export type ColonizeHudBuy = ColonizeHudLine & { done: boolean; commodityId?: string; have?: number };

/** One material of the target site: `aboard` of what is left is in the hold; `done` once delivered in full. */
export type ColonizeHudNeed = {
  commodityId: string;
  label: string;
  required: number;
  provided: number;
  aboard: number;
  done: boolean;
};

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
    /** "buy": a seller; "deliver": every buy of the trip is done, the site is next. */
    kind?: "buy" | "deliver";
    station: string;
    system: string;
    /** From the construction site (the plan's figure). */
    distanceLy: number | null;
    /** From where the ship is now, when both positions are known. */
    fromShipLy?: number | null;
    here: boolean;
    buys: ColonizeHudBuy[];
    deliverTo: string[];
  } | null;
  /**
   * The site the HUD follows (docked at it, else the next trip's delivery, else the most recent): its materials, still
   * needed first, delivered ones last (the HUD hides those unless asked to show them).
   */
  target?: {
    marketId: string;
    label: string;
    system: string | null;
    pct: number;
    leftTons: number;
    needs: ColonizeHudNeed[];
    /** This game week in the site's system (discuss item 33): paid to you, spent on that cargo, tons delivered. */
    week?: { paid: number; spent: number; tons: number } | null;
  } | null;
  /**
   * The saved plan: none yet, every trip done, made for sites that are no longer all being built ("stale": the
   * Colonize window makes a new one when it opens), or in progress.
   */
  plan?: "none" | "done" | "stale" | "active";
  /** Tons aboard, and the hold's size when known. */
  hold: { used: number; capacity: number | null };
};
