/**
 * The ship's full jump range as flown (owner, 2026-10-08): "sometimes me and other commanders do
 * economical routes … if the commander makes 66-67-68 ly jumps, that's the full potential, and it
 * should also exclude neutron jumps".
 *
 * The journal's `MaxJumpRange` is the range with an empty tank (71.6 ly on his Mandalay against 68 ly
 * flown), and a plain average drops whenever an economical route is plotted. So:
 * - a boosted jump (neutron or white dwarf supercharge, synthesis injection: `BoostUsed` on the
 *   `FSDJump` line) is left out;
 * - a jump shorter than `LONG_SHARE` of the full range is an economical-route hop: it is left out of
 *   the full range, however many of them come in a row;
 * - the full range is the average of the top `TOP_SHARE` of the last `JUMP_RANGE_SAMPLES` long jumps
 *   (owner: "take top 30% of jump ranges (no boosts) and use those" — a jump is only as long as the
 *   next star on the route allows, 64 ly where the drive does 68);
 * - a refit that moves the loadout's own range scales the jumps flown by the same ratio (owner, 2026-10-28: "after
 *   changing something on the ship, EDEXO requires you to do some jumps before it shows your jump range"); each
 *   ship's jumps are kept while another ship is flown, for when it comes back.
 */

export const JUMP_RANGE_SAMPLES = 40;
/** A jump this share of the full range or more is a full-range jump. */
export const LONG_SHARE = 0.6;
/** The share of the long jumps, longest first, the full range averages. */
export const TOP_SHARE = 0.3;
/** Full-range jumps needed before the estimate stands in for the loadout's range. */
export const MIN_LONG_JUMPS = 3;
/** Short jumps kept, to tell an economical route. */
const RECENT = 5;

export interface JumpRangeState {
  /** The ship and its loadout range the samples are from (`Loadout.ShipID`, `MaxJumpRange`). */
  shipId: number | null;
  loadoutLy: number | null;
  /** Full-range jumps (ly), oldest first. */
  long: number[];
  /** The last few unboosted jumps, long or short. */
  recent: number[];
  /** The other ships' jumps, by `ShipID`, as they were when the commander left them. */
  others?: Record<string, { loadoutLy: number | null; long: number[]; recent: number[] }>;
}

/** Other ships remembered; the ones left longest ago go first. */
const OTHER_SHIPS = 12;
/**
 * The key of a ship in `others`: "s" and its ShipID. A bare number is an integer-like key, which objects list in
 * numeric order whatever the order set, so the lowest ShipIDs went first instead of the ships left longest ago.
 */
const shipKey = (id: number | string) => `s${id}`;

type OtherShip = NonNullable<JumpRangeState["others"]>[string];

/** `others` from a saved cache: only well-formed entries (a bad one would break the next refit). */
export function hydrateJumpRangeOthers(raw: unknown): NonNullable<JumpRangeState["others"]> {
  const out: NonNullable<JumpRangeState["others"]> = {};
  if (!raw || typeof raw !== "object") return out;
  const nums = (v: unknown) => (Array.isArray(v) ? v.filter((d): d is number => typeof d === "number" && d > 0) : []);
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    const entry: OtherShip = {
      loadoutLy: typeof e.loadoutLy === "number" && e.loadoutLy > 0 ? e.loadoutLy : null,
      long: nums(e.long),
      recent: nums(e.recent),
    };
    if (entry.long.length) out[k.startsWith("s") ? k : shipKey(k)] = entry;
  }
  return out;
}

export function emptyJumpRange(): JumpRangeState {
  return { shipId: null, loadoutLy: null, long: [], recent: [], others: {} };
}

/**
 * A `Loadout`. Another ship: this one's jumps are put by and that one's taken back, if it was flown before. A refit
 * that moved the loadout's own range by more than 2 %: the jumps are scaled by the same ratio (the drive and the
 * ship's mass set both alike), so the range is there at once and the next jumps refine it.
 */
export function jumpRangeLoadout(
  st: JumpRangeState,
  shipId: number | null,
  maxJumpRangeLy: number | null,
): void {
  if (shipId != null && shipId !== st.shipId) {
    const others = (st.others ??= {});
    if (st.shipId != null && st.long.length) {
      delete others[shipKey(st.shipId)];
      others[shipKey(st.shipId)] = { loadoutLy: st.loadoutLy, long: st.long, recent: st.recent };
      const keys = Object.keys(others);
      for (const k of keys.slice(0, Math.max(0, keys.length - OTHER_SHIPS))) delete others[k];
    }
    const back = others[shipKey(shipId)];
    delete others[shipKey(shipId)];
    st.shipId = shipId;
    st.loadoutLy = back?.loadoutLy ?? null;
    st.long = back?.long ?? [];
    st.recent = back?.recent ?? [];
  }
  if (shipId != null) st.shipId = shipId;
  if (maxJumpRangeLy == null) return;
  if (st.loadoutLy != null && Math.abs(maxJumpRangeLy - st.loadoutLy) > 0.02 * st.loadoutLy) {
    const f = maxJumpRangeLy / st.loadoutLy;
    st.long = st.long.map((d) => d * f);
    st.recent = st.recent.map((d) => d * f);
  }
  st.loadoutLy = maxJumpRangeLy;
}

/** An `FSDJump`'s distance. */
export function jumpRangeJump(st: JumpRangeState, distLy: number, boostUsed: unknown): void {
  if (!(distLy > 0) || !Number.isFinite(distLy)) return;
  if (typeof boostUsed === "number" && boostUsed > 0) return;
  st.recent.push(distLy);
  if (st.recent.length > RECENT) st.recent.shift();
  const full = fullJumpRange(st);
  // Until there is a full range, every jump counts; the short ones fall out once the long ones are in.
  if (full != null && distLy < LONG_SHARE * full) return;
  st.long.push(distLy);
  const top = Math.max(...st.long);
  st.long = st.long.filter((d) => d >= LONG_SHARE * top).slice(-JUMP_RANGE_SAMPLES);
}

/** The full jump range as flown, or null until `MIN_LONG_JUMPS` full-range jumps are in. */
export function fullJumpRange(st: JumpRangeState): number | null {
  if (st.long.length < MIN_LONG_JUMPS) return null;
  const top = [...st.long]
    .sort((a, b) => b - a)
    .slice(0, Math.max(1, Math.round(TOP_SHARE * st.long.length)));
  return top.reduce((a, b) => a + b, 0) / top.length;
}

/** The last few jumps were all short: an economical route is being flown. */
export function onEconomicalRoute(st: JumpRangeState): boolean {
  const full = fullJumpRange(st);
  return full != null && st.recent.length >= 3 && st.recent.slice(-3).every((d) => d < LONG_SHARE * full);
}
