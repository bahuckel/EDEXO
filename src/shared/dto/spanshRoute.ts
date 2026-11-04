/**
 * A route planned on Spansh and brought into EDEXO (plan 1.3.6 S-1, owner 2026-11-02: "Import spansh routes - yes, we
 * can also compare EDEXO to Spansh with this to optimize route"). server/spanshRoute.ts reads Spansh's result once and
 * turns it into this; the galaxy map's Spansh drawer shows it, compares it with EDEXO's own values and flies it.
 */

/** Which of Spansh's planners made it: the result's shape says. */
export type SpanshRouteKind = "exobiology" | "riches" | "neutron" | "plotter" | "carrier";

export interface SpanshRouteBodyDTO {
  name: string;
  /** "Rocky body", "High metal content world" … as Spansh writes it. */
  subtype: string | null;
  distanceLs: number | null;
  /** Spansh's value for this body: the species' (exobiology) or mapping + scan (riches). */
  valueCr: number;
  /** Exobiology routes: the species Spansh lists here, most valuable first. */
  species: { name: string; valueCr: number }[];
}

export interface SpanshRouteStopDTO {
  name: string;
  /** The system address as text (an id64 overflows a JSON number in other tools). */
  id64: string | null;
  x: number;
  y: number;
  z: number;
  /** Jumps from the stop before (0 for the first). */
  jumps: number;
  /** Neutron / plotter routes: a neutron star here (supercharge before the next jump). */
  neutron: boolean;
  /** Plotter routes: refuel here; FSD injection needed for the next jump. */
  refuel: boolean;
  inject: boolean;
  /** Spansh's value of the whole stop (sum of its bodies), 0 for routes without values. */
  valueCr: number;
  bodies: SpanshRouteBodyDTO[];
}

export interface SpanshRouteDTO {
  job: string;
  kind: SpanshRouteKind;
  /** Start and end as Spansh was asked (end null for a loop or a radius search). */
  from: string | null;
  to: string | null;
  /** The jump range Spansh planned with, when it says. */
  rangeLy: number | null;
  stops: SpanshRouteStopDTO[];
  totalJumps: number;
  totalValueCr: number;
  /** The link to open the route on Spansh's own site; empty for a route imported from a file without Spansh's job id. */
  url: string;
}

/** A route kept on disk (server/spanshRouteFile.ts), as `/api/spansh-route/saved` lists it. */
export interface SavedSpanshRouteDTO {
  job: string;
  kind: SpanshRouteKind;
  from: string | null;
  to: string | null;
  /** Stops after the start. */
  stops: number;
  totalJumps: number;
  totalValueCr: number;
  /** ISO time it was read from Spansh. */
  readAt: string;
}

/**
 * What `/api/spansh-route` answers: the route, Spansh still working on it, or why not. `saved` says the route came
 * from the copy kept on disk (Spansh may have deleted it since); `note` says what an imported file left out.
 */
export type SpanshRouteAnswer =
  | { state: "ok"; route: SpanshRouteDTO; saved?: boolean; note?: string }
  | { state: "pending"; job: string }
  | { state: "error"; error: string };
