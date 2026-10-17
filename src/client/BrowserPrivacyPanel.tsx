/**
 * The browser menu's "Privacy & Security" view (owner, 2026-10-17: the menu was getting text-heavy): Keep page cache,
 * Remember passwords and the master password, each with a [?] that unfolds its explanation, plus the saved logins and
 * the never-save list. Opened from the ⋯ menu; "‹ Back" returns to it.
 */
import { useState, type ReactNode } from "react";
import { MasterPasswordSettings } from "./BrowserMasterPassword";
import type { BrowserBridge, BrowserState, WithState } from "./BrowserScreen";
import { HelpToggle } from "./ui/Fold";

type PrivacyApi = Pick<
  BrowserBridge,
  | "setKeepCache"
  | "setRememberPasswords"
  | "passwordDelete"
  | "passwordDeleteAll"
  | "passwordNeverRemove"
  | "masterUnlock"
  | "masterLock"
  | "masterSet"
  | "masterRemove"
>;

/** One option: its control and title, a [?] button, and the explanation it unfolds. */
function Option({ control, title, help }: { control: ReactNode; title: ReactNode; help: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ebr-privacy__opt">
      <div className="ebr-privacy__row">
        {control}
        <span className="ebr-privacy__title">{title}</span>
        <HelpToggle open={open} onToggle={() => setOpen(!open)} title={open ? "Hide the explanation" : "What does this do?"} />
      </div>
      {open ? <div className="ebr-menu__help ebr-privacy__help">{help}</div> : null}
    </div>
  );
}

export function BrowserPrivacyPanel({
  st,
  api,
  setSt,
  onBack,
}: {
  st: Pick<BrowserState, "keepCache" | "rememberPasswords" | "passwords">;
  api: PrivacyApi;
  setSt: (s: BrowserState) => void;
  onBack: () => void;
}) {
  const apply = (r: WithState) => setSt(r.state);
  const pw = st.passwords;
  const locked = pw.master.set && !pw.master.unlocked;
  return (
    <div className="ebr-privacy" data-testid="ebr-privacy">
      <button type="button" role="menuitem" className="ebr-privacy__back" onClick={onBack}>
        ‹ Back
      </button>
      <div className="ebr-menu__sub">Privacy &amp; Security</div>

      <Option
        control={
          <input
            type="checkbox"
            aria-label="Keep page cache"
            checked={st.keepCache}
            onChange={(e) => void api.setKeepCache(e.target.checked).then(apply)}
          />
        }
        title="Keep page cache"
        help="Pages load faster on the next visit. The cache can show a site you visited before; cookies and site data are still cleared unless the site is marked Remember."
      />

      <Option
        control={
          <input
            type="checkbox"
            aria-label="Remember passwords"
            checked={st.rememberPasswords}
            disabled={!pw.available && !st.rememberPasswords}
            onChange={(e) => void api.setRememberPasswords(e.target.checked).then(apply)}
          />
        }
        title="Remember passwords"
        help={
          pw.available
            ? "Offers to save a login on HTTPS sites, encrypted by the operating system, on this PC only. It is filled in on that same site: on its own when one login is saved, with the key button when there are several. Turning this off keeps what is saved, but nothing is saved or filled. Backups leave saved passwords out."
            : `Not available: ${pw.reason ?? "no password protection on this system."} Nothing is saved.`
        }
      />

      {(
        <Option
          control={<span className="ebr-privacy__dot" aria-hidden="true" />}
          title={
            !st.rememberPasswords || !pw.available
              ? "Master password · needs Remember passwords"
              : `Master password${pw.master.set ? (pw.master.unlocked ? " · unlocked" : " · locked") : " · off"}`
          }
          help="Optional. Asked once each time the app starts, before a saved login is filled or a new one saved. The logins are then also encrypted with a key made from it, kept in memory only until the app closes or you lock it: without it they cannot be read, not even by a program running under your Windows account. The master password itself is never stored. Forgotten: Delete all saved passwords starts over."
        />
      )}
      {st.rememberPasswords && pw.available ? (
        <MasterPasswordSettings master={pw.master} savedCount={pw.savedCount} api={api} after={apply} />
      ) : null}

      {pw.saved.length ? (
        <>
          <div className="ebr-menu__sub">Saved passwords</div>
          <ul className="ebr-menu__pw">
            {pw.saved.map((x) => (
              <li key={`${x.origin} ${x.username}`}>
                <span title={x.origin}>
                  {new URL(x.origin).host} <span className="dim">{x.username || "(no username)"}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Delete the password for ${x.username || "no username"} on ${x.origin}`}
                  onClick={() => void api.passwordDelete(x.origin, x.username).then(apply)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {/* One button: while locked the list above is empty, and deleting all is the way back from a forgotten master. */}
      {pw.savedCount > 0 ? (
        <button
          type="button"
          className="btn-top-neutral ebr-privacy__btn"
          onClick={() => void api.passwordDeleteAll().then(apply)}
        >
          {locked ? "Delete all saved passwords (and the master password)" : "Delete all saved passwords"}
        </button>
      ) : null}

      {pw.never.length ? (
        <>
          <div className="ebr-menu__sub">Never save passwords for</div>
          <ul className="ebr-menu__pw">
            {pw.never.map((origin) => (
              <li key={origin}>
                <span title={origin}>{new URL(origin).host}</span>
                <button
                  type="button"
                  aria-label={`Offer to save passwords for ${origin} again`}
                  onClick={() => void api.passwordNeverRemove(origin).then(apply)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
