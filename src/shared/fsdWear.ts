/**
 * The FSD's health and its wear per neutron supercharge, from the journal, per ship (plan 8.4, owner 2026-10-13:
 * "checks if we have module health somewhere … tell the commander the FSD took enough damage and further jumps
 * before a repair are not recommended (under 80 %)"; and "damage should be ship specific, as some ships like the
 * Caspian take less overcharge damage").
 *
 * The journal reports module health only in `Loadout` (at a game load, after outfitting, after a repair …), so
 * between two Loadouts a ship's FSD health is the last one less the supercharges since (`FSDJump.BoostUsed === 4`;
 * 1-3 are synthesis boosts, which do not wear it) times the wear per supercharge. That wear is learned per ship
 * (`ShipID`) from pairs of Loadouts with supercharges between them and no repair. A ship without MIN_BOOSTS of its own
 * takes what other ships with the same drive learned, else DEFAULT_WEAR (the owner's Asp, 1.17 % on three measured),
 * shown as an estimate.
 *
 * The supercharge itself depends on the drive too: the Caspian Explorer's size 8 Mk II SCO drive (the only size 8
 * FSD, on the only ship that takes one) reaches six times the range at a neutron star, every other drive four.
 */
export const DEFAULT_WEAR = 0.0117;
/** Health is written to six decimals, so a few supercharges between two Loadouts already measure the wear. */
export const MIN_BOOSTS = 3;
export const FSD_WARN = 0.8;
export const NEUTRON_BOOST = 4;
export const NEUTRON_BOOST_MK2 = 6;

export interface ShipFsdWear {
  /** The ship's type (`Loadout.Ship`, e.g. "asp", "explorer_nx") and its FSD module (`Item`). */
  ship: string | null;
  fsd: string | null;
  /** The last Loadout's FSD health (0..1), or null before one. */
  health: number | null;
  boostsSince: number;
  repairedSince: boolean;
  /** Learned from this ship's Loadout pairs: supercharges and the health lost over them. */
  boosts: number;
  lost: number;
}

export interface FsdWearState {
  /** The ship flown now (the last Loadout's ShipID). */
  current: number | null;
  ships: Record<string, ShipFsdWear>;
}

export function newFsdWear(): FsdWearState {
  return { current: null, ships: {} };
}

const newShip = (): ShipFsdWear => ({
  ship: null,
  fsd: null,
  health: null,
  boostsSince: 0,
  repairedSince: false,
  boosts: 0,
  lost: 0,
});

const currentShip = (st: FsdWearState): ShipFsdWear | null =>
  st.current == null ? null : (st.ships[String(st.current)] ?? null);

export function fsdWearLoadout(st: FsdWearState, line: Record<string, unknown>): void {
  if (typeof line.ShipID !== "number") return;
  const key = String(line.ShipID);
  st.current = line.ShipID;
  const s = (st.ships[key] ??= newShip());
  if (typeof line.Ship === "string") s.ship = line.Ship.toLowerCase();
  const mods = Array.isArray(line.Modules) ? (line.Modules as Record<string, unknown>[]) : [];
  const fsd = mods.find((m) => /hyperdrive/i.test(String(m.Item ?? "")));
  if (fsd && typeof fsd.Item === "string") {
    const item = fsd.Item.toLowerCase();
    // Another drive fitted: what this ship learned was the old drive's.
    if (s.fsd && s.fsd !== item) {
      s.boosts = 0;
      s.lost = 0;
      s.boostsSince = 0;
      s.health = null;
    }
    s.fsd = item;
  }
  const h = fsd && typeof fsd.Health === "number" ? Math.max(0, Math.min(1, fsd.Health)) : null;
  if (h == null) return;
  if (s.health != null && !s.repairedSince && s.boostsSince > 0 && h <= s.health) {
    s.boosts += s.boostsSince;
    s.lost += s.health - h;
  }
  s.health = h;
  s.boostsSince = 0;
  s.repairedSince = false;
}

export function fsdWearJump(st: FsdWearState, line: Record<string, unknown>): void {
  const s = currentShip(st);
  if (s && line.BoostUsed === 4) s.boostsSince++;
}

/** A repair of the FSD (or everything): health back to full until the next Loadout says what it is. */
export function fsdWearRepair(st: FsdWearState, line: Record<string, unknown>): void {
  const s = currentShip(st);
  if (!s) return;
  const items = [line.Items, line.Item, line.Module]
    .flat()
    .filter((v) => typeof v === "string")
    .map((v) => (v as string).toLowerCase());
  if (line.event === "RepairAll" || items.some((v) => v === "all" || v.includes("hyperdrive"))) {
    s.repairedSince = true;
    if (s.health != null) s.health = 1;
    s.boostsSince = 0;
  }
}

export interface FsdWearEstimate {
  /** The FSD's health now, estimated, or null without a Loadout. */
  health: number | null;
  wearPerBoost: number;
  /** Where the wear comes from: this ship's own supercharges, other ships with the same drive, or the default. */
  wearFrom: "ship" | "drive" | "default";
  /** True while the wear is not this ship's own. */
  wearIsDefault: boolean;
  boostsSince: number;
  /** A neutron supercharge multiplies the range by this (6 for the Caspian's Mk II SCO drive, else 4). */
  boostFactor: number;
  ship: string | null;
}

export function neutronBoostFor(fsd: string | null): number {
  return fsd && /hyperdrive.*size8/.test(fsd) ? NEUTRON_BOOST_MK2 : NEUTRON_BOOST;
}

export function fsdWearEstimate(st: FsdWearState): FsdWearEstimate {
  const s = currentShip(st);
  let wear = DEFAULT_WEAR;
  let from: FsdWearEstimate["wearFrom"] = "default";
  if (s && s.boosts >= MIN_BOOSTS && s.lost > 0) {
    wear = s.lost / s.boosts;
    from = "ship";
  } else if (s?.fsd) {
    let b = 0;
    let l = 0;
    for (const o of Object.values(st.ships))
      if (o.fsd === s.fsd) {
        b += o.boosts;
        l += o.lost;
      }
    if (b >= MIN_BOOSTS && l > 0) {
      wear = l / b;
      from = "drive";
    }
  }
  return {
    health: s?.health == null ? null : Math.max(0, s.health - wear * s.boostsSince),
    wearPerBoost: wear,
    wearFrom: from,
    wearIsDefault: from !== "ship",
    boostsSince: s?.boostsSince ?? 0,
    boostFactor: neutronBoostFor(s?.fsd ?? null),
    ship: s?.ship ?? null,
  };
}

/** The state from the journal cache: this shape, else nothing (an older cache replays the journals anyway). */
export function hydrateFsdWear(raw: unknown): FsdWearState {
  const st = newFsdWear();
  const r = raw as { current?: unknown; ships?: unknown } | null;
  if (!r || typeof r !== "object" || !r.ships || typeof r.ships !== "object") return st;
  st.current = typeof r.current === "number" ? r.current : null;
  for (const [k, v] of Object.entries(r.ships as Record<string, Record<string, unknown>>)) {
    if (!v || typeof v !== "object") continue;
    st.ships[k] = {
      ship: typeof v.ship === "string" ? v.ship : null,
      fsd: typeof v.fsd === "string" ? v.fsd : null,
      health: typeof v.health === "number" ? v.health : null,
      boostsSince: typeof v.boostsSince === "number" ? Math.max(0, v.boostsSince) : 0,
      repairedSince: v.repairedSince === true,
      boosts: typeof v.boosts === "number" ? v.boosts : 0,
      lost: typeof v.lost === "number" ? v.lost : 0,
    };
  }
  return st;
}
