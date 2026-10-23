/**
 * Off the route (owner, 2026-10-13: "always taking into consideration your current location"): planned again from
 * where the ship is to the stops not reached yet, with the ship as the journals know it now. One at a time; the
 * HUD says "re-plotting" meanwhile, and the new next stop goes to the clipboard.
 *
 * Moved out of edexoBootstrap.ts (audit 2026-10-22), with two fixes. A missing or unreadable neutron index returned
 * after the busy flag was set and before the try that clears it, so re-plotting never ran again until a restart,
 * even once the commander had downloaded the index: the flag is now set only once the index is in hand, and
 * everything after it sits in the try. And a re-plot that landed left the route's "re-plotting" mark on (below).
 */
import type { GameStateStore } from "./gameState.js";
import { touchGalaxyMemory } from "./galaxyMemory.js";
import type { NeutronIndex } from "./neutronIndex.js";
import { loadNeutronIndex } from "./neutronIndex.js";
import { parseLiveHops, type Here, type NeutronLive } from "./neutronLive.js";
import { applyJumponium, planNeutronRoute } from "./neutronRoute.js";
import { neutronShip } from "./neutronShip.js";
import { recipeFor } from "../shared/jumponium.js";

export interface NeutronReplanner {
  replan(): Promise<void>;
}

export function createNeutronReplanner(deps: {
  store: GameStateStore;
  neutronLive: NeutronLive;
  push: () => void;
  shipHere: () => Here;
  /** Tests stub the index and the planner; the app uses the real ones. */
  loadIndex?: () => Pick<NeutronIndex, "within" | "nameOf"> | null;
  planRoute?: typeof planNeutronRoute;
}): NeutronReplanner {
  const { store, neutronLive, push, shipHere } = deps;
  const loadIndex = deps.loadIndex ?? loadNeutronIndex;
  const planRoute = deps.planRoute ?? planNeutronRoute;
  /*
    One re-plot at a time, whatever the route does meanwhile (review 1.2.16): Stop cleared the route's own flag while
    a search still ran, so a second one could start; and one that finished after a new route was started replaced
    the new route — it lands only if the route is still the one it was asked for (its version).
  */
  let busy = false;
  const replan = async (): Promise<void> => {
    if (busy) return;
    const here = shipHere();
    const left = neutronLive.remaining();
    if (!here.pos || !left) return;
    let version = neutronLive.version();
    touchGalaxyMemory();
    let index;
    try {
      index = loadIndex();
    } catch {
      return;
    }
    if (!index) return;
    // Nothing above awaits, so a second call cannot slip in between the check and this.
    busy = true;
    try {
      const s = neutronShip(store);
      const jumpsPerTank = s.jumpsPerTank ?? 4;
      neutronLive.setReplanning(true);
      push();
      const route = await planRoute(
        index,
        [{ name: here.name ?? "Your ship", ...here.pos }, ...left.targets],
        {
          // The range the route was planned with (he may have typed one for another ship), else the journals'.
          rangeLy: left.rangeLy ?? s.rangeLy,
          boost: left.boost ?? s.boostFactor,
          jumpsPerTank,
          jumpsNow: Math.min(jumpsPerTank, Math.max(0, s.jumpsNow ?? jumpsPerTank)),
          fsdHealth: s.fsdHealth,
          wearPerBoost: s.wearPerBoost,
        },
      );
      // Planned with FSD injections: the re-plot keeps them (shared/jumponium.ts).
      const planned = left.useJumponium
        ? applyJumponium(
            route,
            left.rangeLy ?? s.rangeLy ?? 50,
            left.boost ?? s.boostFactor ?? 4,
            (t) => recipeFor(store.jumponium, t),
            store.jumponium?.raw ?? null,
          ).route
        : route;
      const hops = parseLiveHops(planned.hops);
      if (hops && neutronLive.active() && neutronLive.version() === version) {
        neutronLive.replace(hops, left.targets);
        /*
          replace() moves the version on, and the flag below was cleared only for the version asked for: after
          every re-plot that landed the HUD said "re-plotting" until the route ended, and offRoute() stayed false,
          so it never re-plotted again (audit 2026-10-22). The route it just put in is this re-plot's own.
        */
        version = neutronLive.version();
      }
    } catch (e) {
      console.warn("[edexo-compare] neutron re-plot failed:", e);
    } finally {
      busy = false;
      if (neutronLive.version() === version) neutronLive.setReplanning(false);
      touchGalaxyMemory();
      push();
    }
  };
  return { replan };
}
