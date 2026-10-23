import type { colonizeApi } from "../api";
import { useCallback, useEffect, useRef, useState, startTransition } from "react";
import type { ColonizeSnapshot } from "../../../shared/colonize/types";
import { colonizeWindowSnapSig, stabilizeSnapshot } from "./snapshotStability";

/**
 * A failed first load is asked again after these waits, the last one repeating (audit 2026-10-22): the server pushes
 * only when something changes, so an idle commander kept looking at "Nothing to haul yet" with sites on the server.
 */
const RETRY_MS = [2_000, 5_000, 10_000];

/** Journal snapshot subscription with debounced live updates. */
export function useColonizeSnapshot(api: typeof colonizeApi) {
  const [snap, setSnap] = useState<ColonizeSnapshot | null>(null);
  /** A snapshot arrived (asked for or pushed): the first-load retry can stop. */
  const haveRef = useRef(false);

  /** The server's snapshot now; false when it could not be asked (nothing thrown). */
  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const next = await api.getSnapshot();
      haveRef.current = true;
      setSnap((prev) => stabilizeSnapshot(prev, next));
      return true;
    } catch {
      return false;
    }
  }, [api]);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const load = () => {
      timer = null;
      void refresh().then((ok) => {
        if (ok || !live || haveRef.current) return;
        timer = setTimeout(load, RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
      });
    };
    load();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: ColonizeSnapshot | null = null;
    /**
     * The newest push taken in, applied or still waiting out the debounce. Compared with the last one *applied*, a
     * push that went A, B, back to A inside the debounce was dropped as "unchanged" while B stayed queued, and B was
     * then shown (audit 2026-10-22).
     */
    let lastSig = "";
    const flush = () => {
      timer = null;
      if (!pending) return;
      const next = pending;
      pending = null;
      haveRef.current = true;
      startTransition(() => setSnap((prev) => stabilizeSnapshot(prev, next)));
    };
    const unsubscribe = api.onUpdate((next) => {
      const s = colonizeWindowSnapSig(next);
      if (s === lastSig) return;
      lastSig = s;
      pending = next;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 800);
    });
    return () => {
      unsubscribe();
      // A queued flush would call setSnap after unmount, so drop the debounce timer with the listener.
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    };
  }, [api]);

  return { snap, setSnap, refresh };
}
