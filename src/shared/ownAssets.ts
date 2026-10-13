/**
 * The commander's own fleet carrier and colonised systems, from the journal, for the galaxy map's badges (owner,
 * 2026-10-13: "System with my own carrier, and my own stations get a little icon").
 *
 * - Carrier: `CarrierLocation` (written at a game load for the commander's own carrier; `CarrierType` "FleetCarrier",
 *   a squadron's carrier is not his) says where it is. `CarrierJumpRequest` schedules a jump and
 *   `CarrierJumpCancelled` takes it back: once the departure time has passed (and the jump's 15 minutes or so), the
 *   carrier is taken to be at the requested system until the next `CarrierLocation` says otherwise.
 * - Colonies: `ColonisationSystemClaim` (the suite claims the system; `ColonisationBeaconDeployed` follows without a
 *   system name) adds the system, `ColonisationSystemClaimRelease` takes it away. What the commander builds there
 *   is his own.
 */
export interface OwnSystem {
  name: string;
  addr: number;
  at: string;
}

export interface OwnAssetsState {
  carrier: OwnSystem | null;
  pendingJump: (OwnSystem & { departure: string }) | null;
  colonies: OwnSystem[];
}

/** After the departure time, the jump itself (about a quarter of an hour; the game says 15 to 20 minutes). */
const JUMP_MS = 20 * 60 * 1000;

export function newOwnAssets(): OwnAssetsState {
  return { carrier: null, pendingJump: null, colonies: [] };
}

const own = (line: Record<string, unknown>) =>
  line.CarrierType == null || line.CarrierType === "FleetCarrier";

function systemOf(line: Record<string, unknown>, key: "StarSystem" | "SystemName"): OwnSystem | null {
  const name = typeof line[key] === "string" ? (line[key] as string).trim() : "";
  const addr = typeof line.SystemAddress === "number" ? line.SystemAddress : null;
  return name && addr != null ? { name, addr, at: String(line.timestamp ?? "") } : null;
}

export function ownAssetsLine(st: OwnAssetsState, line: Record<string, unknown>): void {
  switch (line.event) {
    case "CarrierLocation": {
      const s = own(line) ? systemOf(line, "StarSystem") : null;
      if (s) {
        st.carrier = s;
        st.pendingJump = null;
      }
      return;
    }
    case "CarrierJumpRequest": {
      const s = own(line) ? systemOf(line, "SystemName") : null;
      const departure = typeof line.DepartureTime === "string" ? line.DepartureTime : null;
      if (s && departure) st.pendingJump = { ...s, departure };
      return;
    }
    case "CarrierJumpCancelled":
      if (own(line)) st.pendingJump = null;
      return;
    case "ColonisationSystemClaim": {
      const s = systemOf(line, "StarSystem");
      if (s && !st.colonies.some((c) => c.addr === s.addr)) st.colonies.push(s);
      return;
    }
    case "ColonisationSystemClaimRelease": {
      const addr = typeof line.SystemAddress === "number" ? line.SystemAddress : null;
      const name = typeof line.StarSystem === "string" ? line.StarSystem.toLowerCase() : null;
      st.colonies = st.colonies.filter((c) => c.addr !== addr && c.name.toLowerCase() !== name);
      return;
    }
  }
}

/** Where the carrier is now: a scheduled jump that has had time to happen, else the last location. */
export function ownCarrierNow(st: OwnAssetsState, nowMs = Date.now()): OwnSystem | null {
  const p = st.pendingJump;
  if (p) {
    const t = Date.parse(p.departure);
    if (Number.isFinite(t) && nowMs >= t + JUMP_MS) return { name: p.name, addr: p.addr, at: p.departure };
  }
  return st.carrier;
}

/** The state from the journal cache, or empty for anything else. */
export function hydrateOwnAssets(raw: unknown): OwnAssetsState {
  const st = newOwnAssets();
  const r = raw as Partial<OwnAssetsState> | null;
  if (!r || typeof r !== "object") return st;
  const sys = (v: unknown): OwnSystem | null => {
    const o = v as Partial<OwnSystem> | null;
    return o && typeof o.name === "string" && typeof o.addr === "number"
      ? { name: o.name, addr: o.addr, at: typeof o.at === "string" ? o.at : "" }
      : null;
  };
  st.carrier = sys(r.carrier);
  const p = sys(r.pendingJump);
  const dep = (r.pendingJump as { departure?: unknown } | null)?.departure;
  st.pendingJump = p && typeof dep === "string" ? { ...p, departure: dep } : null;
  st.colonies = Array.isArray(r.colonies) ? r.colonies.map(sys).filter((c): c is OwnSystem => c != null) : [];
  return st;
}
