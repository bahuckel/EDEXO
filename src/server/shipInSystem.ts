/**
 * Where the ship is inside the current system, for the Scan route (plan 1.3.5 R-1, owner 2026-11-01: "the ship
 * moving live/semi-live"). The journal gives no coordinates in a system, only events: the arrival star, a body
 * approached, dropped at, landed on or mapped (GameStateStore.currentBodyKey), and the flight state below. The body
 * targeted comes from Status.json (`store.statusDestination`). With the netlog switch on, netlogPosition.ts adds a
 * fix: the body the game measures the ship from and the distance to it.
 */
import type { GameStateStore } from "./gameState.js";
import type { ScanRouteShipDTO, ShipFlight } from "../shared/dto/routeSystem.js";
import type { NetlogPosition } from "./netlogPosition.js";

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
  const fix = netlog?.fix() ?? null;
  // The netlog's line is for this system, and newer than the journal's last word on where the ship is.
  const own =
    fix && addr != null && fix.system.toLowerCase() === (store.currentSystem ?? "").toLowerCase() && fix.atMs >= store.shipEventMs - 1000
      ? { refId: fix.bodyId, distLs: fix.distLs, mode: fix.mode, atMs: fix.atMs }
      : null;
  return {
    addr: addr != null ? String(addr) : null,
    atId: addr != null ? bodyIn(store.currentBodyKey, addr) : null,
    targetId: addr != null && dest && dest.systemAddress === addr ? dest.bodyId : null,
    flight: store.shipFlight,
    fix: own,
    netlog: netlog?.status() ?? { on: false, state: "off", folder: null },
  };
}
