/**
 * Per-commander profiles (1.3.1, owner 2026-10-25): the app shows one commander's data at a time. When the game is
 * playing another commander, the header says so beside the commander's name with a Switch button, and a pop-up asks
 * once: Switch, or Keep this window as it is. Keep is remembered for this tab until either commander changes.
 *
 * Switching starts the server again for that commander (desktop app). This page then waits until the server answers
 * as the new commander and loads again, so nothing on screen is the other commander's.
 */
import { useState } from "react";
import type { AppSnapshot, CommanderRefDTO } from "@shared/types";
import { Dialog } from "../ui/Dialog";

const KEEP_KEY = "edexo.commanderKeep";
/** The server's journal boot can take a while on a full folder; the page reloads as soon as it answers. */
const SWITCH_WAIT_MS = 120_000;

function keepKey(active: CommanderRefDTO, game: CommanderRefDTO): string {
  return `${KEEP_KEY}:${active.fid}:${game.fid}`;
}
function kept(active: CommanderRefDTO, game: CommanderRefDTO): boolean {
  try {
    return sessionStorage.getItem(keepKey(active, game)) === "1";
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ask the app to show `target`, then wait for the server to answer as them and load the page again. */
export async function switchToCommander(target: CommanderRefDTO): Promise<string | null> {
  const r = await fetch("/api/commanders/switch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fid: target.fid }),
  }).catch(() => null);
  const j = (await r?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!r || !r.ok || !j?.ok) return j?.error ?? "The app could not switch commander.";
  const t0 = Date.now();
  while (Date.now() - t0 < SWITCH_WAIT_MS) {
    await sleep(1000);
    try {
      const c = (await (await fetch("/api/commanders", { cache: "no-store" })).json()) as { active?: CommanderRefDTO | null };
      if (c.active?.fid === target.fid) {
        location.reload();
        return null;
      }
    } catch {
      /* the server is starting again */
    }
  }
  return `The app did not come back as CMDR ${target.name}. Reload this page.`;
}

export function CommanderSwitch({ snap }: { snap: AppSnapshot }) {
  const c = snap.commanders;
  const active = c?.active ?? null;
  const game = c?.game ?? null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!active || !game || active.fid === game.fid) return null;

  const canSwitch = c?.canSwitch === true;
  const go = () => {
    setError(null);
    setBusy(`Switching to CMDR ${game.name}…`);
    void switchToCommander(game).then((err) => {
      if (err) {
        setBusy(null);
        setError(err);
      }
    });
  };
  const keep = () => {
    try {
      sessionStorage.setItem(keepKey(active, game), "1");
    } catch {
      /* the pop-up just comes back on the next load */
    }
    setDismissed(keepKey(active, game));
  };
  const showPrompt = !busy && dismissed !== keepKey(active, game) && !kept(active, game);

  return (
    <>
      <span className="appbar-cmdr-other" title={`The game is playing CMDR ${game.name}; this window shows CMDR ${active.name}.`}>
        Logged in as another commander
        {canSwitch ? (
          <button type="button" className="btn-top-neutral appbar-cmdr-switch" onClick={go} disabled={!!busy}>
            Switch
          </button>
        ) : null}
      </span>
      {showPrompt ? (
        <Dialog title="Another commander in the game" onClose={keep} className="cmdr-switch-dialog" closeTitle="Keep">
          <div className="modal-body">
            <p>
              This window shows <strong>CMDR {active.name}</strong>. The game is playing <strong>CMDR {game.name}</strong>.
            </p>
            <p className="cmdr-switch-dialog__note">
              Keep: this window stays on CMDR {active.name}, and what CMDR {game.name} does in the game is not shown here
              (no live updates, HUD included) until you switch.
              {canSwitch ? "" : ` To switch, start the server again for CMDR ${game.name}.`}
            </p>
            {error ? (
              <p className="cmdr-switch-dialog__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="cmdr-switch-dialog__actions">
              {canSwitch ? (
                <button type="button" className="btn-confirm-go" onClick={go}>
                  Switch to CMDR {game.name}
                </button>
              ) : null}
              <button type="button" className="btn-top-neutral" onClick={keep}>
                Keep CMDR {active.name}
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}
      {busy ? (
        <div className="cmdr-switching" role="status">
          {busy}
        </div>
      ) : null}
      {error && !showPrompt ? (
        <span className="appbar-cmdr-other appbar-cmdr-other--error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
