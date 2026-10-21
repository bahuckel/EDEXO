import { colonizeApi } from "../api";
import { useCallback, useEffect, useRef, useState, startTransition } from "react";
import type { ColonizeSnapshot } from "../../../shared/colonize/types";
import { stabilizeSnapshot } from "./snapshotStability";

function snapSig(s: ColonizeSnapshot): string {
  return JSON.stringify({
    ad: s.activeDepots.map((d) => `${d.marketId}:${d.lastTimestamp ?? ""}:${d.progress ?? ""}`),
    ld: s.liveDocked?.marketId ?? null,
    lds: s.liveDocked?.stationName ?? null,
    lss: s.liveDocked?.starSystem ?? null,
    nav: s.navContext.starSystem,
    ct: s.shipCargoTimestamp,
    sc: s.shipCargo.map((c) => `${c.name}:${c.count}`).sort().join(","),
    cap: s.shipCargoCapacity,
    jsh: s.journalShopHistory.map((e) => `${e.marketId}:${e.visitedAt}`).join("|"),
  });
}

/** Journal snapshot subscription with debounced live updates. */
export function useColonizeSnapshot(api: typeof colonizeApi) {
  const [snap, setSnap] = useState<ColonizeSnapshot | null>(null);

  const refresh = useCallback(async () => {
    if (!api) return;
    const next = await api.getSnapshot();
    setSnap((prev) => stabilizeSnapshot(prev, next));
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const lastSnapSigRef = useRef("");
  useEffect(() => {
    if (!api) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: ColonizeSnapshot | null = null;
    const flush = () => {
      timer = null;
      if (!pending) return;
      lastSnapSigRef.current = snapSig(pending);
      const next = pending;
      pending = null;
      startTransition(() => setSnap((prev) => stabilizeSnapshot(prev, next)));
    };
    const unsubscribe = api.onUpdate((next) => {
      const s = snapSig(next);
      if (s === lastSnapSigRef.current) return;
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
