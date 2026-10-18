/**
 * The EDEXO browser's tab (plan 9, owner 2026-10-13): "as light and barebones as possible, no data collection,
 * all of the adblocking functions (with option to stop for a specific page), all tracker blockers", incognito by
 * default unless a site is remembered, DuckDuckGo by default, downloads asked each time.
 *
 * This is the toolbar and the start page only. The pages themselves are native views the main process owns
 * (electron/browserTabs.cjs) and lays over the box below the toolbar: this side says where that box is, or that
 * nothing should show (another tab in front, a menu or dialog over it, the start page, an error). Page titles
 * and addresses are shown as text, never as markup, so nothing from a page reaches the app's own page.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { IconKey } from "./ui/icons";
import { UnlockLoginsChip } from "./BrowserMasterPassword";
import { BrowserPrivacyPanel } from "./BrowserPrivacyPanel";
import "./styles/browser.css";

interface BrowserTab {
  id: number;
  title: string;
  url: string;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  blocked: number;
  domain: string | null;
  blocking: boolean;
  remembered: boolean;
  secure: boolean;
  startPage: boolean;
  error: { code: number; text: string; url: string; httpFallback: string | null } | null;
  /** A login was just used on this page: save it? Origin and username only, never the password. */
  passwordPrompt: { origin: string; username: string; update: boolean } | null;
  /** Usernames saved for this page's exact origin, while it shows a password field (the key button). */
  logins: string[];
  /** Logins saved for this origin that the master password still locks (1.2.19). */
  loginsLocked: number;
}
export interface BrowserState {
  tabs: BrowserTab[];
  active: number | null;
  blocker: {
    ready: boolean;
    haveLists: boolean;
    busy: "download" | "load" | "refresh" | null;
    progress: { done: number; total: number } | null;
    error: string | null;
    fetchedAt: string | null;
    bytes: number;
    lists: { name: string; url: string }[];
  };
  downloads: { name: string; state: string; received: number; total: number }[];
  links: { name: string; url: string; builtIn: boolean }[];
  engines: { key: string; label: string }[];
  engine: string;
  customSearch: string | null;
  keepCache: boolean;
  rememberPasswords: boolean;
  passwords: {
    available: boolean;
    reason: string | null;
    saved: { origin: string; username: string }[];
    /** Saved logins, readable or locked; master password state (1.2.19). */
    savedCount: number;
    master: { set: boolean; unlocked: boolean };
    never: string[];
  };
}
export type WithState = { ok?: boolean; error?: string; state: BrowserState };
type Rect = { x: number; y: number; width: number; height: number };
export interface BrowserBridge {
  start(): Promise<BrowserState>;
  stop(): Promise<unknown>;
  state(): Promise<BrowserState>;
  downloadLists(): Promise<BrowserState>;
  bounds(rect: Rect | null): Promise<unknown>;
  snapshot(): Promise<{ dataUrl: string | null }>;
  open(text?: string): Promise<{ id?: number; error?: string }>;
  close(id: number): Promise<unknown>;
  select(id: number): Promise<unknown>;
  go(id: number, text: string): Promise<unknown>;
  back(id: number): Promise<unknown>;
  forward(id: number): Promise<unknown>;
  reload(id: number): Promise<unknown>;
  halt(id: number): Promise<unknown>;
  home(id: number): Promise<unknown>;
  plainHttp(id: number): Promise<unknown>;
  siteBlocking(id: number, on: boolean): Promise<unknown>;
  siteRemember(id: number, on: boolean): Promise<unknown>;
  forgetSite(id: number): Promise<unknown>;
  clearAll(): Promise<unknown>;
  addLink(name: string, url: string): Promise<{ ok: boolean; state: BrowserState }>;
  removeLink(url: string): Promise<{ ok: boolean; state: BrowserState }>;
  setEngine(key: string, custom?: string): Promise<{ ok: boolean; state: BrowserState }>;
  setKeepCache(on: boolean): Promise<WithState>;
  setRememberPasswords(on: boolean): Promise<WithState>;
  passwordAnswer(id: number, answer: "save" | "never" | "later"): Promise<WithState>;
  passwordFill(id: number, username?: string): Promise<{ ok?: boolean; error?: string }>;
  passwordDelete(origin: string, username: string): Promise<WithState>;
  passwordDeleteAll(): Promise<WithState>;
  passwordNeverRemove(origin: string): Promise<WithState>;
  masterUnlock(password: string): Promise<WithState>;
  masterLock(): Promise<WithState>;
  masterSet(password: string, current?: string): Promise<WithState>;
  masterRemove(current: string): Promise<WithState>;
  on(cb: (m: { type: "state"; state: BrowserState } | { type: "event"; event: string }) => void): () => void;
}

const bridge = (): BrowserBridge | null =>
  (window as unknown as { edexoElectron?: { browser?: BrowserBridge } }).edexoElectron?.browser ?? null;

/** Anything drawn over the page box (menus, dialogs, pop-overs): the native page would cover it, so it hides. */
const OVERLAYS =
  '[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], .tab-strip__menu, .ebr-menu';

const mb = (b: number) => `${(b / 1e6).toFixed(1)} MB`;

export function BrowserScreen() {
  const api = bridge();
  const [st, setSt] = useState<BrowserState | null>(null);
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // The ⋯ menu shows its main list or the Privacy & Security view (owner, 2026-10-17).
  const [menuView, setMenuView] = useState<"main" | "privacy">("main");
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  // null until typed in: the box shows the saved address, and Use sends what the box shows.
  const [customSearch, setCustomSearch] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [keyMenu, setKeyMenu] = useState(false);
  const [pwNote, setPwNote] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  /*
    While a menu covers the page: a still of it in its place (owner, 2026-10-17: the page vanished behind every menu).
    `still` is shown; the ref holds it for place(), "" while one is being taken, "none" when there is no picture.
  */
  const [still, setStill] = useState<string | null>(null);
  const stillRef = useRef<string | null>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sentRef = useRef<string>("");

  const tab = st?.tabs.find((t) => t.id === st.active) ?? null;
  const pageShown = !!tab && !tab.startPage && !tab.error;

  useEffect(() => {
    if (!api) return;
    const off = api.on((m) => {
      if (m.type === "state") setSt(m.state);
      else if (m.event === "focusAddress") addressRef.current?.focus();
    });
    sentRef.current = "";
    void api
      .start()
      .then(setSt)
      .catch((e: unknown) => setFailure(String(e)));
    return () => {
      off();
      void api.stop();
    };
  }, [api]);

  // The address bar follows the page unless he is typing in it.
  const shownUrl = tab && !tab.startPage ? tab.url : "";
  useEffect(() => {
    if (!editing) setAddress(shownUrl);
  }, [shownUrl, tab?.id, editing]);

  /*
    Where the page goes: the box under the toolbar, in this window's CSS pixels (the main process scales them by
    the window's zoom). Hidden while the box is not on screen (another tab in front), on the start page and error
    page, and while anything is drawn over it.
  */
  const place = useCallback(() => {
    if (!api) return;
    const el = boxRef.current;
    const r = el?.getBoundingClientRect();
    const visible = !!r && r.width > 0 && r.height > 0 && !document.hidden;
    // Only what is on screen and over the box: the app bar's menu is a role="menu" that is always there.
    const covered =
      visible &&
      [...document.querySelectorAll(OVERLAYS)].some((o) => {
        const q = o.getBoundingClientRect();
        return (
          q.width > 0 &&
          q.height > 0 &&
          q.right > r.left &&
          q.left < r.right &&
          q.bottom > r.top &&
          q.top < r.bottom
        );
      });
    const box =
      pageShown && visible
        ? {
            x: Math.round(r.left),
            y: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
          }
        : null;
    if (box && covered && stillRef.current == null) {
      // A menu just opened over the page: the page stays until its picture is ready, then the picture takes its place.
      stillRef.current = "";
      void api
        .snapshot()
        .catch(() => ({ dataUrl: null }))
        .then((s) => {
          if (stillRef.current !== "") return;
          stillRef.current = s.dataUrl ?? "none";
          setStill(s.dataUrl);
          place();
        });
      return;
    }
    if (box && covered && stillRef.current === "") return;
    const rect = box && !covered ? box : null;
    // The app's page changes many times a second in flight: only a different box goes to the main process.
    const key = JSON.stringify(rect);
    if (key !== sentRef.current) {
      sentRef.current = key;
      void api.bounds(rect);
    }
    // The menu closed (or the page went): the live page is back, the picture goes.
    if (!covered && stillRef.current != null) {
      stillRef.current = null;
      setStill(null);
    }
  }, [api, pageShown]);
  useLayoutEffect(() => {
    place();
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    let raf = 0;
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    });
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });
    window.addEventListener("resize", place);
    document.addEventListener("visibilitychange", place);
    return () => {
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      document.removeEventListener("visibilitychange", place);
    };
    // Once more when the toolbar replaces the blocklists' gate: the box exists from then on.
  }, [place, menuOpen, keyMenu, st?.blocker.ready]);

  // Ctrl+T / Ctrl+W / Ctrl+L on the toolbar: this browser's tabs, not the app's (TabHost closes app tabs on Ctrl+W).
  useEffect(() => {
    if (!api || !st) return;
    const onKey = (ev: KeyboardEvent) => {
      if (!(ev.ctrlKey || ev.metaKey) || !boxRef.current?.offsetParent) return;
      const k = ev.key.toLowerCase();
      if (k === "w" && st.active != null) void api.close(st.active);
      else if (k === "t") void api.open();
      else if (k === "l") addressRef.current?.focus();
      else return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [api, st]);

  // Escape closes the ⋯ menu and the key button's list, like any menu (owner, 2026-10-18).
  useEffect(() => {
    if (!menuOpen && !keyMenu) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      setMenuOpen(false);
      setKeyMenu(false);
      ev.preventDefault();
      ev.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menuOpen, keyMenu]);

  if (!api)
    return (
      <div className="ebr ebr--gate">
        <p>The EDEXO browser is in the desktop app only: here you have a browser already.</p>
      </div>
    );
  if (failure) return <div className="ebr ebr--gate">{failure}</div>;
  if (!st) return <div className="ebr ebr--gate">Starting the browser…</div>;

  const b = st.blocker;
  if (!b.ready) {
    const busy = b.busy === "download" || b.busy === "load";
    return (
      <div className="ebr ebr--gate">
        <h2>EDEXO browser</h2>
        {b.haveLists ? (
          <p>{busy ? "Reading the blocklists…" : "The blocklists could not be read."}</p>
        ) : (
          <>
            <p>
              The EDEXO browser needs its blocklists ({mb(b.bytes)}) to start: it never opens a page without
              them. They come from their publishers and are refreshed weekly:
            </p>
            <ul className="ebr-lists">
              {b.lists.map((l) => (
                <li key={l.url}>
                  {l.name} <span className="dim">{new URL(l.url).host}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <button
          type="button"
          className="btn-top-toggle"
          disabled={busy}
          onClick={() => void api.downloadLists().then(setSt)}
        >
          {b.busy === "download"
            ? `Downloading… ${b.progress ? `${b.progress.done} / ${b.progress.total}` : ""}`
            : b.haveLists
              ? "Download them again"
              : `Download the blocklists (${mb(b.bytes)})`}
        </button>
        {b.error ? <p className="ebr-error">{b.error}</p> : null}
        <p className="dim">
          Private by default: what a site stores is cleared when the app closes, unless you choose to remember
          that site. No history, no telemetry, nothing collected.{" "}
          <a href="/legal/privacy.html#browser" target="_blank" rel="noreferrer">
            Privacy policy
          </a>
        </p>
      </div>
    );
  }

  const go = (ev: FormEvent) => {
    ev.preventDefault();
    const text = address.trim();
    if (!text || st.active == null) return;
    setEditing(false);
    addressRef.current?.blur();
    void api.go(st.active, text);
  };
  const searchFromStart = (ev: FormEvent) => {
    ev.preventDefault();
    const text = searchRef.current?.value.trim() ?? "";
    if (text && st.active != null) void api.go(st.active, text);
  };
  const lastDownload = st.downloads[0];
  const prompt = tab?.passwordPrompt ?? null;
  const fill = (username?: string) => {
    setKeyMenu(false);
    if (!tab) return;
    void api.passwordFill(tab.id, username).then((r) => setPwNote(r.error ?? null));
  };
  const answer = (a: "save" | "never" | "later") => {
    if (!tab) return;
    void api.passwordAnswer(tab.id, a).then((r) => {
      setSt(r.state);
      setPwNote(r.error ?? null);
    });
  };

  return (
    <div className="ebr">
      <div className="ebr-tabs" role="tablist" aria-label="Browser tabs">
        {st.tabs.map((t) => (
          <div key={t.id} className={`ebr-tab${t.id === st.active ? " is-active" : ""}`} role="presentation">
            <button
              type="button"
              role="tab"
              aria-selected={t.id === st.active}
              className="ebr-tab__title"
              title={t.url || "New tab"}
              onClick={() => void api.select(t.id)}
              onAuxClick={(ev) => {
                if (ev.button === 1) void api.close(t.id);
              }}
            >
              {t.loading ? <span className="ebr-spin" aria-hidden="true" /> : null}
              {t.startPage ? "New tab" : t.title || t.domain || t.url}
            </button>
            <button
              type="button"
              className="ebr-tab__x"
              aria-label="Close tab"
              onClick={() => void api.close(t.id)}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="ebr-tabs__add"
          aria-label="New tab"
          title="New tab (Ctrl+T)"
          onClick={() => void api.open()}
        >
          +
        </button>
      </div>
      {/* Only the address is a form (1.2.19): a toolbar-wide form made Enter anywhere in its menus navigate. */}
      <div className="ebr-bar">
        <button
          type="button"
          aria-label="Back"
          disabled={!tab?.canBack}
          onClick={() => tab && void api.back(tab.id)}
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="Forward"
          disabled={!tab?.canForward}
          onClick={() => tab && void api.forward(tab.id)}
        >
          ›
        </button>
        <button
          type="button"
          aria-label={tab?.loading ? "Stop" : "Reload"}
          disabled={!tab || tab.startPage}
          onClick={() => tab && void (tab.loading ? api.halt(tab.id) : api.reload(tab.id))}
        >
          {tab?.loading ? "×" : "⟳"}
        </button>
        <button type="button" aria-label="Start page" onClick={() => tab && void api.home(tab.id)}>
          ⌂
        </button>
        <span
          className={`ebr-lock${tab?.secure ? " is-secure" : ""}`}
          title={tab && !tab.startPage ? (tab.secure ? "HTTPS" : "Not encrypted (plain HTTP)") : ""}
          aria-hidden="true"
        >
          {tab && !tab.startPage ? (tab.secure ? "🔒" : "⚠") : ""}
        </span>
        <form className="ebr-address-form" onSubmit={go}>
          <input
            ref={addressRef}
            className="ebr-address"
            value={address}
            spellCheck={false}
            placeholder="Search or type an address"
            aria-label="Address"
            onFocus={(e) => {
              setEditing(true);
              e.currentTarget.select();
            }}
            onBlur={() => setEditing(false)}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setEditing(false);
                e.currentTarget.blur();
              }
            }}
          />
        </form>
        {tab && tab.domain && !tab.startPage ? (
          <>
            <button
              type="button"
              className={`ebr-chip${tab.blocking ? " is-on" : " is-off"}`}
              title={
                tab.blocking
                  ? `Blocking ads and trackers on ${tab.domain}: ${tab.blocked} blocked on this page. Click to stop blocking on this site.`
                  : `Blocking is off on ${tab.domain}. Click to block ads and trackers here again.`
              }
              onClick={() => void api.siteBlocking(tab.id, !tab.blocking)}
            >
              🛡 {tab.blocking ? tab.blocked : "off"}
            </button>
            <button
              type="button"
              className={`ebr-chip${tab.remembered ? " is-on" : ""}`}
              title={
                tab.remembered
                  ? `${tab.domain} is remembered: its cookies and logins are kept. Click to forget them when the app closes.`
                  : `Private: what ${tab.domain} stores goes when the app closes. Click to remember this site (keep its logins).`
              }
              onClick={() => void api.siteRemember(tab.id, !tab.remembered)}
            >
              {tab.remembered ? "★ Remembered" : "☆ Remember"}
            </button>
          </>
        ) : null}
        {tab && !tab.startPage && tab.logins.length ? (
          <div className="ebr-more">
            <button
              type="button"
              className="ebr-chip is-on"
              aria-label="Fill a saved password"
              aria-expanded={tab.logins.length > 1 ? keyMenu : undefined}
              title={
                tab.logins.length > 1
                  ? "Fill a saved password"
                  : `Fill the saved password${tab.logins[0] ? ` for ${tab.logins[0]}` : ""}`
              }
              onClick={() => (tab.logins.length > 1 ? setKeyMenu(!keyMenu) : fill(tab.logins[0]))}
            >
              {/* A word beside the key (owner, 2026-10-16: the bare icon went unnoticed). */}
              <IconKey className="ebr-key-icon" /> {tab.logins.length > 1 ? "Logins ▾" : "Fill login"}
            </button>
            {keyMenu && tab.logins.length > 1 ? (
              <div className="ebr-menu" role="menu" onMouseLeave={() => setKeyMenu(false)}>
                {tab.logins.map((u) => (
                  <button key={u} type="button" role="menuitem" onClick={() => fill(u)}>
                    {u || "(no username)"}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {tab && !tab.startPage && !tab.logins.length && tab.loginsLocked > 0 ? (
          <UnlockLoginsChip
            count={tab.loginsLocked}
            unlock={(password) =>
              api.masterUnlock(password).then((r) => {
                setSt(r.state);
                return r;
              })
            }
          />
        ) : null}
        <div className="ebr-more">
          <button
            type="button"
            aria-label="More"
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuView("main");
              setMenuOpen(!menuOpen);
            }}
          >
            ⋯
          </button>
          {menuOpen ? (
            <div
              className="ebr-menu"
              role="menu"
              onMouseLeave={() => {
                if (menuView === "main") setMenuOpen(false);
              }}
            >
              {menuView === "privacy" ? (
                <BrowserPrivacyPanel st={st} api={api} setSt={setSt} onBack={() => setMenuView("main")} />
              ) : (
                <>
                  {tab?.domain && !tab.startPage ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        void api.forgetSite(tab.id);
                      }}
                    >
                      Forget {tab.domain} (its cookies, storage and settings)
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      void api.clearAll();
                    }}
                  >
                    Clear everything now (every site, remembered ones too)
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={b.busy != null}
                    onClick={() => {
                      setMenuOpen(false);
                      void api.downloadLists().then(setSt);
                    }}
                  >
                    Update the blocklists{b.fetchedAt ? ` (from ${b.fetchedAt.slice(0, 10)})` : ""}
                  </button>
                  <div className="ebr-menu__sub">Search with</div>
                  {st.engines.map((e) => (
                    <button
                      key={e.key}
                      type="button"
                      role="menuitemradio"
                      aria-checked={st.engine === e.key}
                      onClick={() => void api.setEngine(e.key).then((r) => setSt(r.state))}
                    >
                      {st.engine === e.key ? "● " : "○ "}
                      {e.label}
                    </button>
                  ))}
                  <form
                    className="ebr-menu__custom"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void api.setEngine("custom", customSearch ?? st.customSearch ?? "").then((r) => setSt(r.state));
                    }}
                  >
                    <input
                      value={customSearch ?? st.customSearch ?? ""}
                      onChange={(e) => setCustomSearch(e.target.value)}
                      placeholder="Custom: https://…?q=%s"
                      aria-label="Custom search address, %s for the words"
                    />
                    <button type="submit">{st.engine === "custom" ? "● Use" : "Use"}</button>
                  </form>
                  <button type="button" role="menuitem" onClick={() => setMenuView("privacy")}>
                    Privacy &amp; Security ›
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
      {prompt ? (
        <div className="ebr-pwbar" role="status">
          <span>
            {prompt.update ? "Update" : "Save"} the password for {prompt.origin}?
            {prompt.username ? <span className="dim"> ({prompt.username})</span> : null}
          </span>
          <button type="button" className="is-main" onClick={() => answer("save")}>
            {prompt.update ? "Update" : "Save"}
          </button>
          <button type="button" onClick={() => answer("never")}>
            Never for this site
          </button>
          <button type="button" onClick={() => answer("later")}>
            Not now
          </button>
        </div>
      ) : pwNote ? (
        <div className="ebr-pwbar" role="status">
          <span>{pwNote}</span>
          <button type="button" onClick={() => setPwNote(null)}>
            OK
          </button>
        </div>
      ) : null}
      <div className="ebr-box" ref={boxRef}>
        {still ? <img className="ebr-still" src={still} alt="" aria-hidden="true" /> : null}
        {tab?.error ? (
          <div className="ebr-page ebr-page--error">
            <h2>This page could not be loaded</h2>
            <p>{tab.error.text}</p>
            <p className="dim">{tab.error.url}</p>
            <div className="ebr-page__row">
              <button type="button" className="btn-top-toggle" onClick={() => void api.reload(tab.id)}>
                Try again
              </button>
              {tab.error.httpFallback ? (
                <button type="button" className="btn-top-toggle" onClick={() => void api.plainHttp(tab.id)}>
                  Open it over plain HTTP (not encrypted)
                </button>
              ) : null}
            </div>
          </div>
        ) : tab?.startPage ? (
          <div className="ebr-page ebr-page--start">
            <form className="ebr-search" onSubmit={searchFromStart}>
              <input
                ref={searchRef}
                autoFocus
                placeholder={`Search with ${st.engines.find((e) => e.key === st.engine)?.label ?? "your search engine"}, or type an address`}
                aria-label="Search"
              />
            </form>
            <div className="ebr-cards">
              {st.links.map((l) => (
                <div key={l.url} className="ebr-card">
                  <button
                    type="button"
                    className="ebr-card__go"
                    onClick={() => tab && void api.go(tab.id, l.url)}
                  >
                    <span className="ebr-card__name">{l.name}</span>
                    <span className="ebr-card__host">{new URL(l.url).host}</span>
                  </button>
                  {!l.builtIn ? (
                    <button
                      type="button"
                      className="ebr-card__x"
                      aria-label={`Remove ${l.name}`}
                      onClick={() => void api.removeLink(l.url).then((r) => setSt(r.state))}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
              <form
                className="ebr-card ebr-card--add"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  void api.addLink(linkName, linkUrl).then((r) => {
                    setSt(r.state);
                    if (r.ok) {
                      setLinkName("");
                      setLinkUrl("");
                    }
                  });
                }}
              >
                <span className="ebr-card__name">Add new</span>
                <input
                  value={linkName}
                  onChange={(e) => setLinkName(e.target.value)}
                  placeholder="Name"
                  aria-label="Name"
                />
                <input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://…"
                  aria-label="Address"
                />
                <button type="submit" disabled={!linkName.trim() || !/^https?:\/\//i.test(linkUrl.trim())}>
                  Add
                </button>
              </form>
            </div>
            <p className="ebr-note dim">
              Private by default: what a site stores goes when the app closes, unless you remember the site.
              Ads and trackers are blocked on every site unless you switch it off for one. No history, no
              telemetry, nothing collected. Downloads ask where to save, every time.{" "}
              <a href="/legal/privacy.html#browser" target="_blank" rel="noreferrer">
                Privacy policy
              </a>
            </p>
          </div>
        ) : null}
      </div>
      {lastDownload && lastDownload.state === "progressing" ? (
        <div className="ebr-download">
          Downloading {lastDownload.name}
          {lastDownload.total ? ` · ${Math.round((lastDownload.received / lastDownload.total) * 100)} %` : ""}
        </div>
      ) : null}
    </div>
  );
}
