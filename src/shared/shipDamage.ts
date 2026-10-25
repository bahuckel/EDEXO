/**
 * The ship's damage, part by part (discuss item 32, owner 2026-10-22: "a top-down 2D ship view with per-part damage %").
 *
 * What the journal gives: `Loadout` lists every module with its `Health` (0..1) and the hull's `HullHealth`, but only
 * at a game load, after outfitting and after a repair; during a fight there is `HullDamage` (the hull's health when it
 * crosses a threshold) and `AfmuRepairs` (a module's health after the AFMU), nothing per module per hit. So the hull
 * is live, a module is as of the last Loadout (or AFMU), and the view says so. `Repair` / `RepairAll` set what they
 * name back to whole; a ship swap or a death clears it until the next Loadout.
 *
 * The vehicles the ship carries (1.3.1, owner 2026-10-25: "ship deployed vehicles ... Nomad, Rhino, the SRVs"): an SRV
 * (`LaunchSRV` / `DockSRV` / `SRVDestroyed`, `SRVType` testbuggy = Scarab, combat_multicrew_srv_01 = Scorpion,
 * mev_rhino = Rhino), a fighter or the Nomad (`LaunchFighter` / `DockFighter` / `FighterDestroyed` / `FighterRebuilt`;
 * since the Rhino update a field with no name carries the vessel, "lander01" = Nomad; a fighter's model comes from
 * `RestockVehicle`). Their hull is a `HullDamage` too: `Fighter: true` for a fighter or the Nomad, and no `Fighter` field
 * at all while the commander drives an SRV (owner's journals: every such line falls between LaunchSRV and DockSRV; 1.3.0
 * put those on the ship's hull). Like the hull, a vehicle's figure is as of its last hit.
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

export type VehicleKind = "srv" | "fighter" | "slv";

export interface ShipVehicle {
  /** One per kind and model: "srv:testbuggy", "fighter:independent_fighter", "slv:lander01". */
  key: string;
  kind: VehicleKind;
  /** The journal's name for the model, or null when it did not say. */
  type: string | null;
  name: string;
  state: "out" | "docked" | "destroyed";
  /** 0..1 as of its last HullDamage, or null when nothing was said yet. */
  hull: number | null;
  hullAt: string | null;
  /** Who flies or drives it when it is out. */
  pilot: "you" | "crew" | null;
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
  /** The ship's vehicles seen since its Loadout, newest launch first. */
  vehicles: ShipVehicle[];
  /** The vehicle the commander is in (its key), or null in the ship itself (or on foot). */
  inVehicle: string | null;
  /** The fighter model the hangar was last restocked with (`RestockVehicle`), for a LaunchFighter that does not say. */
  fighterType: string | null;
}

export function newShipDamage(): ShipDamageState {
  return {
    ship: null,
    shipName: null,
    shipIdent: null,
    hull: null,
    hullAt: null,
    parts: [],
    loadoutAt: null,
    vehicles: [],
    inVehicle: null,
    fighterType: null,
  };
}

/** The game's vehicle names, for when an event has no `_Localised` (old journals, a cache). */
const VEHICLE_NAMES: Record<string, string> = {
  testbuggy: "SRV Scarab",
  combat_multicrew_srv_01: "SRV Scorpion",
  mev_rhino: "Rhino",
  lander01: "Nomad",
  independent_fighter: "Taipan",
  empire_fighter: "GU-97",
  federation_fighter: "F63 Condor",
  gdn_hybrid_fighter_v1: "XG7 Trident",
  gdn_hybrid_fighter_v2: "XG8 Javelin",
  gdn_hybrid_fighter_v3: "XG9 Lance",
};

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

/**
 * `HullDamage`, to whichever hull it is about: `Fighter: true` is a fighter or the Nomad (the one the commander is in,
 * else the one his crew flies); `Fighter: false` is the ship, whoever flies it; no `Fighter` field is the vehicle the
 * commander is in (an SRV writes it so), else the ship.
 */
export function shipDamageHull(s: ShipDamageState, j: Record<string, unknown>): void {
  const h = num(j.Health);
  if (h == null) return;
  const at = str(j.timestamp);
  const pilot = j.PlayerPilot === false ? "crew" : "you";
  if (j.Fighter === true) {
    const out = s.vehicles.filter((v) => v.state === "out" && v.kind !== "srv");
    const v =
      out.find((v) => pilot === "you" && v.key === s.inVehicle) ?? out.find((v) => v.pilot === pilot) ?? out[0] ?? null;
    if (v) Object.assign(v, { hull: h, hullAt: at, pilot });
    return;
  }
  if (j.Fighter === undefined && s.inVehicle) {
    const v = s.vehicles.find((v) => v.key === s.inVehicle);
    if (v) {
      Object.assign(v, { hull: h, hullAt: at });
      return;
    }
  }
  if (j.Fighter === undefined && j.PlayerPilot === false) return;
  s.hull = h;
  s.hullAt = at;
}

function vehicleOf(s: ShipDamageState, kind: VehicleKind, type: string | null, localised: string | null): ShipVehicle {
  const key = `${kind}:${type ?? "?"}`;
  let v = s.vehicles.find((x) => x.key === key);
  if (!v) {
    const fallback = kind === "srv" ? "SRV" : kind === "slv" ? "Ship-launched vessel" : "Fighter";
    const name = localised ?? (type ? VEHICLE_NAMES[type] : undefined) ?? fallback;
    v = { key, kind, type, name, state: "docked", hull: null, hullAt: null, pilot: null };
    s.vehicles.unshift(v);
    // A ship carries two or three; an old model drops off after a few.
    s.vehicles.length = Math.min(s.vehicles.length, 6);
  } else if (localised) v.name = localised;
  return v;
}

/** A fighter-bay launch's vessel: the unnamed field of the Rhino update ("lander01"), a named one, else the restock. */
function bayVessel(
  s: ShipDamageState,
  j: Record<string, unknown>,
): { kind: VehicleKind; type: string | null; localised: string | null } {
  const type = str(j.FighterType) ?? str(j.VesselType) ?? str(j[""]) ?? s.fighterType;
  const localised = str(j.FighterType_Localised) ?? str(j.VesselType_Localised) ?? str(j._Localised);
  const slv = /^lander/i.test(type ?? "") || /nomad/i.test(localised ?? "");
  return { kind: slv ? "slv" : "fighter", type: type ? type.toLowerCase() : null, localised };
}

const findOut = (s: ShipDamageState, kinds: VehicleKind[]) =>
  s.vehicles.find((v) => v.state === "out" && kinds.includes(v.kind)) ?? null;

/** Puts a vehicle first, out, with who drives it; the commander in it when he does. */
function launch(s: ShipDamageState, v: ShipVehicle, pilot: "you" | "crew"): void {
  s.vehicles = [v, ...s.vehicles.filter((x) => x !== v)];
  Object.assign(v, { state: "out", pilot });
  if (pilot === "you") s.inVehicle = v.key;
}

/** Back in the hangar, or lost (a lost one's hull is nothing). */
function recover(s: ShipDamageState, v: ShipVehicle | null, lost: boolean, at: string | null): void {
  if (!v) return;
  v.state = lost ? "destroyed" : "docked";
  if (lost) Object.assign(v, { hull: 0, hullAt: at });
  v.pilot = null;
  if (s.inVehicle === v.key) s.inVehicle = null;
}

/** The vehicle events: launches, docks, losses, rebuilds, the commander switching between ship and fighter. */
export function shipDamageVehicle(s: ShipDamageState, j: Record<string, unknown>): void {
  const ev = j.event;
  const at = str(j.timestamp);
  if (ev === "LaunchSRV") {
    const type = str(j.SRVType)?.toLowerCase() ?? null;
    launch(s, vehicleOf(s, "srv", type, str(j.SRVType_Localised)), j.PlayerControlled === false ? "crew" : "you");
  } else if (ev === "DockSRV" || ev === "SRVDestroyed") {
    const type = str(j.SRVType)?.toLowerCase() ?? null;
    const v = s.vehicles.find((x) => x.kind === "srv" && x.state === "out" && (type == null || x.type === type));
    recover(s, v ?? findOut(s, ["srv"]), ev === "SRVDestroyed", at);
  } else if (ev === "LaunchFighter") {
    const b = bayVessel(s, j);
    launch(s, vehicleOf(s, b.kind, b.type, b.localised), j.PlayerControlled === true ? "you" : "crew");
  } else if (ev === "DockFighter" || ev === "FighterDestroyed") {
    const mine = s.inVehicle ? s.vehicles.find((x) => x.key === s.inVehicle && x.kind !== "srv") : undefined;
    recover(s, mine ?? findOut(s, ["fighter", "slv"]), ev === "FighterDestroyed", at);
  } else if (ev === "FighterRebuilt") {
    // A new one in the bay, whole.
    const v = s.vehicles.find((x) => x.kind !== "srv" && x.state === "destroyed");
    if (v) Object.assign(v, { state: "docked", hull: 1, hullAt: at, pilot: null });
  } else if (ev === "VehicleSwitch") {
    // `To`: "Fighter" or "Mothership" - the commander takes the fighter over, or hands it to his crew.
    const v = findOut(s, ["fighter", "slv"]);
    if (j.To === "Fighter" && v) {
      v.pilot = "you";
      s.inVehicle = v.key;
    } else if (j.To === "Mothership") {
      if (v) v.pilot = "crew";
      s.inVehicle = null;
    }
  } else if (ev === "RestockVehicle") {
    const type = str(j.Type)?.toLowerCase() ?? null;
    if (type && !/buggy|srv|rhino/.test(type)) s.fighterType = type;
  } else if (ev === "LoadGame") {
    // A new session: whatever was out when the game closed is back in the hangar.
    for (const v of s.vehicles) if (v.state === "out") Object.assign(v, { state: "docked", pilot: null });
    s.inVehicle = null;
  } else if (ev === "Embark" && j.SRV === true) {
    const v = findOut(s, ["srv"]);
    if (v) {
      v.pilot = "you";
      s.inVehicle = v.key;
    }
  } else if ((ev === "Embark" || ev === "Disembark") && s.inVehicle) {
    // Back in the ship, or out on foot: no vehicle of his is taking his hits.
    s.inVehicle = null;
  }
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
    // The vehicles in the hangar are repaired with the ship.
    for (const v of s.vehicles) if (v.state === "docked" && v.hull != null) v.hull = 1;
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
  const kinds: VehicleKind[] = ["srv", "fighter", "slv"];
  const states: ShipVehicle["state"][] = ["out", "docked", "destroyed"];
  s.vehicles = (Array.isArray(o.vehicles) ? o.vehicles : [])
    .filter(
      (v): v is ShipVehicle =>
        !!v && typeof v === "object" && typeof (v as ShipVehicle).key === "string" && kinds.includes((v as ShipVehicle).kind),
    )
    .slice(0, 6)
    .map((v) => ({
      key: v.key,
      kind: v.kind,
      type: str(v.type),
      name: str(v.name) ?? v.key,
      state: states.includes(v.state) ? v.state : "docked",
      hull: num(v.hull),
      hullAt: str(v.hullAt),
      pilot: v.pilot === "you" || v.pilot === "crew" ? v.pilot : null,
    }));
  s.inVehicle = s.vehicles.some((v) => v.key === o.inVehicle) ? (o.inVehicle as string) : null;
  s.fighterType = str(o.fighterType);
  return s;
}
