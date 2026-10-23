/**
 * Options › Exobiology: where the codex-consistency alerts look, and showing dismissed ones again (owner, 2026-10-23:
 * the envelope in the app bar stays hidden until it has something to say, so its "Detect from" switches live here).
 */
import { useState } from "react";
import { FoldPanel } from "../ui/Fold";
import { EXO_ALERT_DETECT_FEEDER_LS, EXO_ALERT_DETECT_JOURNAL_LS, requestExoAlertRescan, setExoAlertSource } from "../exoAlertsStore";
import { readLsBool } from "../lsPrefs";

export function ExoAlertsSetting() {
  const [journal, setJournal] = useState(() => readLsBool(EXO_ALERT_DETECT_JOURNAL_LS, true));
  const [feeder, setFeeder] = useState(() => readLsBool(EXO_ALERT_DETECT_FEEDER_LS, true));
  const on = [journal ? "journal" : "", feeder ? "Exo-Feeder" : ""].filter(Boolean);
  return (
    <FoldPanel
      foldKey="options-exo-alerts"
      defaultOpen={false}
      className="options-meta-block"
      title="Codex consistency alerts"
      summary={on.length ? `from ${on.join(" and ")}` : "off"}
      help={
        <>
          <p>
            The envelope beside the bell shows when the species data disagrees with what was seen: a journal
            scan the codex data does not allow, or an Exo-Feeder profile that contradicts it. It stays hidden while
            there is nothing to show.
          </p>
          <p>
            <strong>Show dismissed again</strong> brings back the alerts you dismissed for the sources ticked here;
            with Exo-Feeder ticked it also reloads the species data from disk.
          </p>
        </>
      }
    >
      <label className="options-toggle">
        <input
          type="checkbox"
          checked={journal}
          onChange={(ev) => {
            setJournal(ev.target.checked);
            setExoAlertSource("journal", ev.target.checked);
          }}
        />
        <span>Check against the journal</span>
      </label>
      <label className="options-toggle">
        <input
          type="checkbox"
          checked={feeder}
          onChange={(ev) => {
            setFeeder(ev.target.checked);
            setExoAlertSource("feeder", ev.target.checked);
          }}
        />
        <span>Check against Exo-Feeder profiles</span>
      </label>
      <div className="options-oneline" style={{ marginTop: "0.6rem" }}>
        <button type="button" className="btn-top-neutral" disabled={!journal && !feeder} onClick={() => requestExoAlertRescan()}>
          Show dismissed again
        </button>
      </div>
    </FoldPanel>
  );
}
