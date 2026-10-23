/**
 * The "· 3m" beside Live: how old the last live snapshot is (moved out of HeaderBar.tsx, audit 2026-10-22).
 */
import { useEffect, useState } from "react";
import { useLastStateAt } from "../useLiveSnapshot";

export function LiveSnapshotFreshness({ connected }: { connected: boolean }) {
  /** Subscribed rather than passed down: this value changes on every push, and threading it
   * through <HeaderBar> would re-render the header each time. */
  const lastAt = useLastStateAt();
  const [, setTick] = useState(0);
  // Minutes only (owner, 2026-09-30: a seconds counter was distracting), so a slow tick will do.
  // One interval while connected, not a new one for every push (plan 2.2, Fable C6): a push re-renders
  // this anyway, and the tick reads the latest time when it fires.
  const hasLast = lastAt != null;
  useEffect(() => {
    if (!connected || !hasLast) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, [connected, hasLast]);

  if (!connected || lastAt == null) return null;

  const sec = Math.floor((Date.now() - lastAt) / 1000);
  const min = Math.floor(sec / 60);
  return (
    <span
      className="top-live-freshness"
      title={`Last live snapshot from the server: ${sec < 60 ? "under a minute" : `${min} min`} ago`}
    >
      {" "}
      · <span className="top-live-freshness__m">{min}m</span>
    </span>
  );
}
