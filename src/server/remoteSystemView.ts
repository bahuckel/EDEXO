/**
 * A system the journals know nothing about, shown from Spansh (owner, 2026-09-25), and the gate both galaxy sources
 * pass before they fill a system's map. Moved out of edexoBootstrap.ts (2026-10-27, size cap); unchanged.
 */
import type { GameStateStore } from "./gameState.js";
import { fetchRemoteSystem, readRemoteSystemsCache, writeRemoteSystemToCache } from "./remoteSystems.js";

export function createRemoteSystemView({ store, push }: { store: GameStateStore; push: () => void }) {
  /**
   * Show a system the journals know nothing about, from Spansh (owner, 2026-09-25). The 30-day cache
   * answers first; a fetch is marked "loading" so the screen can say so, and a failure says why.
   * A system with any bio body or mappable scan of his own is never replaced by somebody else's data.
   */
  async function ensureRemoteSystem(systemAddress: number, starSystem: string): Promise<void> {
    if (store.hasMappableJournalExplorationForSystem(systemAddress)) return;
    if (store.remoteSystems.has(systemAddress)) return;
    if (store.remoteLookups.get(systemAddress)?.state === "loading") return;
    const cached = readRemoteSystemsCache().find((r) => r.systemAddress === systemAddress);
    if (cached) {
      store.remoteSystems.set(systemAddress, cached);
      push();
      return;
    }
    store.remoteLookups.set(systemAddress, { starSystem, state: "loading" });
    push();
    const r = await fetchRemoteSystem(systemAddress, starSystem);
    if (r.ok) {
      store.remoteSystems.set(systemAddress, r.system);
      store.remoteLookups.delete(systemAddress);
      writeRemoteSystemToCache(r.system);
    } else {
      store.remoteLookups.set(systemAddress, { starSystem, state: "error", error: r.error });
    }
    push();
  }

  /** The same two rules before either galaxy source fills a system's map. */
  function hydrateGate(systemAddress: number, source: string): { ok: false; error: string } | null {
    if (!store.isKnownJournalSystem(systemAddress)) {
      return { ok: false, error: "That system is not present in merged journal data." };
    }
    if (store.hasMappableJournalExplorationForSystem(systemAddress)) {
      return {
        ok: false,
        error: `Journal already has mappable scan data for this system — no ${source} supplement needed.`,
      };
    }
    return null;
  }

  return { ensureRemoteSystem, hydrateGate };
}
