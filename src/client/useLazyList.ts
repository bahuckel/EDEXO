/*
  A list the socket leaves out (server/wsChannels.ts APP_LAZY), fetched while a screen shows it: once when it opens,
  again when the state's stamp for it (`lazyVersions`) moves, and not again on a later open while the stamp stands.
*/
import { useEffect, useState } from "react";
import { jsonOrNull } from "./http";

export function useLazyList<T>(url: string, field: string, version: string | undefined, active: boolean): T[] | null {
  const [got, setGot] = useState<{ url: string; version: string | undefined; items: T[] } | null>(null);
  const fresh = got !== null && got.url === url && got.version === version;
  useEffect(() => {
    if (!active || fresh) return;
    let live = true;
    void fetch(url, { cache: "no-store" })
      .then(jsonOrNull<Record<string, unknown>>)
      .then((j) => {
        const items = j?.[field];
        if (live && Array.isArray(items)) setGot({ url, version, items: items as T[] });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [url, field, version, active, fresh]);
  return got?.url === url ? got.items : null;
}
