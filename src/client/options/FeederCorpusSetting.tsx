/**
 * Options: where the feeder corpus lives (moved out of OptionsPanels.tsx, audit 2026-10-22).
 */
import { useFeederStatus } from "../FeederStatusPanel";
import { useToast } from "../ui/feedback";
import { useCallback, useEffect, useState } from "react";

/**
 * Where the feeder corpus lives — the only setting that has to exist while the feeder is *hidden*.
 *
 * The toolbar entry is gated on `feeder.available`, and `available` is false whenever the corpus
 * cannot be found. Both built-in search paths are relative to `PROJECT_ROOT`, which in a packaged
 * build is the install directory, so an owner whose corpus sits beside the repository could never
 * reach the feeder at all — and could not reach a setting inside it either. So it lives in Options,
 * which is always open to them, and it names every path that was tried rather than only reporting
 * failure.
 */
export function FeederCorpusSetting() {
  const { status, refresh } = useFeederStatus();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status) setDraft(status.configuredCorpusDir ?? "");
  }, [status]);

  const save = useCallback(
    async (value: string | null) => {
      setBusy(true);
      try {
        const r = await fetch("/api/settings/feeder-data-directory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feederDataDir: value }),
        });
        const j = (await r.json().catch(() => null)) as { error?: string } | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
        toast.success(value ? "Corpus folder saved — reopen the app to load it." : "Corpus folder cleared.");
        // The panel's own status follows the change (1.2.19 review: Clear stayed disabled, "Found at" stale).
        refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save the corpus folder.");
      } finally {
        setBusy(false);
      }
    },
    [toast, refresh],
  );

  if (!status) return null;

  return (
    <section className="options-block">
      <h4 className="options-block-title">Data feeder corpus</h4>
      <p className="options-journal-line dim">
        {status.available ? (
          <>
            Found at <code>{status.corpusDir}</code>
          </>
        ) : (
          "No corpus found — the feeder toolbar entry stays hidden until one is set."
        )}
      </p>
      <div className="options-row">
        <input
          type="text"
          className="options-text-input"
          value={draft}
          spellCheck={false}
          placeholder="Full path to the feeder data folder"
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Feeder corpus folder"
        />
        <button type="button" disabled={busy || !draft.trim()} onClick={() => void save(draft.trim())}>
          Save
        </button>
        <button
          type="button"
          disabled={busy || !status.configuredCorpusDir}
          onClick={() => {
            setDraft("");
            void save(null);
          }}
        >
          Clear
        </button>
      </div>
      {!status.available && status.searchedDirs.length > 0 ? (
        <details className="options-journal-line dim">
          <summary>Where it looked</summary>
          <ul className="options-path-list">
            {status.searchedDirs.map((d) => (
              <li key={d}>
                <code>{d}</code>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
