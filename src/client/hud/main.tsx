/*
  EDEXO HUD — the overlay pages (React since 1.2.17, plan 3.8; owner, 2026-10-15: "hud rewrite in react - now").

  Every overlay page is the same shell (hud.css) around one panel; what differs is which sections are inside it.
  A page calls `HUD.mount(["distance"])` for one section or `HUD.mount(["jump","fss","candidates","distance",
  "datavalue"])` for the merged HUD (boot.ts reads which), and this file does the rest: one state feed (WebSocket
  first, polling as the fallback), the React panel, and telling the Electron host how tall the window has to be.

  Settings come from localStorage when this page shares it with the launcher (a browser tab on the same origin),
  and otherwise from the server's mirror of the launcher's (`hudPrefs` in each snapshot) — the phone, and the
  Electron overlays, which have a session of their own so the launcher's zoom stays off them:
    edexoHudTheme      {"preset":"orange"} or {"preset":"custom","accent":"#rrggbb","text":"#rrggbb"}
    edexoHudCandOrder  "likelihood" (default) | "value"
    edexoHudRegion     "1" (default) | "0"  — show the current region line in the candidates card
    edexoHudCompact    "0" (default) | "1"  — compact: hide the explanatory lines (.hud-explain)
    edexoHudRelevant   "0" (default) | "1"  — only when relevant: a section with nothing to say steps aside

  `window.HUD` is the page's surface, as it was: the launcher, the Electron host and the tests drive it.
*/
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { Settings } from "lucide-react";
import { HUD, api, setPort } from "./core";
import { audioOn, cueFromOverlay } from "./audio";
import { PHONE, PRESETS, applyTheme, onThemeApplied, readOpacity, readScale } from "./theme";
import { hudStore } from "./store";
import { Panel, RELEVANT_HOLD_MS } from "./Panel";
import type { HudSection } from "./parts";
import type { HudExoLive, HudSnapshot } from "./types";
import { HUD_SECTION_KEYS } from "@shared/hudSections";
import { achievement } from "./sections/achievement";
import { candidates } from "./sections/candidates";
import { datavalue } from "./sections/datavalue";
import { distance } from "./sections/distance";
import { fss } from "./sections/fss";
import { jump, starKind } from "./sections/jump";
import { notable } from "./sections/notable";
import { notices } from "./sections/notices";
import { colonize } from "./sections/colonize";
import { ship } from "./sections/ship";

export const SECTIONS: Record<string, HudSection> = {
  jump,
  fss,
  candidates,
  distance,
  datavalue,
  achievement,
  notable,
  notices,
  colonize,
  ship,
};
// The one list of section names (shared/hudSections.ts), which the server's prefs check and the CLI read too.
export const ORDER: string[] = [...HUD_SECTION_KEYS];
export { RELEVANT_HOLD_MS };

type ElectronHud = {
  hudDrag?: (phase: string) => Promise<unknown>;
  onHudPrefs?: (cb: (p: unknown) => void) => void;
  onHudMoveMode?: (cb: (v: unknown) => void) => void;
  resizeHudOverlay?: (o: { height?: number; scale?: number; idle?: boolean }) => Promise<unknown>;
};
const electron = (): ElectronHud | undefined =>
  (window as unknown as { edexoElectron?: ElectronHud }).edexoElectron;

/* ============================================================== HUD object ================== */
HUD.SECTIONS = ORDER.slice();
HUD.PRESETS = PRESETS;
HUD.applyTheme = applyTheme;
// The Elite Style's slant needs room in proportion to the window's width (theme.ts), which changes with the scale.
window.addEventListener("resize", () => applyTheme());
HUD.starKind = starKind;
HUD.readScale = readScale;
HUD.readOpacity = readOpacity;
HUD.audioOn = audioOn;
HUD.serverPrefs = null;
HUD.cueFromOverlay = cueFromOverlay;
/*
  The section implementations, exposed so a test can see which of them a frame actually ran: the panel calls
  `SECTIONS[name].render(d)` each time it draws one, so replacing `render` here is enough to count the calls.
*/
HUD.sectionImpls = SECTIONS;
// A settings change draws every section again (the order, the region line, the next boxel line read them).
onThemeApplied(() => hudStore.bumpPrefs());

/*
  Phone chrome: a chip per section at the top. The phone shows what the app has open, in the app's stack order (owner,
  2026-10-15: it showed every section in its own order); the launcher sends that list with the HUD settings
  (`hudPrefs.sections`). Tapping a chip changes the set on this phone only, and only until the app's own set changes,
  which starts the phone over from the app's.
*/
export const PHONE_LS = "edexoPhoneSections";
interface PhoneSaved {
  /** The app's set the phone last saw. */
  app: string[] | null;
  /** The phone's own pick, made against `app`; null: the app's set as it is. */
  phone: string[] | null;
}
const known = (x: unknown): string[] | null =>
  Array.isArray(x) ? x.filter((n): n is string => typeof n === "string" && ORDER.indexOf(n) >= 0) : null;
const sameList = (a: string[] | null, b: string[] | null) => !!a && !!b && a.join(",") === b.join(",");
function readPhoneSaved(): PhoneSaved {
  try {
    const v = JSON.parse(localStorage.getItem(PHONE_LS) || "null") as unknown;
    // Before 1.2.17 a bare list of the phone's own picks, made against no app set: it gives way to the app's.
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      return { app: known(o.app), phone: known(o.phone) };
    }
  } catch {
    /* nothing saved */
  }
  return { app: null, phone: null };
}
function writePhoneSaved(s: PhoneSaved): void {
  try {
    localStorage.setItem(PHONE_LS, JSON.stringify(s));
  } catch {
    /* kept for this visit */
  }
}
/** `names` in the app's order, then any the app does not have open in the usual order. */
function inAppOrder(app: string[], names: string[]): string[] {
  return app
    .filter((n) => names.indexOf(n) >= 0)
    .concat(ORDER.filter((n) => app.indexOf(n) < 0 && names.indexOf(n) >= 0));
}
/** The app's set from the mirrored settings: null while the launcher has not said; every section when none is open. */
export function phoneAppSet(prefs: Record<string, unknown> | null | undefined): string[] | null {
  const s = prefs ? known(prefs.sections) : null;
  if (!s) return null;
  return s.length ? s : ORDER.slice();
}
/** What the phone shows: its own pick while the app's set is the one it was made against, else the app's set. */
export function phoneSections(app: string[], saved: PhoneSaved = readPhoneSaved()): string[] {
  if (saved.phone && saved.phone.length && sameList(saved.app || ORDER, app))
    return inAppOrder(app, saved.phone);
  return app.slice();
}

/** The chip bar; returns the function that draws the chips for the list shown. */
function mountPhoneBar(onPick: (next: string[]) => void): (list: string[]) => void {
  document.documentElement.classList.add("phone");
  document.body.classList.add("phone");
  const bar = document.createElement("nav");
  bar.className = "phone-bar";
  bar.setAttribute("aria-label", "HUD sections");
  /*
    Full screen on the phone: the Fullscreen API on Android Chrome (tap the chip or the phone's
    back button to leave); iOS Safari has no API for it — there, "Add to Home Screen" opens the
    page without browser chrome (the web-app manifest says `display: fullscreen`).
  */
  type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };
  const doc = document as FsDoc;
  const de = document.documentElement as FsEl;
  const fs = document.createElement("button");
  fs.type = "button";
  fs.className = "phone-chip phone-chip--fs";
  fs.setAttribute("aria-label", "Full screen");
  fs.title = "Full screen (tap again, or the back button, to leave). iPhone: use Add to Home Screen.";
  fs.textContent = "⛶";
  const canFs = !!(de.requestFullscreen || de.webkitRequestFullscreen);
  if (!canFs) fs.classList.add("phone-chip--dim");
  fs.addEventListener("click", () => {
    try {
      const fsEl = doc.fullscreenElement || doc.webkitFullscreenElement;
      if (fsEl) (doc.exitFullscreen || doc.webkitExitFullscreen)!.call(doc);
      else if (de.requestFullscreen) void de.requestFullscreen({ navigationUI: "hide" });
      else if (de.webkitRequestFullscreen) de.webkitRequestFullscreen();
    } catch {
      /* not allowed here */
    }
  });
  /*
    In full screen the chip row folds into a gear (owner, 2026-10-15), which fades after 3 s without a touch; a
    touch anywhere brings it back, and while the row is open it stays.
  */
  const IDLE_MS = 3000;
  const body = document.body;
  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "phone-gear";
  gear.setAttribute("aria-label", "HUD sections");
  gear.setAttribute("aria-expanded", "false");
  createRoot(gear).render(<Settings size={22} absoluteStrokeWidth strokeWidth={1.75} aria-hidden="true" />);
  const setMenu = (open: boolean) => {
    body.classList.toggle("phone--menu", open);
    gear.setAttribute("aria-expanded", open ? "true" : "false");
  };
  gear.addEventListener("click", () => setMenu(!body.classList.contains("phone--menu")));
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const wake = () => {
    body.classList.remove("phone--idle");
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => body.classList.add("phone--idle"), IDLE_MS);
  };
  document.addEventListener("pointerdown", wake, { capture: true, passive: true });
  document.addEventListener("touchstart", wake, { capture: true, passive: true });
  // A tap on the HUD itself closes the open row.
  document.addEventListener("click", (ev) => {
    const t = ev.target as Node | null;
    // A chip redraws the row, so the one tapped is gone from the page by now: still a tap inside it.
    if (t && !t.isConnected) return;
    if (body.classList.contains("phone--menu") && t && !bar.contains(t) && !gear.contains(t)) setMenu(false);
  });
  const syncFs = () => {
    const on = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
    fs.classList.toggle("phone-chip--on", on);
    body.classList.toggle("phone--fullscreen", on);
    setMenu(false);
    if (on) wake();
  };
  document.addEventListener("fullscreenchange", syncFs);
  document.addEventListener("webkitfullscreenchange", syncFs);
  bar.appendChild(fs);
  const shellEl = document.querySelector(".shell");
  if (shellEl && shellEl.parentNode) {
    shellEl.parentNode.insertBefore(bar, shellEl);
    shellEl.parentNode.insertBefore(gear, bar);
  }

  return (list: string[]) => {
    for (const old of Array.from(bar.querySelectorAll(".phone-chip:not(.phone-chip--fs)"))) old.remove();
    const app = readPhoneSaved().app || ORDER;
    // The chips in the order the panel uses: the app's sections first.
    for (const n of inAppOrder(app, ORDER)) {
      const on = list.indexOf(n) >= 0;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "phone-chip" + (on ? " phone-chip--on" : "");
      b.textContent = SECTIONS[n]!.title;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.addEventListener("click", () => {
        const picked = on ? list.filter((x) => x !== n) : list.concat(n);
        if (!picked.length) return;
        const next = inAppOrder(app, picked);
        writePhoneSaved({ app: readPhoneSaved().app, phone: sameList(next, app) ? null : next });
        onPick(next);
      });
      bar.insertBefore(b, fs);
    }
  };
}

/*
  Free move's placing mode (owner, 2026-10-02): the window takes the mouse while it is on, and this frame over the
  HUD is what it is grabbed by. The drag only says start / move / end; the app reads the cursor itself and moves the
  whole stack, so every HUD window follows the one being dragged. "Done" ends placing for every window.
*/
let moveFrame: HTMLDivElement | null = null;
HUD.setMoveMode = function (on: boolean): void {
  const ee = electron();
  if (!on) {
    if (moveFrame && moveFrame.parentNode) moveFrame.parentNode.removeChild(moveFrame);
    moveFrame = null;
    return;
  }
  if (moveFrame || !ee || typeof ee.hudDrag !== "function") return;
  const drag = ee.hudDrag;
  const f = document.createElement("div");
  f.className = "hud-move";
  f.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;gap:0.6em;" +
    "cursor:move;background:rgba(0,0,0,0.45);border:2px dashed var(--hud-hi,#ffb060);box-sizing:border-box;" +
    "color:var(--hud-hi,#ffb060);font:600 13px/1.2 var(--hud-font,'Segoe UI',sans-serif);letter-spacing:0.06em;" +
    "text-transform:uppercase;user-select:none;touch-action:none;";
  const label = document.createElement("span");
  label.textContent = "Drag to place";
  const done = document.createElement("button");
  done.type = "button";
  done.className = "hud-move-done";
  done.textContent = "Done";
  done.style.cssText =
    "cursor:pointer;font:inherit;letter-spacing:inherit;text-transform:inherit;padding:0.2em 0.8em;" +
    "color:#111;background:var(--hud-hi,#ffb060);border:0;";
  done.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  done.addEventListener("click", () => void drag("done"));
  f.appendChild(label);
  f.appendChild(done);
  // In hud-events.log: the frame is up, and (once) the mouse reached it — what a stuck HUD lacks.
  void drag("frame");
  let hovered = false;
  f.addEventListener("pointerover", () => {
    if (hovered) return;
    hovered = true;
    void drag("hover");
  });
  let dragging = false;
  let queued = false;
  f.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    dragging = true;
    try {
      f.setPointerCapture(ev.pointerId);
    } catch {
      /* the drag still works while the cursor stays over the window */
    }
    void drag("start");
  });
  f.addEventListener("pointermove", () => {
    // One move per frame: the app moves every window in the stack on each one.
    if (!dragging || queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (dragging) void drag("move");
    });
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    void drag("end");
  };
  f.addEventListener("pointerup", end);
  f.addEventListener("pointercancel", end);
  f.addEventListener("lostpointercapture", end);
  document.body.appendChild(f);
  moveFrame = f;
};

/* ============================================================== mount + feed ================ */
let reactRoot: Root | null = null;

/**
 * Build the panel for `names` (in the order given — the launcher passes the owner's stack order, so the merged
 * panel and the separate windows agree on who sits above whom) inside #hud, and start the state feed.
 */
HUD.mount = function (names: string[] | null | undefined, opts?: { noTimers?: boolean }): HTMLElement {
  const o = opts || {};
  const root = document.getElementById("hud")!;
  const shell = document.querySelector(".shell") as HTMLElement;
  const panel = document.querySelector(".panel");
  // The box's own layers (frame gradient, body fill) as elements, so the opacity slider can fade
  // them without touching the text; pseudo-elements were taken by the scanlines.
  if (panel && !panel.querySelector(".panel__frame")) {
    const frame = document.createElement("div");
    frame.className = "panel__frame";
    frame.setAttribute("aria-hidden", "true");
    panel.insertBefore(frame, panel.firstChild);
  }
  let list: string[] = [];
  for (const n of names || []) if (ORDER.indexOf(n) >= 0 && list.indexOf(n) < 0) list.push(n);
  if (!list.length) list.push("distance");
  const single = list.length === 1;
  // The phone's set changes in place: a chip, or the app opening or closing a HUD (drawPanel is set below).
  let drawPanel = () => {};
  const showList = (next: string[]) => {
    if (sameList(next, list)) return;
    list = next;
    drawChips(list);
    drawPanel();
  };
  const drawChips = PHONE ? mountPhoneBar(showList) : () => {};
  drawChips(list);
  applyTheme();
  try {
    window.addEventListener("storage", (ev) => {
      if (!ev.key || /^edexoHud/.test(ev.key)) flushSync(() => applyTheme());
    });
  } catch {
    /* no storage events outside a browser */
  }
  /*
    The Electron overlays have a session of their own (so the launcher's zoom stays off them), and
    with it no storage events: the launcher's settings arrive straight from the Electron process as
    they change. The snapshot mirror still wins once it catches up — it carries the same values.
  */
  try {
    const ee = electron();
    if (!PHONE && ee && typeof ee.onHudPrefs === "function") {
      ee.onHudPrefs((p) => {
        if (!p || typeof p !== "object") return;
        HUD.serverPrefs = p as Record<string, unknown>;
        flushSync(() => applyTheme());
      });
    }
    if (!PHONE && ee && typeof ee.onHudMoveMode === "function") {
      ee.onHudMoveMode((v) =>
        (HUD.setMoveMode as (on: boolean) => void)(!!(v && (v as { on?: boolean }).on)),
      );
    }
  } catch {
    /* the snapshot mirror still arrives; no free move outside the app */
  }
  if (single) document.title = SECTIONS[list[0]!]!.title;

  /*
    Tell the host window how tall this overlay actually is. The window is transparent, so height it is not using
    reads as a gap before the next one in the stack, and height it needs and does not have cuts the content off.
    Polled as well as after each render, so a CSS transition (the tracker folding shut) is followed to its end.
    Only on a real change, because a resize relayouts the whole stack.
  */
  let lastReportedHeight = 0;
  let lastReportedScale = 0;
  let idleReported: boolean | null = null;
  const reportHeight = () => {
    if (PHONE || idleReported) return;
    const ee = electron();
    if (!ee || typeof ee.resizeHudOverlay !== "function") return;
    const h = Math.ceil(shell.getBoundingClientRect().height) + 2;
    const sc = readScale();
    const scaleChanged = Math.abs(sc - lastReportedScale) > 0.004;
    if (!h || (!scaleChanged && Math.abs(h - lastReportedHeight) <= 2)) return;
    lastReportedHeight = h;
    lastReportedScale = sc;
    try {
      void ee.resizeHudOverlay({ height: h, scale: sc });
    } catch {
      /* not in Electron, or the host said no; the overlay is still readable either way */
    }
  };
  // Nothing on this page to show: ask the host to take the window out of the stack.
  const onIdle = (idle: boolean) => {
    if (idle === idleReported) return;
    idleReported = idle;
    shell.classList.toggle("shell--idle", idle);
    const ee = electron();
    if (!PHONE && ee && typeof ee.resizeHudOverlay === "function") {
      try {
        void ee.resizeHudOverlay({ idle });
      } catch {
        /* not in Electron */
      }
    }
    if (!idle) {
      lastReportedHeight = 0;
      requestAnimationFrame(reportHeight);
    }
  };
  const onRendered = () => requestAnimationFrame(reportHeight);

  reactRoot?.unmount();
  reactRoot = createRoot(root);
  const r = reactRoot;
  drawPanel = () =>
    flushSync(() =>
      r.render(<Panel sections={SECTIONS} list={list} onIdle={onIdle} onRendered={onRendered} />),
    );
  drawPanel();

  // Recompute "only when relevant" now (its hold runs on the clock); the tick also redraws clocks.
  HUD.applyRelevance = () => flushSync(() => hudStore.bumpTick());

  let lastPrefsJson = "";
  const render = (d: HudSnapshot) => {
    HUD.lastSnapshot = d;
    shell.classList.remove("shell--off");
    // The launcher's settings, mirrored: re-theme when they change (the phone's only source).
    const pj = d && d.hudPrefs ? JSON.stringify(d.hudPrefs) : "";
    const prefsChanged = pj !== lastPrefsJson;
    flushSync(() => {
      if (prefsChanged) {
        lastPrefsJson = pj;
        HUD.serverPrefs = d && d.hudPrefs ? (d.hudPrefs as unknown as Record<string, unknown>) : null;
        applyTheme();
      }
      hudStore.setSnapshot(d);
    });
    // The phone follows the app's open HUDs; a new set there starts the phone's own pick over.
    if (PHONE && prefsChanged) {
      const app = phoneAppSet(HUD.serverPrefs as Record<string, unknown> | null);
      if (app) {
        const saved = readPhoneSaved();
        if (!sameList(saved.app, app)) writePhoneSaved({ app, phone: null });
        showList(phoneSections(app));
      }
    }
  };

  /*
    The radar's own frame (server: ExoLiveDTO): the two fields the radar draws, at the Status.json poll rate rather
    than through the snapshot's coalescing window. Merged into the snapshot in place; only the tracker draws again.
    Nothing before the first snapshot: there is nothing to merge into, and guessing an empty one would blank the rest.
  */
  const renderExoLive = (live: HudExoLive) => {
    const d = HUD.lastSnapshot as HudSnapshot | null;
    if (!d || !live) return;
    d.exoOrganicOverlay = live.exoOrganicOverlay;
    d.exoMinimap = live.exoMinimap;
    if (list.indexOf("distance") === -1) return;
    flushSync(() => hudStore.bumpLive());
  };

  if (!o.noTimers) {
    setInterval(reportHeight, 250);
    // Once a second: the run clock, notices leaving, and the "only when relevant" hold running out.
    setInterval(() => hudStore.bumpTick(), 1000);
  }

  /*
    One source of truth at a time. Polling and the WebSocket both deliver snapshots; when they disagree the panel
    flickers between two answers. The socket wins while it is delivering; the poll is the fallback for a socket that
    is not up, and it is slow on purpose — every poll builds a full snapshot on the server. An open socket is a live
    one even when it is quiet (the server pushes on change only; code review D15, 2026-10-14).
  */
  let lastWsAt = 0;
  const WS_LIVE_MS = 8000;
  let wsOpen = false;
  const tick = () => {
    if (wsOpen || Date.now() - lastWsAt < WS_LIVE_MS) return;
    fetch(api("/api/state?channel=hud"), { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json() as Promise<HudSnapshot>;
      })
      .then((d) => {
        if (typeof d.port === "number" && d.port > 0) setPort(d.port);
        render(d);
      })
      .catch(() => {
        shell.classList.remove("shell--off");
      });
  };
  if (!o.noTimers) {
    tick();
    setInterval(tick, 5000);
    /*
      Reconnects (combined plan 1.3): after a server restart or a phone's Wi-Fi drop the socket comes back, so the
      radar's live frames do too. Back-off 1 s doubling to 10 s, reset once connected.
    */
    let wsRetryMs = 1000;
    const connectWs = () => {
      try {
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        const host = typeof location.host === "string" && location.host ? location.host : "127.0.0.1:7111";
        // The channel in the address: the first frame is already the HUD's slice (plan O-H).
        const ws = new WebSocket(proto + "//" + host + "/ws?channel=hud");
        ws.onopen = () => {
          wsRetryMs = 1000;
          wsOpen = true;
          try {
            ws.send(JSON.stringify({ type: "hello", channel: "hud" }));
          } catch {
            /* the server sends the HUD slice anyway */
          }
        };
        ws.onclose = () => {
          wsOpen = false;
          ws.onclose = null;
          ws.onmessage = null;
          setTimeout(connectWs, wsRetryMs);
          wsRetryMs = Math.min(10000, wsRetryMs * 2);
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data)) as { type?: string; payload?: unknown };
            if (msg.type === "state" && msg.payload) {
              lastWsAt = Date.now();
              const p = msg.payload as HudSnapshot;
              if (typeof p.port === "number" && p.port > 0) setPort(p.port);
              render(p);
            } else if (msg.type === "exoLive" && msg.payload) {
              // Counts as the socket being alive, or the 5 s fallback poll would start fighting it.
              lastWsAt = Date.now();
              renderExoLive(msg.payload as HudExoLive);
            }
          } catch {
            /* a malformed frame is skipped */
          }
        };
      } catch {
        setTimeout(connectWs, wsRetryMs);
        wsRetryMs = Math.min(10000, wsRetryMs * 2);
      }
    };
    connectWs();
  }

  HUD.render = render; // for previews and tests
  HUD.renderExoLive = renderExoLive;
  return root;
};

/** Sections named in the page URL (`?s=fss,distance`), or everything when absent. */
HUD.sectionsFromUrl = function (): string[] {
  /*
    The phone: the app's set as last seen, or the phone's own pick, until the first snapshot says what the app has
    open now. A `?s=` there is left from the chips before 1.2.17 (they reloaded the page with it): dropped.
  */
  if (PHONE) {
    if (/[?&]s=/.test(String(location.search || ""))) {
      try {
        const u = new URL(location.href);
        u.searchParams.delete("s");
        history.replaceState(null, "", u.toString());
      } catch {
        /* the address keeps it; it is not read */
      }
    }
    const saved = readPhoneSaved();
    return phoneSections(saved.app || ORDER, saved);
  }
  const m = /[?&]s=([^&]*)/.exec(location.search || "");
  if (!m) return ORDER.slice();
  return decodeURIComponent(m[1]!)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ORDER.indexOf(s) >= 0);
};

// Pages mount through `window.HUD` (or `import { HUD }`), tests through the export.
(window as unknown as { HUD: typeof HUD }).HUD = HUD;
export { HUD };
