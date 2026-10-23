/**
 * "Auto refresh every …" beside a Carriers & Stations fetch button (R4, owner 2026-10-23): carriers every 12 h,
 * stations every 24 h by default, or off. The server keeps the schedule (dataAutoRefresh.ts), so it runs whether or
 * not this screen is open; only data fetched once is refreshed.
 */
import { useEffect, useState } from "react";
import { Select } from "./ui/Select";

type Which = "carriersHours" | "stationsHours";
const HOURS = ["0", "6", "12", "24", "48"] as const;
const label = (h: string) => (h === "0" ? "Off" : `Every ${h} h`);

export function AutoRefreshPick({ which }: { which: Which }) {
  const [hours, setHours] = useState<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    void fetch("/api/data-refresh", { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Record<Which, number> | null) => {
        if (j && typeof j[which] === "number") setHours(String(j[which]));
      })
      .catch(() => undefined);
    return () => ac.abort();
  }, [which]);
  if (hours == null) return null;
  const change = (v: string) => {
    setHours(v);
    void fetch("/api/data-refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [which]: Number(v) }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Record<Which, number> | null) => {
        if (j && typeof j[which] === "number") setHours(String(j[which]));
      })
      .catch(() => undefined);
  };
  return (
    <span className="auto-refresh-pick">
      <span className="dim">Auto refresh</span>
      <Select
        value={hours}
        options={HOURS.map((h) => ({ value: h, label: label(h) }))}
        onChange={change}
        ariaLabel={which === "carriersHours" ? "Carriers auto refresh" : "Stations auto refresh"}
      />
    </span>
  );
}
