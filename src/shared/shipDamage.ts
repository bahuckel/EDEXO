/**
 * The ship's damage, part by part (discuss item 32, owner 2026-10-22: "a top-down 2D ship view with per-part damage %").
 *
 * What the journal gives: `Loadout` lists every module with its `Health` (0..1) and the hull's `HullHealth`, but only
 * at a game load, after outfitting and after a repair; during a fight there is `HullDamage` (the hull's health when it
 * crosses a threshold) and `AfmuRepairs` (a module's health after the AFMU), nothing per module per hit. So the hull
 * is live, a module is as of the last Loadout (or AFMU), and the view says so. `Repair` / `RepairAll` set what they
 * name back to whole; a ship swap or a death clears it until the next Loadout.
 */

export type ShipPartGroup = "core" | "hardpoint" | "utility" | "optional";

export interface ShipPart {
  slot: string;
  item: string;
  label: string;
  group: ShipPartGroup;
  /** 0..1, or null when the journal did not say. */
  health: number | null;
}

export interface ShipDamageState {
  ship: string | null;
  shipName: string | null;
  shipIdent: string | null;
  /** 0..1, or null before a Loadout. */
  hull: number | null;
  /** When the hull figure was last told (a Loadout or a HullDamage). */
  hullAt: string | null;
  parts: ShipPart[];
  /** The Loadout the module figures come from. */
  loadoutAt: string | null;
}

export function newShipDamage(): ShipDamageState {
  return { ship: null, shipName: null, shipIdent: null, hull: null, hullAt: null, parts: [], loadoutAt: null };
}

const CORE: Record<string, string> = {
  Armour: "Armour",
  PowerPlant: "Power plant",
  MainEngines: "Thrusters",
  FrameShiftDrive: "FSD",
  LifeSupport: "Life support",
  PowerDistributor: "Power distributor",
  Radar: "Sensors",
  FuelTank: "Fuel tank",
};

/** What a module is, from its item name (`int_powerplant_size6_class5`, `hpt_pulselaser_fixed_medium`). */
const ITEM_LABELS: [RegExp, string][] = [
  [/^int_shieldgenerator/, "Shield generator"],
  [/^int_fuelscoop/, "Fuel scoop"],
  [/^int_repairer/, "AFMU"],
  [/^int_detailedsurfacescanner/, "Surface scanner"],
  [/^int_dockingcomputer/, "Docking computer"],
  [/^int_supercruiseassist/, "Supercruise assist"],
  [/^int_buggybay/, "SRV hangar"],
  [/^int_fighterbay/, "Fighter hangar"],
  [/^int_guardianfsdbooster/, "FSD booster"],
  [/^int_hullreinforcement/, "Hull reinforcement"],
  [/^int_modulereinforcement/, "Module reinforcement"],
  [/^int_cargorack/, "Cargo rack"],
  [/^int_passengercabin/, "Cabin"],
  [/^int_fueltank/, "Fuel tank"],
  [/^int_dronecontrol_repair/, "Repair limpets"],
  [/^int_dronecontrol_collection/, "Collector limpets"],
  [/^int_dronecontrol_prospector/, "Prospector limpets"],
  [/^int_dronecontrol/, "Limpet controller"],
  [/^int_refinery/, "Refinery"],
  [/^int_shieldcellbank/, "Shield cells"],
  [/^hpt_shieldbooster/, "Shield booster"],
  [/^hpt_heatsinklauncher/, "Heat sink"],
  [/^hpt_chafflauncher/, "Chaff"],
  [/^hpt_plasmapointdefence/, "Point defence"],
  [/^hpt_electroniccountermeasure/, "ECM"],
  [/^hpt_cloudscanner/, "Wake scanner"],
  [/^hpt_cargoscanner/, "Manifest scanner"],
  [/^hpt_crimescanner/, "Warrant scanner"],
  [/^hpt_mrascanner/, "Pulse wave scanner"],
  [/^hpt_xenoscanner/, "Xeno scanner"],
  [/^hpt_pulselaserburst/, "Burst laser"],
  [/^hpt_pulselaser/, "Pulse laser"],
  [/^hpt_beamlaser/, "Beam laser"],
  [/^hpt_multicannon/, "Multi-cannon"],
  [/^hpt_cannon/, "Cannon"],
  [/^hpt_slugshot/, "Fragment cannon"],
  [/^hpt_railgun/, "Rail gun"],
  [/^hpt_plasmaaccelerator/, "Plasma accelerator"],
  [/^hpt_dumbfiremissilerack|^hpt_basicmissilerack|^hpt_missile/, "Missiles"],
  [/^hpt_minelauncher/, "Mine launcher"],
  [/^hpt_mining_seismchrgwarhd|^hpt_mining_subsurfdispmisle/, "Mining launcher"],
  [/^hpt_mininglaser/, "Mining laser"],
  [/^hpt_mining_abrblstr/, "Abrasion blaster"],
  [/^hpt_guardian/, "Guardian weapon"],
  [/^hpt_atdumbfiremissile|^hpt_atmulticannon|^hpt_atventdisruptorpylon/, "AX weapon"],
];

/** "int_powerplant_size6_class5" -> 6A; null when the item names no size and class. */
function rating(item: string): string | null {
  const m = /size(\d+)_class(\d+)/.exec(item);
  if (!m) return null;
  const cls = "EDCBA"[Number(m[2]) - 1];
  return cls ? `${m[1]}${cls}` : null;
}

function humanize(item: string): string {
  const words = item.replace(/^(int|hpt)_/, "").split("_")[0] ?? item;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Which slots carry a part worth a place on the view: core, weapons, utilities, optional internals. */
export function partOf(slot: string, item: string): Pick<ShipPart, "group" | "label"> | null {
  const it = item.toLowerCase().replace(/^\$|_name;$/g, "");
  if (slot in CORE) {
    const r = rating(it);
    return { group: "core", label: `${CORE[slot]}${r ? ` ${r}` : ""}` };
  }
  const named = ITEM_LABELS.find(([re]) => re.test(it))?.[1] ?? humanize(it);
  if (/^TinyHardpoint\d+$/i.test(slot)) return { group: "utility", label: named };
  if (/Hardpoint\d+$/i.test(slot)) {
    const size = /^(Huge|Large|Medium|Small)/i.exec(slot)?.[1];
    return { group: "hardpoint", label: `${named}${size ? ` (${size[0]!.toUpperCase()})` : ""}` };
  }
  if (/^Slot\d+_Size\d+$/i.test(slot) || /^Military\d+$/i.test(slot)) {
    const r = rating(it);
    return { group: "optional", label: `${named}${r ? ` ${r}` : ""}` };
  }
  return null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function shipDamageLoadout(s: ShipDamageState, j: Record<string, unknown>): void {
  s.ship = str(j.Ship);
  s.shipName = str(j.ShipName);
  s.shipIdent = str(j.ShipIdent);
  s.hull = num(j.HullHealth);
  s.hullAt = str(j.timestamp);
  s.loadoutAt = str(j.timestamp);
  const parts: ShipPart[] = [];
  for (const raw of Array.isArray(j.Modules) ? j.Modules : []) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    const slot = str(m.Slot);
    const item = str(m.Item);
    if (!slot || !item) continue;
    const p = partOf(slot, item);
    if (!p) continue;
    parts.push({ slot, item: item.toLowerCase(), ...p, health: num(m.Health) });
  }
  s.parts = parts;
}

/** `HullDamage`: the commander's own ship only (not a fighter he flies, not one his crew flies). */
export function shipDamageHull(s: ShipDamageState, j: Record<string, unknown>): void {
  if (j.Fighter === true || j.PlayerPilot === false) return;
  const h = num(j.Health);
  if (h == null) return;
  s.hull = h;
  s.hullAt = str(j.timestamp);
}

/** `AfmuRepairs`: one module's health after the AFMU worked on it. */
export function shipDamageAfmu(s: ShipDamageState, j: Record<string, unknown>): void {
  const item = (str(j.Module) ?? "").toLowerCase().replace(/^\$|_name;$/g, "");
  const h = num(j.Health);
  if (!item || h == null) return;
  for (const p of s.parts) if (p.item === item) p.health = h;
}

/** `Repair` (names what it repaired) and `RepairAll` (everything): those parts whole again. */
export function shipDamageRepair(s: ShipDamageState, j: Record<string, unknown>): void {
  if (j.event === "RepairAll") {
    s.hull = s.hull == null ? null : 1;
    for (const p of s.parts) if (p.health != null) p.health = 1;
    return;
  }
  const items = (Array.isArray(j.Items) ? j.Items : [j.Item]).map((x) => (typeof x === "string" ? x.toLowerCase().replace(/^\$|_name;$/g, "") : ""));
  for (const it of items) {
    if (!it) continue;
    if (it === "hull") s.hull = s.hull == null ? null : 1;
    if (it === "all") shipDamageRepair(s, { event: "RepairAll" });
    for (const p of s.parts) if (p.item === it && p.health != null) p.health = 1;
  }
}

/** Another ship, or a rebuy: nothing is known until its Loadout. */
export function shipDamageForget(s: ShipDamageState): void {
  Object.assign(s, newShipDamage());
}

/** How bad a health is, for the colours: whole, worn (under 80 %), damaged (under 50 %). */
export function healthTier(h: number | null): "ok" | "warn" | "bad" | "unknown" {
  if (h == null) return "unknown";
  if (h < 0.5) return "bad";
  if (h < 0.8) return "warn";
  return "ok";
}

export function hydrateShipDamage(raw: unknown): ShipDamageState {
  const s = newShipDamage();
  if (!raw || typeof raw !== "object") return s;
  const o = raw as Record<string, unknown>;
  s.ship = str(o.ship);
  s.shipName = str(o.shipName);
  s.shipIdent = str(o.shipIdent);
  s.hull = num(o.hull);
  s.hullAt = str(o.hullAt);
  s.loadoutAt = str(o.loadoutAt);
  s.parts = (Array.isArray(o.parts) ? o.parts : [])
    .filter((p): p is ShipPart => !!p && typeof p === "object" && typeof (p as ShipPart).slot === "string" && typeof (p as ShipPart).item === "string")
    .map((p) => ({ slot: p.slot, item: p.item, label: String(p.label ?? p.item), group: p.group, health: num(p.health) }));
  return s;
}
