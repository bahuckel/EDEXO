/*
  The on-foot scans for the Encyclopedia and My exobiology. Compare's live state carries them; the Colonize window's
  `shell` feed leaves them out (discuss item 22, 1.3.1: 501 KB on the owner's profile, sent to a window that seldom
  shows them), so there they are asked for when one of those screens opens, and again on each later open.
*/
import { useEffect, useState } from "react";
import type { AppSnapshot, FootScannedEntry } from "@shared/types";

const NONE: FootScannedEntry[] = [];

export function useFootScanned(snap: Pick<AppSnapshot, "footScannedEntries">, open: boolean): FootScannedEntry[] {
  const fromState = snap.footScannedEntries;
  const [fetched, setFetched] = useState<FootScannedEntry[] | null>(null);
  useEffect(() => {
    if (fromState !== undefined || !open) return;
    let live = true;
    void fetch("/api/foot-scanned", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ entries?: FootScannedEntry[] }>) : null))
      .then((j) => {
        if (live && j && Array.isArray(j.entries)) setFetched(j.entries);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [fromState, open]);
  return fromState ?? fetched ?? NONE;
}
