import { useEffect, useState } from "react";

/**
 * Ticking wall clock for values derived from Date.now() during render. A component wrapped in
 * memo() only re-renders when its props change, so an age computed straight from Date.now() can
 * sit at a stale value indefinitely; reading it from this ticker forces a re-render per interval.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
