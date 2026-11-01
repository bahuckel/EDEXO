/**
 * Where the ship is inside the current system, for the Scan route (plan 1.3.5 R-1, owner 2026-11-01: "the ship
 * moving live/semi-live"). The journal gives no coordinates in a system, only events: the arrival star, a body
 * approached, dropped at, landed on or mapped (GameStateStore.currentBodyKey), and the flight state below. The body
 * targeted comes from Status.json (`store.statusDestination`). With the netlog switch on, netlogPosition.ts adds a
 * fix: the body the game measures the ship from and the distance to it.
 */
import type { GameStateStore } from "./gameState.js";
import type { ScanRouteShipDTO, ShipFlight } from "../shared/dto/routeSystem.js";
import type { NetlogFix, NetlogPosition } from "./netlogPosition.js";

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
export function scanRouteShip(store: GameStateStore, netlog: NetlogPosition | null): ScanRouteShipDTO {
  const addr = store.currentSystemAddress;
  const dest = store.statusDestination;
  // A netlog line for this system, newer than the journal's last word on where the ship is.
  const here = (f: NetlogFix | null): f is NetlogFix =>
    !!f && addr != null && f.system.toLowerCase() === (store.currentSystem ?? "").toLowerCase() && f.atMs >= store.shipEventMs - 1000;
  const fix = netlog?.fix() ?? null;
  const own = here(fix) ? { refId: fix.bodyId, distLs: fix.distLs, mode: fix.mode, atMs: fix.atMs } : null;
  // The body last flown near (netlog) when that is newer than the journal's body; a far fix moves nothing.
  const near = netlog?.near() ?? null;
  const journalAt = addr != null ? bodyIn(store.currentBodyKey, addr) : null;
  return {
    addr: addr != null ? String(addr) : null,
    atId: here(near) ? near.bodyId : journalAt,
    targetId: addr != null && dest && dest.systemAddress === addr ? dest.bodyId : null,
    flight: store.shipFlight,
    fix: own,
    netlog: netlog?.status() ?? { on: false, state: "off", folder: null },
  };
}
