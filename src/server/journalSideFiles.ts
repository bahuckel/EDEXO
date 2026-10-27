/**
 * NavRoute.json and Status.json, the game's side files beside the journals: the live route into the store (and a new
 * one into the NavRoute star finder's log), the fuel after a replay, and one read of both per batch of live lines.
 * Moved out of edexoBootstrap.ts (2026-10-27, size cap); unchanged.
 */
import path from "node:path";
import { readFileSync, statSync } from "node:fs";
import type { GameStateStore } from "./gameState.js";
import { parseNavRouteJson } from "./navRouteFuel.js";
import { parseStatusJsonFuel } from "./footTravelStatus.js";
import { recordNavRoute } from "./navRouteLog.js";

export function createJournalSideFiles({ store, getJournalDir }: { store: GameStateStore; getJournalDir: () => string }) {
  /** The live route into the store, and a new one into the NavRoute star finder's log (navRouteLog.ts). */
  function applyNavRoute(waypoints: ReturnType<typeof readLiveNavRouteWaypoints>): boolean {
    const changed = store.applyLiveNavRoute(waypoints);
    if (changed && recordNavRoute(waypoints)) store.boxelsRevision++;
    return changed;
  }
  /*
    Read on every Status tick (10 a second at the commander's 100 ms, plus every watch event), and a
    plotted route makes it a large file: re-read only when its size or mtime moved, the last parse
    standing in between (code review D6, 2026-10-14). A missing file still reads as no route.
  */
  let navRouteFileSeen: { key: string; waypoints: NonNullable<ReturnType<typeof parseNavRouteJson>> } | null =
    null;
  function readLiveNavRouteWaypoints() {
    const file = path.join(getJournalDir(), "NavRoute.json");
    try {
      const st = statSync(file);
      const key = `${file}|${st.size}|${st.mtimeMs}`;
      if (navRouteFileSeen?.key === key) return navRouteFileSeen.waypoints;
      const waypoints = parseNavRouteJson(readFileSync(file, "utf8"));
      // Only a route is kept: no route also reads as null for a file caught mid-write, and that must retry.
      navRouteFileSeen = waypoints ? { key, waypoints } : null;
      return waypoints;
    } catch {
      navRouteFileSeen = null;
      return null;
    }
  }

  /** Re-read `NavRoute.json` + `Status.json` after a full journal replay (new log file / resync). */
  function refreshLiveHudFromJournalDir(): void {
    applyNavRoute(readLiveNavRouteWaypoints());
    try {
      const raw = readFileSync(path.join(getJournalDir(), "Status.json"), "utf8");
      const fuel = parseStatusJsonFuel(raw);
      store.applyLiveShipFuel(fuel != null ? fuel.fuelMain : null, fuel != null ? fuel.fuelReserve : null);
    } catch {
      store.applyLiveShipFuel(null, null);
    }
  }

  /*
    Status.json and NavRoute.json for the live lines, read once per batch (plan 2.3, O-22 + F-8.2). A
    honk writes dozens of Scan lines in one go, they arrive in one tail chunk and are applied in one
    synchronous loop, and each line read both files from disk again. Forgotten on the next turn of the
    event loop, so the next chunk reads them fresh.
  */
  let sideFiles: { status: string | null; route: ReturnType<typeof readLiveNavRouteWaypoints> } | null = null;
  function liveSideFiles() {
    if (!sideFiles) {
      let status: string | null = null;
      try {
        status = readFileSync(path.join(getJournalDir(), "Status.json"), "utf8");
      } catch {
        status = null;
      }
      sideFiles = { status, route: readLiveNavRouteWaypoints() };
      setImmediate(() => {
        sideFiles = null;
      });
    }
    return sideFiles;
  }

  return { applyNavRoute, readLiveNavRouteWaypoints, refreshLiveHudFromJournalDir, liveSideFiles };
}
