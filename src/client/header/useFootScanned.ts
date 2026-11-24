/*
  The on-foot scans for the Encyclopedia and My exobiology. The sockets leave them out (discuss item 22, 1.3.1, for
  the Colonize window; Compare's too since UI ideas 2026-11-16 §4.7: 501 KB on the owner's profile, in every first
  frame, for screens seldom open), so they are asked for when one of those screens opens, and again while it is open
  when a scan changes them (`lazyVersions`).
*/
import type { AppSnapshot, FootScannedEntry } from "@shared/types";
import { useLazyList } from "../useLazyList";

const NONE: FootScannedEntry[] = [];

export function useFootScanned(
  snap: Pick<AppSnapshot, "footScannedEntries" | "lazyVersions">,
  open: boolean,
): FootScannedEntry[] {
  const fromState = snap.footScannedEntries;
  const fetched = useLazyList<FootScannedEntry>(
    "/api/foot-scanned",
    "entries",
    snap.lazyVersions?.footScannedEntries,
    open && fromState === undefined,
  );
  return fromState ?? fetched ?? NONE;
}
