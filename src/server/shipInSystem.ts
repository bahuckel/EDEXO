/**
 * Where the ship is inside the current system, for the Scan route (plan 1.3.5 R-1, owner 2026-11-01: "the ship
 * moving live/semi-live"). The journal gives no coordinates in a system, only events: the arrival star, a body
 * approached, dropped at, landed on or mapped (GameStateStore.currentBodyKey), and the flight state below. The body
 * targeted comes from Status.json (`store.statusDestination`). With the netlog switch on, netlogPosition.ts adds a
 * fix: the body the game measures the ship from and the distance to it. With the launcher's distance reader on, the
 * screen marker's page reads the target's distance off the HUD in supercruise (shared/hudTargetDistance.ts) and posts
 * it here (setHudDistance): a fix from the target itself, which the Scan route puts on the line to it.
 */
import type { GameStateStore } from "./gameState.js";
import type { ScanRouteShipDTO, ShipFlight } from "../shared/dto/routeSystem.js";
import type { NetlogFix, NetlogPosition } from "./netlogPosition.js";
import { bodyKey } from "../shared/bodyKey.js";
import { barycentreSyntheticBodyId } from "./orbitUtils.js";

/** The HUD's distance to the target, with the target it was read for; kept per store (one per server). */
interface HudDistance {
  distLs: number;
  systemAddress: number;
  bodyId: number;
  atMs: number;
}
const hudDistanceByStore = new WeakMap<GameStateStore, HudDistance>();
/** A HUD reading older than this is not used: the reader posts four times a second while it reads. */
export const HUD_DISTANCE_FRESH_MS = 4000;

/**
 * A distance read off the HUD (aim/useDistanceReader.ts), for the body targeted now; nothing without a target (the
 * reading cannot say which body it was for otherwise).
 */
export function setHudDistance(store: GameStateStore, distLs: number, nowMs = Date.now()): boolean {
  const dest = store.statusDestination;
  if (!dest || !(distLs >= 0) || !Number.isFinite(distLs)) return false;
  hudDistanceByStore.set(store, { distLs, systemAddress: dest.systemAddress, bodyId: dest.bodyId, atMs: nowMs });
  return true;
}

/**
 * The Scan route tab showing (owner, 2026-11-05: read the distance "only when the Scan route tab is in focus"): its
 * screen asks for the ship with `?view=1` every quarter second to second and a half while it shows (document visible,
 * its tab in front). Seen within this, it counts as showing.
 */
export const SCAN_ROUTE_VIEW_MS = 3000;
let scanRouteSeenMs = 0;
let scanRouteGone: ReturnType<typeof setTimeout> | null = null;

/**
 * The Scan route's screen asked: it shows. `onChange` (the snapshot push) runs when it starts showing, and once more
 * when it has not asked for SCAN_ROUTE_VIEW_MS, so the reader's trigger goes out without anyone asking for it.
 */
export function markScanRouteViewed(onChange: () => void, nowMs = Date.now()): void {
  const was = nowMs - scanRouteSeenMs <= SCAN_ROUTE_VIEW_MS;
  scanRouteSeenMs = nowMs;
  if (!was) onChange();
  if (scanRouteGone) clearTimeout(scanRouteGone);
  scanRouteGone = setTimeout(() => {
    scanRouteGone = null;
    onChange();
  }, SCAN_ROUTE_VIEW_MS + 100);
  scanRouteGone.unref?.();
}

/** The distance reader's trigger: the Scan route showing, in supercruise, a body of this system targeted. */
export function hudReadDistance(store: GameStateStore, nowMs = Date.now()): boolean {
  const addr = store.currentSystemAddress;
  const dest = store.statusDestination;
  return (
    nowMs - scanRouteSeenMs <= SCAN_ROUTE_VIEW_MS && store.shipFlight === "supercruise" && addr != null && !!dest && dest.systemAddress === addr
  );
}

/** Tests only. */
export function resetScanRouteViewForTests(): void {
  scanRouteSeenMs = 0;
  if (scanRouteGone) clearTimeout(scanRouteGone);
  scanRouteGone = null;
}

/** The flight state after a journal event; the state before for any other event. */
export function nextShipFlight(event: string, line: Record<string, unknown>, prev: ShipFlight): ShipFlight {
  switch (event) {
    case "FSDJump":
    case "SupercruiseEntry":
      return "supercruise";
    case "SupercruiseExit":
    case "Liftoff":
    case "Undocked":
      return "normal";
    case "Touchdown":
      return "landed";
    case "Docked":
      return "docked";
    case "Location":
    case "CarrierJump":
      return line.Docked === true ? "docked" : typeof line.Latitude === "number" ? "landed" : "normal";
    default:
      return prev;
  }
}

/** The body id in `addr` from a `system:body` key, else null. */
function bodyIn(key: string | null, addr: number): number | null {
  const prefix = `${addr}:`;
  if (!key?.startsWith(prefix)) return null;
  const id = Number(key.slice(prefix.length));
  return Number.isInteger(id) ? id : null;
}

/** The ship in the current system: the body it is at, the body targeted, the flight state and the netlog's fix. */
export function scanRouteShip(store: GameStateStore, netlog: NetlogPosition | null, nowMs = Date.now()): ScanRouteShipDTO {
  const addr = store.currentSystemAddress;
  const dest = store.statusDestination;
  const targetId = addr != null && dest && dest.systemAddress === addr ? dest.bodyId : null;
  // A netlog line for this system, newer than the journal's last word on where the ship is.
  const here = (f: NetlogFix | null): f is NetlogFix =>
    !!f && addr != null && f.system.toLowerCase() === (store.currentSystem ?? "").toLowerCase() && f.atMs >= store.shipEventMs - 1000;
  const fix = netlog?.fix() ?? null;
  const fromNetlog = here(fix) ? { refId: fix.bodyId, distLs: fix.distLs, mode: fix.mode, atMs: fix.atMs, from: "netlog" as const } : null;
  // The HUD's reading, while fresh, in supercruise, for the target still targeted: it is the one the arrow needs.
  const hud = hudDistanceByStore.get(store);
  const fromHud =
    hud && targetId != null && hud.systemAddress === addr && hud.bodyId === targetId && store.shipFlight === "supercruise" && nowMs - hud.atMs <= HUD_DISTANCE_FRESH_MS
      ? { refId: targetId, distLs: hud.distLs, mode: "supercruise" as const, atMs: hud.atMs, from: "hud" as const }
      : null;
  /*
    The body last flown near (netlog) when that is newer than the journal's body; a far fix moves nothing. Only a body
    of the system's own: the game also measures from barycentres (owner 2026-11-05: flying at A 5 it measured from body
    8, the barycentre A 5 and A 6 orbit, 8.3 ls off, and the ship jumped there).
  */
  const near = netlog?.near() ?? null;
  // Not a barycentre the FSS found here (kept under an id of its own, sold or not).
  const barycentre = (id: number) => {
    const k = bodyKey(addr!, barycentreSyntheticBodyId(id));
    return store.explorationScans.has(k) || store.soldExplorationScans.has(k);
  };
  const nearBody = here(near) && !barycentre(near.bodyId) ? near : null;
  const journalAt = addr != null ? bodyIn(store.currentBodyKey, addr) : null;
  return {
    addr: addr != null ? String(addr) : null,
    atId: nearBody ? nearBody.bodyId : journalAt,
    atFrom: nearBody ? "netlog" : journalAt != null ? "journal" : null,
    targetId,
    flight: store.shipFlight,
    fix: fromHud ?? fromNetlog,
    netlog: netlog?.status() ?? { on: false, state: "off", folder: null },
  };
}
