/**
 * The distance reader running while it is wanted (plan 1.3.8): switched on in the launcher, the ship in supercruise
 * and a body of the current system targeted (asked of the server every 2 s, the Scan route's own `/api/scan-route/ship`).
 * Each reading is posted to this PC's server, which puts the ship on the Scan route between the last body and the
 * target. Stops 10 s after it is no longer wanted, so a moment without a target does not restart the capture.
 */
import { useEffect, useRef, useState } from "react";
import type { ScanRouteShipDTO } from "@shared/dto/routeSystem";
import type { TargetDistance } from "@shared/hudTargetDistance";
import { startDistanceCapture, type DistanceCapture } from "./distanceCapture";

const SHIP_POLL_MS = 2000;

/** Supercruise with a body of this system targeted: the only time the HUD shows a target's distance worth reading. */
function useTargetInSystem(on: boolean): boolean {
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    if (!on) {
      setWanted(false);
      return;
    }
    let live = true;
    const ask = () =>
      void fetch("/api/scan-route/ship")
        .then((r) => (r.ok ? (r.json() as Promise<ScanRouteShipDTO>) : null))
        .then((s) => live && setWanted(!!s && s.flight === "supercruise" && s.targetId != null))
        .catch(() => {});
    ask();
    const t = setInterval(ask, SHIP_POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [on]);
  return wanted;
}

/**
 * A reading posted when it agrees with the one before (within half to twice it): a misread digit's jump is held one
 * frame, a real change carries on. The first reading after a pause is posted as read.
 */
export function steadyDistance(prev: { distLs: number; atMs: number } | null, next: TargetDistance, nowMs: number): boolean {
  if (!prev || nowMs - prev.atMs > 5000) return true;
  const k = next.distLs / Math.max(1e-9, prev.distLs);
  return k >= 0.5 && k <= 2;
}

export function useDistanceReader(on: boolean): void {
  const wanted = useTargetInSystem(on);
  const cap = useRef<DistanceCapture | null>(null);
  const starting = useRef(false);
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
          if (!("error" in c)) cap.current = c;
        });
      }
      return;
    }
    const t = setTimeout(() => {
      cap.current?.stop();
      cap.current = null;
    }, 10_000);
    return () => clearTimeout(t);
  }, [wanted]);
  useEffect(() => () => cap.current?.stop(), []);
}
