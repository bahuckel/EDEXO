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
  scoopLs: number | null;
  superchargeHere: boolean;
  /** The normal jumps to the next stop need a scoopable star on the way. */
  scoopOnWay: boolean;
  /** The ship left the route: it is being planned again from here. */
  replanning: boolean;
  /** The last stop is reached: shown until the next jump. */
  done: boolean;
  /** The route's last stop. */
  destination: string;
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
