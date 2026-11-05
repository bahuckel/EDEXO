/**
 * The distance reader running while it is wanted (plan 1.3.8): the launcher's option on and the server's trigger
 * (`hudReadDistance` on the HUD socket: the Scan route tab showing, the ship in supercruise, a body of the current
 * system targeted; owner 2026-11-05: read only on triggers, never search the screen all the time). Each reading is
 * posted to this PC's server, which puts the ship on the Scan route between the last body and the target. Stops
 * shortly after it is no longer wanted, so a moment without the trigger does not restart the capture.
 */
import { useEffect, useRef } from "react";
import type { TargetDistance } from "@shared/hudTargetDistance";
import { startDistanceCapture, type DistanceCapture } from "./distanceCapture";

/** How long the capture outlives its trigger (a push between two states, a tab switched for a moment). */
const LINGER_MS = 2000;

/**
 * A reading posted when it agrees with the one before (within half to twice it): a misread digit's jump is held one
 * frame, a real change carries on. The first reading after a pause is posted as read.
 */
export function steadyDistance(prev: { distLs: number; atMs: number } | null, next: TargetDistance, nowMs: number): boolean {
  if (!prev || nowMs - prev.atMs > 5000) return true;
  const k = next.distLs / Math.max(1e-9, prev.distLs);
  return k >= 0.5 && k <= 2;
}

export function useDistanceReader(wanted: boolean): void {
  const cap = useRef<DistanceCapture | null>(null);
  const starting = useRef(false);
  const want = useRef(wanted);
  want.current = wanted;
  useEffect(() => {
    let last: { distLs: number; atMs: number } | null = null;
    const post = (r: TargetDistance | null) => {
      if (!r) return;
      const now = Date.now();
      const ok = steadyDistance(last, r, now);
      last = { distLs: r.distLs, atMs: now };
      if (!ok) return;
      const body = { distLs: r.distLs, text: r.text };
      void fetch("/api/hud-target-distance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    };
    if (wanted) {
      if (!cap.current && !starting.current) {
        starting.current = true;
        void startDistanceCapture(post).then((c) => {
          starting.current = false;
          if ("error" in c) return;
          // Let go while it was starting: stopped at once.
          if (want.current) cap.current = c;
          else c.stop();
        });
      }
      return;
    }
    const t = setTimeout(() => {
      cap.current?.stop();
      cap.current = null;
    }, LINGER_MS);
    return () => clearTimeout(t);
  }, [wanted]);
  useEffect(() => () => cap.current?.stop(), []);
}
