/**
 * The commander's own fleet carrier and colonised systems, from the journal, for the galaxy map's badges (owner,
 * 2026-10-13: "System with my own carrier, and my own stations get a little icon").
 *
 * - Carrier: `CarrierLocation` (written at a game load for the commander's own carrier; `CarrierType` "FleetCarrier",
 *   a squadron's carrier is not his) says where it is. `CarrierJumpRequest` schedules a jump and
 *   `CarrierJumpCancelled` takes it back: once the departure time has passed (and the jump's 15 minutes or so), the
 *   carrier is taken to be at the requested system until the next `CarrierLocation` says otherwise.
 * - The jump timer (owner, 2026-11-02, "carrier jump timer - yes"): `CarrierStats` gives the name, callsign and
 *   tritium; `CarrierJump` (written only when he is aboard) lands the scheduled jump at once; the HUD's Carrier section
 *   counts down to the lockdown and the departure, then the cooldown, from `ownCarrierJump`.
 * - Colonies: `ColonisationSystemClaim` (the suite claims the system; `ColonisationBeaconDeployed` follows without a
 *   system name) adds the system, `ColonisationSystemClaimRelease` takes it away. What the commander builds there
 *   is his own.
 */
export interface OwnSystem {
  name: string;
  addr: number;
  at: string;
}

/** The carrier's own figures from `CarrierStats` (the carrier management screen, and at a game load). */
export interface OwnCarrierInfo {
  name: string | null;
  callsign: string | null;
  /** Tritium in the tank, tonnes. */
  fuel: number | null;
  jumpRangeMax: number | null;
}

export interface OwnAssetsState {
  carrier: OwnSystem | null;
  pendingJump: (OwnSystem & { departure: string; body?: string }) | null;
  colonies: OwnSystem[];
  /** Absent in a journal cache written before 2026-11-02 (hydrateOwnAssets fills it). */
  info?: OwnCarrierInfo | null;
  /** When the last jump landed (ISO): the start of the cooldown. */
  lastArrival?: string | null;
}

/*
  The game's carrier timings, approximate (owner's journals, 2026-11-02): `DepartureTime` is already the end of the
  countdown (15 to 16 minutes after the request, always at :10 s), and `CarrierJump` follows it by about 51 s
  (18:55:10 → 18:56:01, 00:16:10 → 00:17:01, 11:14:10 → 11:15:01). The pads close 3 min 20 s before departure, and a
  carrier that has jumped cannot schedule the next jump for about 5 minutes. Until 2026-11-02 the jump was taken to
  land 20 minutes after departure, a quarter of an hour too late for the galaxy map's badge.
*/
/** From the departure time to the carrier in the new system (the hyperspace tunnel; ~51 s seen). */
export const CARRIER_ARRIVE_MS = 60 * 1000;
/** Lockdown (the pads close) before the departure time. */
export const CARRIER_LOCKDOWN_MS = 200 * 1000;
/** After landing, before the next jump can be scheduled (about 5 minutes). */
export const CARRIER_COOLDOWN_MS = 5 * 60 * 1000;

export function newOwnAssets(): OwnAssetsState {
  return { carrier: null, pendingJump: null, colonies: [], info: null, lastArrival: null };
}

const own = (line: Record<string, unknown>) =>
  line.CarrierType == null || line.CarrierType === "FleetCarrier";

function systemOf(line: Record<string, unknown>, key: "StarSystem" | "SystemName"): OwnSystem | null {
  const name = typeof line[key] === "string" ? (line[key] as string).trim() : "";
  const addr = typeof line.SystemAddress === "number" ? line.SystemAddress : null;
  return name && addr != null ? { name, addr, at: String(line.timestamp ?? "") } : null;
}

/** A scheduled jump that had time to happen by `at` becomes where the carrier is (review 1.2.16). */
function landJump(st: OwnAssetsState, at: unknown): void {
  const p = st.pendingJump;
  const t = typeof at === "string" ? Date.parse(at) : NaN;
  if (!p || !Number.isFinite(t) || t < Date.parse(p.departure) + CARRIER_ARRIVE_MS) return;
  st.carrier = { name: p.name, addr: p.addr, at: p.departure };
  st.lastArrival = arrivalOf(p.departure);
  st.pendingJump = null;
}

function arrivalOf(departure: string): string | null {
  const t = Date.parse(departure);
  return Number.isFinite(t) ? new Date(t + CARRIER_ARRIVE_MS).toISOString() : null;
}

const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function ownAssetsLine(st: OwnAssetsState, line: Record<string, unknown>): void {
  switch (line.event) {
    case "CarrierLocation": {
      const s = own(line) ? systemOf(line, "StarSystem") : null;
      if (s) {
        // A jump that landed while the game was closed: its cooldown is known from the departure.
        landJump(st, line.timestamp);
        st.carrier = s;
        // Written at every game load: a jump still counting down (a relog before it departs) stays scheduled.
        const t = typeof line.timestamp === "string" ? Date.parse(line.timestamp) : NaN;
        if (!st.pendingJump || !(t < Date.parse(st.pendingJump.departure))) st.pendingJump = null;
      }
      return;
    }
    case "CarrierJumpRequest": {
      const s = own(line) ? systemOf(line, "SystemName") : null;
      const departure = typeof line.DepartureTime === "string" ? line.DepartureTime : null;
      // The jump before may have landed: it is where the carrier is now, before the new one is scheduled.
      landJump(st, line.timestamp);
      const body = strOrNull(line.Body);
      if (s && departure) st.pendingJump = { ...s, departure, ...(body ? { body } : {}) };
      return;
    }
    case "CarrierJump": {
      /*
        Written for any carrier he is aboard when it jumps, a stranger's too: it lands his own jump only when it
        arrives where his scheduled one was going.
      */
      const s = systemOf(line, "StarSystem");
      const p = st.pendingJump;
      if (s && p && s.addr === p.addr) {
        st.carrier = s;
        st.lastArrival = typeof line.timestamp === "string" ? line.timestamp : arrivalOf(p.departure);
        st.pendingJump = null;
      }
      return;
    }
    case "CarrierStats": {
      if (!own(line)) return;
      st.info = {
        name: strOrNull(line.Name),
        callsign: strOrNull(line.Callsign),
        fuel: numOrNull(line.FuelLevel),
        jumpRangeMax: numOrNull(line.JumpRangeMax),
      };
      return;
    }
    case "CarrierJumpCancelled":
      if (own(line)) {
        landJump(st, line.timestamp);
        st.pendingJump = null;
      }
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
    if (Number.isFinite(t) && nowMs >= t + CARRIER_ARRIVE_MS) return { name: p.name, addr: p.addr, at: p.departure };
  }
  return st.carrier;
}

/** The HUD's Carrier section: a jump scheduled or a cooldown running at `nowMs`, else null. */
export interface OwnCarrierJumpDTO {
  name: string | null;
  callsign: string | null;
  fuel: number | null;
  /** Where the carrier is (before the scheduled jump lands). */
  system: string | null;
  pending: { system: string; body: string | null; departureMs: number; lockdownMs: number; arriveMs: number } | null;
  /** The next jump can be scheduled from then on; null when no cooldown is known. */
  cooldownUntilMs: number | null;
}

/**
 * The timer's figures. Times rather than a countdown, so the HUD counts itself (no push every second); the client
 * also lets a pending jump run on into its cooldown when no new snapshot comes. A request whose departure is long
 * past (an old journal, a jump landed while the game was closed) shows nothing.
 */
export function ownCarrierJump(st: OwnAssetsState, nowMs = Date.now()): OwnCarrierJumpDTO | null {
  const p = st.pendingJump;
  const dep = p ? Date.parse(p.departure) : NaN;
  const arrive = Number.isFinite(dep) ? dep + CARRIER_ARRIVE_MS : NaN;
  const last = st.lastArrival ? Date.parse(st.lastArrival) : NaN;
  const cooldownFrom = Number.isFinite(arrive) && nowMs >= arrive ? arrive : last;
  const cooldownUntilMs = Number.isFinite(cooldownFrom) ? cooldownFrom + CARRIER_COOLDOWN_MS : null;
  const pending =
    p && Number.isFinite(dep) && nowMs < arrive
      ? { system: p.name, body: p.body ?? null, departureMs: dep, lockdownMs: dep - CARRIER_LOCKDOWN_MS, arriveMs: arrive }
      : null;
  if (!pending && !(cooldownUntilMs != null && nowMs < cooldownUntilMs)) return null;
  const info = st.info ?? null;
  return {
    name: info?.name ?? null,
    callsign: info?.callsign ?? null,
    fuel: info?.fuel ?? null,
    system: pending ? (st.carrier?.name ?? null) : (ownCarrierNow(st, nowMs)?.name ?? null),
    pending,
    cooldownUntilMs: pending ? pending.arriveMs + CARRIER_COOLDOWN_MS : cooldownUntilMs,
  };
}

export type CarrierPhase =
  | { kind: "countdown"; system: string; body: string | null; toDepartMs: number; toLockdownMs: number }
  | { kind: "lockdown"; system: string; body: string | null; toDepartMs: number }
  | { kind: "jumping"; system: string; body: string | null }
  | { kind: "cooldown"; leftMs: number };

/** Where the carrier's jump stands at `nowMs`, or null when there is nothing to count. */
export function carrierPhase(cj: OwnCarrierJumpDTO | null | undefined, nowMs: number): CarrierPhase | null {
  if (!cj) return null;
  const p = cj.pending;
  if (p && nowMs < p.lockdownMs)
    return { kind: "countdown", system: p.system, body: p.body, toDepartMs: p.departureMs - nowMs, toLockdownMs: p.lockdownMs - nowMs };
  if (p && nowMs < p.departureMs) return { kind: "lockdown", system: p.system, body: p.body, toDepartMs: p.departureMs - nowMs };
  if (p && nowMs < p.arriveMs) return { kind: "jumping", system: p.system, body: p.body };
  if (cj.cooldownUntilMs != null && nowMs < cj.cooldownUntilMs) return { kind: "cooldown", leftMs: cj.cooldownUntilMs - nowMs };
  return null;
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
  const body = (r.pendingJump as { body?: unknown } | null)?.body;
  st.pendingJump =
    p && typeof dep === "string" ? { ...p, departure: dep, ...(typeof body === "string" ? { body } : {}) } : null;
  const info = r.info as Partial<OwnCarrierInfo> | null | undefined;
  st.info =
    info && typeof info === "object"
      ? {
          name: strOrNull(info.name),
          callsign: strOrNull(info.callsign),
          fuel: numOrNull(info.fuel),
          jumpRangeMax: numOrNull(info.jumpRangeMax),
        }
      : null;
  st.lastArrival = typeof r.lastArrival === "string" ? r.lastArrival : null;
  st.colonies = Array.isArray(r.colonies) ? r.colonies.map(sys).filter((c): c is OwnSystem => c != null) : [];
  return st;
}
