/**
 * The FSD's health and its wear per neutron supercharge, from the journal (plan 8.4, owner 2026-10-13: "checks if we
 * have module health somewhere … tell the commander the FSD took enough damage and further jumps before a repair are
 * not recommended (under 80 %)").
 *
 * The journal reports module health only in `Loadout` (at a game load, after outfitting, after a repair …), so
 * between two Loadouts the health is the last one less the supercharges since (`FSDJump.BoostUsed === 4`; 1-3 are
 * synthesis boosts, which do not wear it) times the wear per supercharge. That wear is learned from pairs of Loadouts
 * with supercharges between them and no repair; until there are MIN_BOOSTS of those it is DEFAULT_WEAR, the owner's
 * three measured (1.17 %), shown as an estimate.
 */
export const DEFAULT_WEAR = 0.0117;
export const MIN_BOOSTS = 10;
export const FSD_WARN = 0.8;

export interface FsdWearState {
  shipId: number | null;
  /** The last Loadout's FSD health (0..1), or null before one. */
  health: number | null;
  boostsSince: number;
  repairedSince: boolean;
  /** Learned from Loadout pairs: supercharges and the health lost over them. */
  boosts: number;
  lost: number;
}

export function newFsdWear(): FsdWearState {
  return { shipId: null, health: null, boostsSince: 0, repairedSince: false, boosts: 0, lost: 0 };
}

export function fsdWearLoadout(st: FsdWearState, line: Record<string, unknown>): void {
  const ship = typeof line.ShipID === "number" ? line.ShipID : null;
  const mods = Array.isArray(line.Modules) ? (line.Modules as Record<string, unknown>[]) : [];
  const fsd = mods.find((m) => /hyperdrive/i.test(String(m.Item ?? "")));
  const h = fsd && typeof fsd.Health === "number" ? Math.max(0, Math.min(1, fsd.Health)) : null;
  if (h == null) return;
  if (ship === st.shipId && st.health != null && !st.repairedSince && st.boostsSince > 0 && h <= st.health) {
    st.boosts += st.boostsSince;
    st.lost += st.health - h;
  }
  st.shipId = ship;
  st.health = h;
  st.boostsSince = 0;
  st.repairedSince = false;
}

export function fsdWearJump(st: FsdWearState, line: Record<string, unknown>): void {
  if (line.BoostUsed === 4) st.boostsSince++;
}

/** A repair of the FSD (or everything): health back to full until the next Loadout says what it is. */
export function fsdWearRepair(st: FsdWearState, line: Record<string, unknown>): void {
  const items = [line.Items, line.Item, line.Module]
    .flat()
    .filter((v) => typeof v === "string")
    .map((v) => (v as string).toLowerCase());
  if (line.event === "RepairAll" || items.some((v) => v === "all" || v.includes("hyperdrive"))) {
    st.repairedSince = true;
    if (st.health != null) st.health = 1;
    st.boostsSince = 0;
  }
}

export interface FsdWearEstimate {
  /** The FSD's health now, estimated, or null without a Loadout. */
  health: number | null;
  wearPerBoost: number;
  /** True while the wear is the default, not learned from this commander's own supercharges. */
  wearIsDefault: boolean;
  boostsSince: number;
}

export function fsdWearEstimate(st: FsdWearState): FsdWearEstimate {
  const learned = st.boosts >= MIN_BOOSTS && st.lost > 0;
  const wear = learned ? st.lost / st.boosts : DEFAULT_WEAR;
  return {
    health: st.health == null ? null : Math.max(0, st.health - wear * st.boostsSince),
    wearPerBoost: wear,
    wearIsDefault: !learned,
    boostsSince: st.boostsSince,
  };
}
