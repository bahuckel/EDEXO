/**
 * The browser's optional master password over its saved logins (owner, 2026-10-17, 1.2.19; electron/browserPasswords.cjs):
 * the settings rows (set, unlock, lock, change, remove) and the key button's unlock while it is locked. The typed
 * password goes to the main process to derive the key and is not kept on this side.
 *
 * Its forms sit in the browser toolbar, whose address bar is a form of its own (BrowserScreen.tsx): when the whole
 * toolbar was one form, Set submitted the address bar too and nothing was saved (owner's test, 2026-10-17).
 */
import { useState, type FormEvent } from "react";
import { IconKey } from "./ui/icons";
import type { BrowserBridge, BrowserState, WithState } from "./BrowserScreen";

type MasterApi = Pick<BrowserBridge, "masterUnlock" | "masterLock" | "masterSet" | "masterRemove">;

/** The settings rows, under "Remember passwords". `after` takes each call's result (it carries the new state). */
export function MasterPasswordSettings({
  master,
  savedCount,
  api,
  after,
}: {
  master: BrowserState["passwords"]["master"];
  savedCount: number;
  api: MasterApi;
  after: (r: WithState) => void;
}) {
  const [mode, setMode] = useState<"idle" | "set" | "change" | "remove">("idle");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const reset = () => {
    setMode("idle");
    setCurrent("");
    setNext("");
    setAgain("");
  };
  const done = (r: WithState) => {
    after(r);
    setNote(r.error ?? null);
    if (!r.error) reset();
  };
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (mode === "remove") {
      void api.masterRemove(current).then(done);
      return;
    }
    if (next !== again) {
      setNote("The two new passwords differ.");
      return;
    }
    void api.masterSet(next, mode === "change" ? current : undefined).then(done);
  };
  const unlock = (ev: FormEvent) => {
    ev.preventDefault();
    void api.masterUnlock(current).then((r) => {
      after(r);
      setNote(r.error ?? null);
      if (!r.error) setCurrent("");
    });
  };

  return (
    <div className="ebr-menu__master">
      {!master.set && mode === "idle" ? (
        <div className="ebr-menu__form">
          <button type="button" className="btn-top-neutral" onClick={() => setMode("set")}>
            Set a master password
          </button>
        </div>
      ) : null}
      {master.set && !master.unlocked && mode === "idle" ? (
        <form className="ebr-menu__form" onSubmit={unlock}>
          <span className="ebr-menu__help">
            Locked: {savedCount} saved login{savedCount === 1 ? "" : "s"} cannot be read until you unlock them.
          </span>
          <input
            type="password"
            autoComplete="current-password"
            aria-label="Master password"
            placeholder="Master password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <button type="submit" className="btn-confirm-go">
            Unlock
          </button>
          <button type="button" className="btn-top-neutral" onClick={() => setMode("remove")}>
            Remove…
          </button>
        </form>
      ) : null}
      {master.set && master.unlocked && mode === "idle" ? (
        <div className="ebr-menu__form">
          <span className="ebr-menu__help">Unlocked until the app closes.</span>
          <button type="button" className="btn-top-neutral" onClick={() => void api.masterLock().then(done)}>
            Lock now
          </button>
          <button type="button" className="btn-top-neutral" onClick={() => setMode("change")}>
            Change…
          </button>
          <button type="button" className="btn-top-neutral" onClick={() => setMode("remove")}>
            Remove…
          </button>
        </div>
      ) : null}
      {mode !== "idle" ? (
        <form className="ebr-menu__form" onSubmit={submit}>
          {mode === "change" || mode === "remove" ? (
            <input
              type="password"
              autoComplete="current-password"
              aria-label="Current master password"
              placeholder="Current master password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          ) : null}
          {mode !== "remove" ? (
            <>
              <input
                type="password"
                autoComplete="new-password"
                aria-label="New master password"
                placeholder="New master password (6 characters or more)"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
              <input
                type="password"
                autoComplete="new-password"
                aria-label="New master password again"
                placeholder="Again"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
              />
            </>
          ) : (
            <span className="ebr-menu__help">The saved logins stay, protected by the operating system only.</span>
          )}
          <button type="submit" className="btn-confirm-go">
            {mode === "remove" ? "Remove" : mode === "change" ? "Change" : "Set"}
          </button>
          <button
            type="button"
            className="btn-top-neutral"
            onClick={() => {
              reset();
              setNote(null);
            }}
          >
            Cancel
          </button>
        </form>
      ) : null}
      {note ? (
        <span className="ebr-menu__help ebr-menu__error" role="alert">
          {note}
        </span>
      ) : null}
    </div>
  );
}

/** The key button while the master password locks this site's saved logins: unlock right here. */
export function UnlockLoginsChip({ count, unlock }: { count: number; unlock: (password: string) => Promise<{ error?: string }> }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    void unlock(value).then((r) => {
      setNote(r.error ?? null);
      if (!r.error) {
        setValue("");
        setOpen(false);
      }
    });
  };
  return (
    <div className="ebr-more">
      <button
        type="button"
        className="ebr-chip"
        aria-expanded={open}
        title={`${count} saved login${count === 1 ? "" : "s"} for this site, locked by the master password`}
        onClick={() => setOpen(!open)}
      >
        <IconKey className="ebr-key-icon" /> Unlock logins
      </button>
      {open ? (
        <div className="ebr-menu" role="menu">
          <form className="ebr-menu__form" onSubmit={submit}>
            <input
              type="password"
              autoComplete="current-password"
              aria-label="Master password"
              placeholder="Master password"
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
            />
            <button type="submit" className="btn-confirm-go">
              Unlock
            </button>
          </form>
          {note ? (
            <span className="ebr-menu__help ebr-menu__error" role="alert">
              {note}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
