/**
 * Options: the collection marker's thresholds (moved out of OptionsPanels.tsx, audit 2026-10-22).
 */
import { FoldPanel } from "../ui/Fold";
import type { CollectionFocusConfig } from "@shared/collectionFocus";
import { useCallback, useEffect, useState } from "react";
import { DraftNumber } from "./DraftNumber";
import { postSetting } from "./postSetting";

/**
 * The collection marker's thresholds, in Options.
 *
 * The ⌖ beside a species, and the `info gather` tag with it, come from two numbers that lived only
 * in `edexo-collection-focus.json` beside the user settings — editable with a text editor and a
 * restart, which is not a setting so much as a rumour. `⌖2` in the prediction rows is
 * `targetScans − ownScans`, so the commander could see the count and not the thing setting it.
 *
 * Two fields and a switch, deliberately: the config also carries a `dismissed` list, and a
 * per-species opt-out belongs on the species rather than in a box of ids here.
 *
 * Read from the server rather than the snapshot. It changes when somebody edits it and at no other
 * time, and the snapshot is already the largest thing on the wire.
 */
export function CollectionFocusPanel() {
  const [cfg, setCfg] = useState<CollectionFocusConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/settings/collection-focus")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j?.config) setCfg(j.config as CollectionFocusConfig);
      })
      .catch(() => {
        /* the panel simply stays empty; nothing here is load-bearing */
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Always adopt what came back: the server clamps, and the box should show what will be used. */
  const save = useCallback((patch: Partial<CollectionFocusConfig>) => {
    setBusy(true);
    setMsg(null);
    void postSetting("/api/settings/collection-focus", patch)
      .then((r) => {
        if (!r.ok) {
          setMsg(r.error ?? "Could not change the setting.");
          return;
        }
        const next = (r as unknown as { config?: CollectionFocusConfig }).config;
        if (next) setCfg(next);
      })
      .finally(() => setBusy(false));
  }, []);

  if (!cfg) return null;

  return (
    <FoldPanel
      foldKey="options-collection-focus"
      defaultOpen={false}
      className="options-meta-block"
      title="Worth-sampling marker"
      summary={cfg.enabled ? `${cfg.targetScans} scans · under ${cfg.corpusFloor} bodies` : "off"}
      help={
        <>
          <p>
            The ⌖ beside a species means the corpus is thin on it <em>and</em> you have confirmed it few times
            — so a sample there teaches the app more than its credits are worth. The number after it is how
            many of your own scans are still wanted.
          </p>
          <p>
            A <strong>Log</strong> counts, the same as a Sample or an Analyse. You do not have to finish a run
            for it to stop asking.
          </p>
        </>
      }
    >
      <label className="options-toggle">
        <input
          type="checkbox"
          checked={cfg.enabled}
          disabled={busy}
          onChange={(ev) => save({ enabled: ev.target.checked })}
        />
        <span>Mark species worth sampling</span>
      </label>

      {cfg.enabled ? (
        <div className="options-focus-grid">
          <label htmlFor="focus-target">Stop asking after</label>
          <span>
            {/* Saved on Enter or leaving the field (1.2.19 review: per keystroke, "250" was saved as "2" and the field
                locked mid-typing). */}
            <DraftNumber
              id="focus-target"
              min={1}
              max={20}
              value={cfg.targetScans}
              disabled={busy}
              onCommit={(targetScans) => save({ targetScans })}
            />{" "}
            <span className="dim">of your own scans</span>
          </span>

          <label htmlFor="focus-floor">Corpus counts as thin under</label>
          <span>
            <DraftNumber
              id="focus-floor"
              min={0}
              max={5000}
              value={cfg.corpusFloor}
              disabled={busy}
              onCommit={(corpusFloor) => save({ corpusFloor })}
            />{" "}
            <span className="dim">bodies</span>
          </span>
        </div>
      ) : null}

      {cfg.dismissed.length > 0 ? (
        <p className="dim options-focus-dismissed">
          {cfg.dismissed.length} species dismissed by hand in <code>edexo-collection-focus.json</code>.
        </p>
      ) : null}

      {msg ? <p className="options-error">{msg}</p> : null}
    </FoldPanel>
  );
}
