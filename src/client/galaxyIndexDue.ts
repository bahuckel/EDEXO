/**
 * A newer galaxy index (the codex data) on the release, for the buttons that lead to its download (owner,
 * 2026-11-01: "when a new CODEX download is available, make it so the users get a flashing button for the codex
 * update (both in top menu and the option itself)"): the main window's Galaxy map entry, the map's View tab and the
 * Galaxy index row under it. Due = the index is here and the release holds a newer one, or the stations, neutron
 * stars or jumponium bodies that come with it are missing or older — the row's Update / Download button then.
 *
 * One request for every button in a window, at start and every 30 minutes while the window is shown; the server
 * asks the release at most every hour (galaxyRoutes.ts). An index never downloaded is not "due" here: the map
 * offers that download itself.
 */
import { useSyncExternalStore } from "react";

const POLL_MS = 30 * 60_000;
let due = false;
let started = false;
const listeners = new Set<() => void>();

async function check(): Promise<void> {
  try {
    const r = await fetch("/api/galaxy/index");
    if (!r.ok) return;
    const st = (await r.json()) as { present?: boolean; updateAvailable?: boolean | null; extrasMissing?: number };
    const next = st.present === true && (st.updateAvailable === true || (st.extrasMissing ?? 0) > 0);
    if (next !== due) {
      due = next;
      for (const l of listeners) l();
    }
  } catch {
    /* the next check */
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (!started) {
    started = true;
    void check();
    window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, POLL_MS);
  }
  return () => listeners.delete(l);
}

/** True while a newer galaxy index (or its companion files) waits on the release. */
export function useGalaxyIndexDue(): boolean {
  return useSyncExternalStore(subscribe, () => due, () => false);
}

/** The class that makes a button pulse while the update waits. */
export const DUE_CLASS = "is-update-due";
