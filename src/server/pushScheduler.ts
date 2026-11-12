/*
  The snapshot push's coalescing (split out of edexoBootstrap.ts, plan 2026-11-10 Phase 7.1): journal-driven pushes
  fire at once when idle, then at most one per window while events stream in.
*/

/** At 100 ms a single FSS sweep produced ten full snapshot builds per second. */
export const PUSH_WINDOW_MS = 250;

export type PushScheduler = {
  /** A push soon: now when the last one is a window old, else once at the window's end. */
  push: () => void;
  /** A push now, dropping the one waiting. */
  pushFlush: () => void;
};

export function createPushScheduler(
  broadcast: () => void,
  windowMs = PUSH_WINDOW_MS,
  now: () => number = Date.now,
): PushScheduler {
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPushAt = 0;
  const pushFlush = () => {
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    lastPushAt = now();
    broadcast();
  };
  const push = () => {
    if (pushTimer) return;
    const sinceLast = now() - lastPushAt;
    if (sinceLast >= windowMs) {
      pushFlush();
      return;
    }
    pushTimer = setTimeout(() => {
      pushTimer = null;
      lastPushAt = now();
      broadcast();
    }, windowMs - sinceLast);
  };
  return { push, pushFlush };
}
