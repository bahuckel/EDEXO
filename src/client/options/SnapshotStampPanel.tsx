/**
 * Options: what a panel snapshot stamps (moved out of OptionsPanels.tsx, audit 2026-10-22).
 */
import { FoldPanel } from "../ui/Fold";
import type { AppSnapshot } from "@shared/types";
import { useState } from "react";
import { postSetting } from "./postSetting";

/**
 * What a panel snapshot stamps beside the EDEXO mark (owner, 2026-09-26): all off by default; the
 * EDEXO stamp itself has no option. The camera sits on Exo-signals, Candidate species and the map.
 */
export function SnapshotStampPanel({ prefs }: { prefs: AppSnapshot["photoStamp"] | undefined }) {
  const p = prefs ?? { commander: false, system: false, timestamp: false };
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const rows: { key: keyof typeof p; label: string }[] = [
    { key: "commander", label: "Commander name" },
    { key: "system", label: "System name" },
    { key: "timestamp", label: "Date and time (UTC)" },
  ];
  const on = rows.filter((r) => p[r.key]).map((r) => r.label.toLowerCase());
  return (
    <FoldPanel
      foldKey="options-snapshot-stamp"
      defaultOpen={false}
      className="options-meta-block"
      title="Snapshot images"
      summary={on.length ? `EDEXO + ${on.join(", ")}` : "EDEXO stamp only"}
      help={
        <p>
          The camera on <strong>Exo-signals</strong>, <strong>Candidate species</strong> and the{" "}
          <strong>system map</strong> copies that panel as an image with the EDEXO stamp under it;
          Shift+click saves a PNG instead. These add lines beside the stamp.
        </p>
      }
    >
      {rows.map((r) => (
        <label key={r.key} className="options-toggle">
          <input
            type="checkbox"
            checked={p[r.key]}
            disabled={busy}
            onChange={(ev) => {
              const value = ev.target.checked;
              setBusy(true);
              setMsg(null);
              void postSetting("/api/settings/photo-stamp", { [r.key]: value })
                .then((res) => {
                  if (!res.ok) setMsg(res.error ?? "Could not change the setting.");
                })
                .finally(() => setBusy(false));
            }}
          />
          <span>{r.label}</span>
        </label>
      ))}
      {msg ? <p className="warn tiny">{msg}</p> : null}
    </FoldPanel>
  );
}
