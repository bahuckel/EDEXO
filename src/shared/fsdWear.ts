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
 * The supercharge depends on the drive: the size 8 Mk II SCO (`…_overchargebooster_mkii`, the Caspian Explorer's)
 * reaches six times the range at a neutron star, every other drive four. Read from the Loadout's drive
 * (`superchargeFor`); the ship type (`superchargeForShip`) only while no drive is known. Owner, 2026-10-20: the drive
 * is sold on its own (44 outfitting lists on EDDN in a few minutes), so another ship with a size 8 slot (the
 * Anaconda Mk II, 4.4.2.0) can carry it.
 */
export const DEFAULT_WEAR = 0.0117;
/** Health is written to six decimals, so a few supercharges between two Loadouts already measure the wear. */
export const MIN_BOOSTS = 3;
export const FSD_WARN = 0.8;
export const NEUTRON_BOOST = 4;
export const NEUTRON_BOOST_MK2 = 6;
/** The Mk II SCO drive's module name, part of `int_hyperdrive_overcharge_size8_class5_overchargebooster_mkii`. */
const MK2_SCO_DRIVE = "overchargebooster_mkii";

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
  /**
   * A neutron supercharge multiplies the range by this ({@link superchargeFor}): 6 with the Mk II SCO drive, else
   * 4; 4 when neither the drive nor the ship type says.
   */
  boostFactor: number;
  /** Whether the drive or the ship type said; when neither did, the planner keeps the commander's own ×4 / ×6. */
  shipKnown: boolean;
  ship: string | null;
}

/**
 * Every ship the game sells, by the type the journal writes (`LoadGame.Ship` / `Loadout.Ship`, lower case), from the
 * shipyards in Spansh's station dump of 2026-10-12 (47) and the Cutter, and the Anaconda Mk II (4.4.2.0, 2026-10-20:
 * `anacondamkii` in EDDN shipyard lists). Suits and SRVs never reach this: they have no Loadout of their own.
 */
export const KNOWN_SHIPS: ReadonlySet<string> = new Set([
  "adder", "anaconda", "anacondamkii", "asp", "asp_scout", "belugaliner", "cobramkiii", "cobramkiv", "cobramkv", "corsair", "cutter",
  "diamondback", "diamondbackxl", "dolphin", "eagle", "empire_courier", "empire_eagle", "empire_trader", "explorer_nx",
  "federation_corvette", "federation_dropship", "federation_dropship_mkii", "federation_gunship", "ferdelance",
  "hauler", "independant_trader", "krait_light", "krait_mkii", "lakonminer", "mamba", "mandalay", "mediumtransport01",
  "orca", "panthermkii", "python", "python_nx", "sidewinder", "smallcombat01_nx", "type6", "type7", "type8", "type9",
  "type9_military", "typex", "typex_2", "typex_3", "viper", "viper_mkiv", "vulture",
]);

/**
 * The supercharge of a ship type (owner, 2026-10-15: "detects ship from LoadGame Ship ... auto pick 4x, if ship is not
 * recognized (game update) keep at 4x but remember the option"): ×6 for the Caspian Explorer, ×4 for every other ship
 * the game sells, null for a type not on the list (the planner then keeps the commander's own pick).
 */
export function superchargeForShip(ship: string | null | undefined): number | null {
  const t = ship?.toLowerCase();
  if (!t || !KNOWN_SHIPS.has(t)) return null;
  return t === "explorer_nx" ? NEUTRON_BOOST_MK2 : NEUTRON_BOOST;
}

/**
 * The supercharge of a drive, else of the ship type: ×6 for the Mk II SCO drive, ×4 for any other drive; with no drive
 * known, {@link superchargeForShip}. Null when neither says (the planner then keeps the commander's own pick).
 */
export function superchargeFor(ship: string | null | undefined, fsd: string | null | undefined): number | null {
  const d = fsd?.toLowerCase();
  if (d && d.includes("hyperdrive")) return d.includes(MK2_SCO_DRIVE) ? NEUTRON_BOOST_MK2 : NEUTRON_BOOST;
  return superchargeForShip(ship);
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
    boostFactor: superchargeFor(s?.ship, s?.fsd) ?? NEUTRON_BOOST,
    shipKnown: superchargeFor(s?.ship, s?.fsd) != null,
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
