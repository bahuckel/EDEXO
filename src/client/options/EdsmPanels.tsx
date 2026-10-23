/**
 * Options: fetching from EDSM and sending to it (moved out of OptionsPanels.tsx, audit 2026-10-22).
 */
import { FoldPanel } from "../ui/Fold";
import { Select } from "../ui/Select";
import type { AppSnapshot } from "@shared/types";
import { useState } from "react";
import { postSetting } from "./postSetting";

/**
 * Fetching from EDSM, in Options.
 *
 * The half that reads: system names go out, somebody else's scans come back. It holds the API key
 * because the key is the account, and the account is what both halves use — but the switch here buys
 * only the lookups. Sending is its own box below, with its own switch.
 *
 * Same shape as that one: three controls and one line, everything else behind the `?`. What stays
 * visible is what leaves the machine, because that is the part nobody should have to go looking for.
 */
export function EdsmFetchPanel({ state }: { state: AppSnapshot["edsmAutoFetch"] }) {
  const [commanderName, setCommanderName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  return (
    <FoldPanel
      foldKey="options-edsm-fetch"
      defaultOpen={false}
      className="options-meta-block"
      title="Fetch from EDSM"
      summary={state.hasKey ? (state.enabled ? "on" : "key stored") : "no key"}
      help={
        <>
          <p>
            When you jump into a system this app has no scans for, it looks the system up on EDSM while you
            travel, so it can be triaged before you arrive.
          </p>
          <p>
            <strong>What is sent</strong> — the name of every system you enter, with your commander name and
            key. Nothing else. Off until you turn it on.
          </p>
          <p>
            <strong>The key</strong> lives on this machine in its own file beside your settings, never in the
            settings file and never in the repository. The app only ever shows its last four characters back
            to you. <strong>Forget key</strong> deletes it and switches both EDSM features off.
          </p>
          <p>
            Get a key from{" "}
            <a href="https://www.edsm.net/en/settings/api" target="_blank" rel="noreferrer noopener">
              edsm.net/en/settings/api
            </a>
            .
          </p>
        </>
      }
    >
      <p className="dim options-edsm-privacy">Sends the name of each system you enter to edsm.net.</p>

      <div className="options-field-rows">
        <label htmlFor="edsm-cmdr">Commander</label>
        <input
          id="edsm-cmdr"
          type="text"
          autoComplete="off"
          value={commanderName}
          placeholder={state.commanderName ?? "CMDR name on EDSM"}
          onChange={(ev) => setCommanderName(ev.target.value)}
        />
        <label htmlFor="edsm-key">API key</label>
        <input
          id="edsm-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          placeholder={state.hasKey ? "•••• stored" : "from edsm.net/en/settings/api"}
          onChange={(ev) => setApiKey(ev.target.value)}
        />
      </div>

      <div className="options-edsm-actions">
        <button
          type="button"
          className="btn secondary"
          disabled={busy || !commanderName.trim() || !apiKey.trim()}
          onClick={() => {
            setBusy(true);
            setMsg(null);
            void postSetting("/api/settings/edsm-credentials", { commanderName, apiKey })
              .then((r) => {
                setMsg(
                  r.ok
                    ? { kind: "ok", text: "Key stored on this machine." }
                    : { kind: "err", text: r.error ?? "Could not store the key." },
                );
                // Never keep the secret in component state once the server has it.
                if (r.ok) setApiKey("");
              })
              .finally(() => setBusy(false));
          }}
        >
          Save key
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={busy || !state.hasKey}
          onClick={() => {
            setBusy(true);
            setMsg(null);
            void postSetting("/api/settings/edsm-credentials", null, "DELETE")
              .then((r) => {
                if (!r.ok) {
                  setMsg({ kind: "err", text: r.error ?? "The key could not be deleted." });
                  return;
                }
                setApiKey("");
                setMsg({ kind: "ok", text: "Key deleted." });
              })
              .finally(() => setBusy(false));
          }}
        >
          Forget key
        </button>
      </div>

      {state.hasKey ? (
        <p className="options-edsm-stored dim">
          <strong>{state.commanderName}</strong> · key ending <code>{state.keyHint}</code>
        </p>
      ) : null}

      <label className="options-edsm-toggle">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={busy || !state.hasKey}
          onChange={(ev) => {
            const enabled = ev.target.checked;
            setBusy(true);
            setMsg(null);
            void postSetting("/api/settings/edsm-auto-fetch", { enabled })
              .then((r) => {
                if (!r.ok) setMsg({ kind: "err", text: r.error ?? "Could not change the setting." });
              })
              .finally(() => setBusy(false));
          }}
        />
        <span>Look up systems when I jump{state.hasKey ? "" : " (store your key first)"}</span>
      </label>

      {msg ? <p className={msg.kind === "ok" ? "msg ok" : "msg err"}>{msg.text}</p> : null}
    </FoldPanel>
  );
}

/**
 * Contributing the journal to EDSM, in Options.
 *
 * Three controls and one line of prose. The first draft explained the protocol, the privacy position
 * and the catch-up's resume behaviour in four paragraphs above the switch, which is a wall of text
 * in a settings menu — the owner's note: *"no one wants to be greeted by a wall of text in their
 * options menu"*. All of it moved behind the `?`, which is the drawer `FoldPanel` already provides
 * (WEBUI-REDESIGN 5.3) and which the commander opens only if they care.
 *
 * The one sentence that stays visible is the one a commander must not have to ask for: that this
 * sends the journal itself, not just system names. Consent is not a footnote.
 */
export function EdsmUploadPanel({ state, hasKey }: { state: AppSnapshot["edsmUpload"]; hasKey: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  /** A week, not everything: a four-year run should be chosen, not the default. */
  const [scope, setScope] = useState<"day" | "week" | "month" | "year" | "all">("week");
  const progress = state.progress;
  const running = progress?.running === true;

  const flip = (path: string, enabled: boolean) => {
    setBusy(true);
    setMsg(null);
    void postSetting(path, { enabled })
      .then((r) => {
        if (!r.ok) setMsg({ kind: "err", text: r.error ?? "Could not change the setting." });
      })
      .finally(() => setBusy(false));
  };

  return (
    <FoldPanel
      foldKey="options-edsm-upload"
      defaultOpen={false}
      className="options-meta-block"
      title="Send to EDSM"
      summary={state.enabled ? (state.live ? "on, live" : "on") : "off"}
      help={
        <>
          <p>
            The same thing EDMarketConnector and EDDiscovery do: your discoveries appear on your EDSM
            commander profile. Uses the key from <em>Fetch from EDSM</em> above.
          </p>
          <p>
            <strong>What is sent</strong> — the game's own journal lines: where you jumped, what you scanned,
            when. EDSM publishes a list of event types it does not want and those are skipped. Fetching above
            sends only system names; this is much more.
          </p>
          <p>
            <strong>Catch up</strong> reads your journals oldest first and sends whatever EDSM has not been
            given, as far back as you choose. It remembers how far it got, so stopping is safe and running it
            again resumes. A short run does not stop a longer one later.
          </p>
          <p>
            <strong>Keep sending</strong> repeats that every few minutes while you play, reaching back a week
            so a few days with the app closed heal themselves. Gaps older than that are what the button is
            for.
          </p>
          <p>
            If EDMarketConnector is also running, you will both be uploading. EDSM ignores what it already
            has, so it is redundant rather than harmful.
          </p>
        </>
      }
    >
      <p className="dim options-edsm-privacy">Sends your journal — jumps, scans, times — to edsm.net.</p>

      <label className="options-edsm-toggle">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={busy || !hasKey || running}
          onChange={(ev) => flip("/api/settings/edsm-upload", ev.target.checked)}
        />
        <span>Send my journal to EDSM{hasKey ? "" : " (store your API key first)"}</span>
      </label>

      <label className="options-edsm-toggle">
        <input
          type="checkbox"
          checked={state.live}
          disabled={busy || !state.enabled}
          onChange={(ev) => flip("/api/settings/edsm-live-upload", ev.target.checked)}
        />
        <span>Keep sending as I play</span>
      </label>

      <div className="options-edsm-actions">
        <Select
          ariaLabel="How far back to upload"
          className="options-inline-select"
          value={scope}
          disabled={busy || !state.enabled || running}
          options={[
            { value: "day", label: "last day" },
            { value: "week", label: "last week" },
            { value: "month", label: "last month" },
            { value: "year", label: "last year" },
            { value: "all", label: "everything" },
          ]}
          onChange={(v) => setScope(v as typeof scope)}
        />
        <button
          type="button"
          className="btn secondary"
          disabled={busy || !state.enabled || running}
          onClick={() => {
            setBusy(true);
            setMsg(null);
            void postSetting("/api/settings/edsm-catch-up", { scope })
              .then((r) => {
                if (!r.ok) setMsg({ kind: "err", text: r.error ?? "Could not start." });
              })
              .finally(() => setBusy(false));
          }}
        >
          {running ? "Catching up…" : "Catch up"}
        </button>
        {running ? (
          <button
            type="button"
            className="btn secondary"
            onClick={() => void postSetting("/api/settings/edsm-catch-up-cancel", {})}
          >
            Stop
          </button>
        ) : null}
      </div>

      {running && progress ? (
        <p className="options-edsm-stored dim">
          {progress.filesDone} / {progress.filesTotal} journals · {progress.eventsSent.toLocaleString()} sent
        </p>
      ) : state.ledger.eventsAccepted > 0 ? (
        <p className="options-edsm-stored dim">
          {state.ledger.eventsAccepted.toLocaleString()} events sent
          {state.ledger.lastRunAt ? `, last ${new Date(state.ledger.lastRunAt).toLocaleDateString()}` : ""}
        </p>
      ) : null}

      {progress?.error ? (
        <p className="msg err">
          {progress.error}
          {progress.fatal ? " — check the commander name and key above." : ""}
        </p>
      ) : null}

      {msg ? <p className={msg.kind === "ok" ? "msg ok" : "msg err"}>{msg.text}</p> : null}
    </FoldPanel>
  );
}
