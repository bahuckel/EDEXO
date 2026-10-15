/*
  What the HUD's React tree reads: the last snapshot, and three counters that say "draw again" without a new one —
  a radar frame (merged into the snapshot in place, read only by the tracker), the one-second tick (clocks, the
  "only when relevant" hold, notices leaving) and a settings change. Each part subscribes to what it needs, so a
  radar frame ten times a second re-renders the tracker and nothing else (exoLiveRadarFrame.test.ts).
*/
import { useSyncExternalStore } from "react";
import type { HudSnapshot } from "./types";

let snapshot: HudSnapshot | null = null;
let liveRev = 0;
let tickRev = 0;
let prefsRev = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export const hudStore = {
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  snapshot: () => snapshot,
  setSnapshot(d: HudSnapshot): void {
    snapshot = d;
    emit();
  },
  bumpLive(): void {
    liveRev++;
    emit();
  },
  bumpTick(): void {
    tickRev++;
    emit();
  },
  bumpPrefs(): void {
    prefsRev++;
    emit();
  },
};

export const useSnapshot = () => useSyncExternalStore(hudStore.subscribe, () => snapshot);
export const useLiveRev = () => useSyncExternalStore(hudStore.subscribe, () => liveRev);
export const useTickRev = () => useSyncExternalStore(hudStore.subscribe, () => tickRev);
export const usePrefsRev = () => useSyncExternalStore(hudStore.subscribe, () => prefsRev);
