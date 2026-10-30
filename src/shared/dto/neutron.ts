/** The neutron route being flown (server/neutronLive.ts, plan 8.5) and the FSD's health, for the HUD and the header. */

/** What the HUD and the header show of the route being flown. */
export interface NeutronLiveDTO {
  /** The stop reached last (0: the start) and the stops after the start. */
  at: number;
  total: number;
  /** The stop to fly to next (on the clipboard), the jumps to it and whether the first one is supercharged. */
  next: string | null;
  nextJumps: number;
  nextBoosted: boolean;
  /** The ship is in the stop reached last (not between two stops). */
  onStop: boolean;
  /** At that stop: scoop its own star first (this far), then supercharge. */
  refuelHere: boolean;
  /** Scoop to half a tank there, not full: the plan's next jumps count on the lighter ship's range. */
  refuelHalf: boolean;
  scoopLs: number | null;
  /** At a refuel stop: how much to scoop (server/neutronFuelWindow.ts); null elsewhere or when unknown. */
  refuelWindow?: RefuelWindowDTO | null;
  superchargeHere: boolean;
  /** The normal jumps to the next stop need a scoopable star on the way. */
  scoopOnWay: boolean;
  /** "Use Jumponium": FSD injections planned for the normal jumps to the next stop, one per jump. */
  nextInject: { tier: "basic" | "standard" | "premium"; count: number } | null;
  /** The ship left the route: it is being planned again from here. */
  replanning: boolean;
  /** The last stop is reached: shown until the next jump. */
  done: boolean;
  /** The route's last stop. */
  destination: string;
}

/**
 * The fuel to scoop to at a refuel stop (t): at least `minT` to reach the next refuel, at most `maxT` for every
 * supercharge before it to reach as planned; the tank, the fuel aboard now, and the stops until the next refuel.
 */
export interface RefuelWindowDTO {
  minT: number;
  maxT: number;
  tankT: number;
  nowT: number | null;
  toStop: number;
}

/** The FSD's health now (shared/fsdWear.ts): from the last Loadout, less the supercharges since. */
export interface FsdHealthDTO {
  health: number;
  /** Under 80 %: further supercharges before a repair are not recommended. */
  warn: boolean;
  /** Supercharges since the Loadout, and whether their wear is the default rather than learned. */
  boostsSince: number;
  estimate: boolean;
}
