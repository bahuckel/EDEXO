/*
  The galaxy map's own-systems routes: his systems, the game's visited list, one system's detail, the session route
  (split out of edexoBootstrap.ts, plan 2026-11-10 Phase 7.1).
*/
import type { GameStateStore } from "./gameState.js";
import type { HttpServerOptions } from "./httpServerTypes.js";
import type { SessionLog } from "./sessionLog.js";
import { backlogMap, firstDiscoveryBacklogNow } from "./firstDiscoveryBacklog.js";
import { loadBioIndex, peekBioIndex } from "./bioIndex.js";
import { importedSystems, loadVisitedImport } from "./visitedCache.js";
import { mySystemDetail, mySystemsDto, sessionRouteDto, visitedSystemsDto } from "./galaxyMine.js";

type MySystemsKeys = "getMySystems" | "getImportedSystems" | "getMySystem" | "getSessionRoute" | "getVisitedSystems";

export function mySystemsOptions({
  store,
  sessionLog,
}: {
  store: GameStateStore;
  sessionLog: SessionLog;
}): Pick<HttpServerOptions, MySystemsKeys> {
  // The game's own visited list (plan 6.1): placed by the galaxy index only if it is already loaded.
  const imported = () =>
    importedSystems(
      loadVisitedImport(),
      new Set([...store.visitedSystems.keys(), ...store.systemPositions.keys()]),
      peekBioIndex(),
    );
  return {
    // The last finished backlog, never a wait: the map asks for these at start (firstDiscoveryBacklog.ts).
    getMySystems: () => mySystemsDto(store, backlogMap(store, firstDiscoveryBacklogNow(store)), imported()),
    getImportedSystems: imported,
    getMySystem: (addr) =>
      mySystemDetail(store, addr, backlogMap(store, firstDiscoveryBacklogNow(store)), loadBioIndex()),
    getSessionRoute: () => sessionRouteDto(store, sessionLog.toDto().systems),
    getVisitedSystems: (days) => visitedSystemsDto(store, days),
  };
}
