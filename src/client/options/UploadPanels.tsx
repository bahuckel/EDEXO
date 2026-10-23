/**
 * Options: sending to Canonn and to EDDN (moved out of OptionsPanels.tsx, audit 2026-10-22).
 */
import { FoldPanel } from "../ui/Fold";
import type { AppSnapshot } from "@shared/types";
import { useState } from "react";
import { postSetting } from "./postSetting";


/**
 * Contributing discoveries back to Canonn Research.
 *
 * The privacy line is the point of this panel, not a footnote on it. Canonn's endpoint takes the
 * journal line verbatim with the commander's name attached — there is no anonymous form and no key
 * to scope it down — so the switch itself is the whole consent and it has to say so **before** it is
 * flipped, not behind the `?`. That is the one difference from the two EDSM boxes: everything else
 * folds away, and "your CMDR name is shared" does not.
 */
export function CanonnUploadPanel({ state }: { state: AppSnapshot["canonnUpload"] }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <FoldPanel
      foldKey="options-canonn"
      defaultOpen={false}
      className="options-meta-block"
      title="Send to Canonn"
      summary={state.enabled ? "on" : "off"}
      help={
        <>
          <p>
            Canonn Research is a community science archive of exobiology and other discoveries. Sending yours
            adds them to its research; nothing in this app depends on it.
          </p>
          <p>
            <strong>What is sent</strong> — organic scans, the sales that date them, codex entries, and
            whatever else Canonn is currently asking for, as the game wrote them.
          </p>
          <p>
            <strong>Only live events.</strong> Turning this on never uploads your existing journals; it starts
            from the next thing you scan.
          </p>
          <p>
            <a href="https://canonn.science/" target="_blank" rel="noreferrer noopener">
              canonn.science
            </a>
          </p>
        </>
      }
    >
      <p className="dim options-canonn-privacy">
        <strong>Your CMDR name is shared.</strong> Canonn's archive is keyed on it and there is no anonymous
        form.
      </p>

      <label className="options-toggle">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={busy}
          onChange={(ev) => {
            const enabled = ev.target.checked;
            setBusy(true);
            setMsg(null);
            void postSetting("/api/settings/canonn-upload", { enabled })
              .then((r) => {
                if (!r.ok) setMsg(r.error ?? "Could not change the setting.");
              })
              .finally(() => setBusy(false));
          }}
        />
        <span>Send my discoveries to Canonn</span>
      </label>

      {state.enabled && state.sent + state.failed > 0 ? (
        <p className="dim options-canonn-tally">
          This session: {state.sent.toLocaleString()} sent
          {state.failed > 0 ? `, ${state.failed.toLocaleString()} not accepted` : ""}.
        </p>
      ) : null}

      {msg ? <p className="warn tiny">{msg}</p> : null}
    </FoldPanel>
  );
}

/**
 * Sending live events to EDDN, the relay every other community tool listens to (owner, 2026-09-24).
 *
 * Off by default, and like Canonn the switch is the whole consent — so what leaves the machine is
 * said in the panel, not only behind the `?`. Unlike Canonn, EDDN scrambles the name before anyone
 * downstream sees it, and the panel says that too.
 */
export function EddnUploadPanel({ state }: { state: AppSnapshot["eddnUpload"] }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <FoldPanel
      foldKey="options-eddn"
      defaultOpen={false}
      className="options-meta-block"
      title="Send to EDDN"
      summary={state.enabled ? "on" : "off"}
      help={
        <>
          <p>
            EDDN is the Elite Dangerous Data Network: EDSM, Spansh, Inara and the other community tools build
            their galaxy maps from what players' apps send there. This app reports as
            &ldquo;EDEXO-Compare&rdquo;.
          </p>
          <p>
            <strong>What is sent</strong> — jumps, body scans, surface and FSS signals, organic scans (log and
            sample), codex entries, your plotted route, and the stations you dock at. Fuel, fines, reputation
            and anything else about you are removed first, as EDDN requires.
          </p>
          <p>
            <strong>Only live events.</strong> Turning this on never uploads your existing journals; it starts
            from the next thing you do in game.
          </p>
          <p>
            <a href="https://github.com/EDCD/EDDN" target="_blank" rel="noreferrer noopener">
              github.com/EDCD/EDDN
            </a>
          </p>
        </>
      }
    >
      <p className="dim options-canonn-privacy">
        <strong>Your CMDR name is sent to EDDN</strong>, which scrambles it before passing the data on — the
        tools that receive it never see it.
      </p>

      <label className="options-toggle">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={busy}
          onChange={(ev) => {
            const enabled = ev.target.checked;
            setBusy(true);
            setMsg(null);
            void postSetting("/api/settings/eddn-upload", { enabled })
              .then((r) => {
                if (!r.ok) setMsg(r.error ?? "Could not change the setting.");
              })
              .finally(() => setBusy(false));
          }}
        />
        <span>Send my live events to EDDN</span>
      </label>

      {state.enabled && state.sent + state.failed > 0 ? (
        <p className="dim options-canonn-tally">
          This session: {state.sent.toLocaleString()} sent
          {state.failed > 0 ? `, ${state.failed.toLocaleString()} not accepted` : ""}.
        </p>
      ) : null}

      {msg ? <p className="warn tiny">{msg}</p> : null}
    </FoldPanel>
  );
}
