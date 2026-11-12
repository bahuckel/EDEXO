/**
 * The streamer view shows the streamer's own app as the streamer has it (owner, 2026-10-04): compact
 * or cards, which panels are open, the units, the toggles. Those settings live in the app's browser
 * storage under `edexo.*`, which an OBS browser source does not share. So:
 *
 * - the app on the streamer's PC (not a phone, not the streamer view itself) reports its `edexo.*`
 *   settings to the server a second after one changes;
 * - the streamer view puts them into its own storage before its first paint, and again whenever the
 *   server says they changed (serverChanges.ts), and then draws the app afresh so every panel reads them.
 *
 * Only settings: what the viewers see still follows the game (the body, the scans) as before.
 */
import { onServerChange } from "./serverChanges";
import { sendJson, jsonOrNull } from "./http";

const PREFIX = "edexo.";
/** Not a setting of the picture: diagnostics switches. */
const SKIP = new Set(["edexo.perf"]);
const MAX_VALUE = 20_000;
/** Storage's own read, kept before the streamer view starts recording reads (below): the mirror's reads are not the page's. */
const rawGetItem = typeof Storage === "undefined" ? null : Storage.prototype.getItem;

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX) || SKIP.has(k)) continue;
      const v = rawGetItem ? rawGetItem.call(localStorage, k) : localStorage.getItem(k);
      if (v != null && v.length <= MAX_VALUE) out[k] = v;
    }
  } catch {
    /* storage blocked: nothing to mirror */
  }
  return out;
}

const isLoopback = () => ["127.0.0.1", "localhost", "[::1]", "::1"].includes(window.location.hostname);

/**
 * In the app on this PC: report the settings when they change.
 *
 * Looked at a second after a write to an `edexo.*` key, this page's own or another window's (the `storage` event),
 * instead of reading and stringifying every key once a second while nothing changed (review 2026-11-07 §4.2, D14).
 */
export function startUiMirrorSource(): void {
  if (!isLoopback()) return;
  let last = "";
  let timer = 0;
  const schedule = () => {
    if (!timer) timer = window.setTimeout(tick, 1000);
  };
  const tick = () => {
    timer = 0;
    const values = snapshot();
    const s = JSON.stringify(values);
    if (s === last) return;
    last = s;
    void sendJson("/api/ui/mirror", { values }).catch(() => {
      last = ""; // try again shortly
      schedule();
    });
  };
  onSettingWrite(schedule);
  tick();
}

/** `cb` after any write to an `edexo.*` key in local storage, from this page or another window of the app. */
export function onSettingWrite(cb: () => void): void {
  if (typeof Storage === "undefined") return;
  const ours = (s: Storage, key?: string) => s === window.localStorage && (key == null || String(key).startsWith(PREFIX));
  const { setItem, removeItem, clear } = Storage.prototype;
  Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
    setItem.call(this, key, value);
    if (ours(this, key)) cb();
  };
  Storage.prototype.removeItem = function (this: Storage, key: string) {
    removeItem.call(this, key);
    if (ours(this, key)) cb();
  };
  Storage.prototype.clear = function (this: Storage) {
    clear.call(this);
    if (ours(this)) cb();
  };
  window.addEventListener("storage", (e) => {
    if (e.key == null || e.key.startsWith(PREFIX)) cb();
  });
}

export interface Mirror {
  rev: number;
  values: Record<string, string>;
}

/*
  The settings the streamer view has read (owner, 2026-10-27: "I see the page refresh when I change the window, but
  nothing changes"). Switching Compare's tabs changes the tab list and the opened screen's filters, none of which the
  streamer view shows; it redrew for them all the same. Only a changed setting it has read now redraws it; the others
  are just stored, ready if a panel reads them later.
*/
const readKeys = new Set<string>();
let recording = false;

function recordReads(): void {
  if (recording || typeof Storage === "undefined") return;
  recording = true;
  const getItem = Storage.prototype.getItem;
  Storage.prototype.getItem = function (this: Storage, key: string) {
    if (this === window.localStorage) readKeys.add(key);
    return getItem.call(this, key);
  };
}

/** The keys whose value `m` changes, compared with this page's storage. */
export function changedKeys(m: Mirror, current: Record<string, string> = snapshot()): string[] {
  const keys = new Set([...Object.keys(current), ...Object.keys(m.values)]);
  return [...keys].filter((k) => current[k] !== m.values[k]);
}

/** Whether a change to `keys` alters what the page has drawn: one of them was read. */
export function touchesWhatWasRead(keys: readonly string[], read: ReadonlySet<string> = readKeys): boolean {
  return keys.some((k) => read.has(k));
}

function apply(m: Mirror): void {
  try {
    // The streamer view's own leftovers go: it shows the streamer's settings, not its own.
    for (const k of Object.keys(snapshot())) if (!(k in m.values)) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(m.values)) localStorage.setItem(k, v);
  } catch {
    /* storage blocked: the defaults show */
  }
}

/** In the streamer view: take the settings before the first paint. Returns the revision taken. */
export async function loadUiMirror(): Promise<number> {
  try {
    const r = await fetch("/api/ui/mirror", { cache: "no-store" });
    if (!r.ok) return -1;
    const m = (await r.json()) as Mirror;
    apply(m);
    recordReads();
    return m.rev;
  } catch {
    return -1;
  }
}

/** In the streamer view: follow the settings; `onChange` redraws the app. */
export function watchUiMirror(fromRev: number, onChange: () => void): void {
  let rev = fromRev;
  /*
    Only the answer to the latest ask (review 2026-11-10 F6: two notices close together, the older answer landing last
    was applied over the newer). Not by revision: a restarted server counts from 0 again.
  */
  let asked = 0;
  // Read when the streamer changes a setting (R2, 2026-10-24: was asked every second).
  onServerChange("ui-mirror", () => {
    const mine = ++asked;
    fetch("/api/ui/mirror", { cache: "no-store" })
      .then(jsonOrNull<Mirror>)
      .then((m) => {
        if (!m || mine !== asked || m.rev === rev) return;
        rev = m.rev;
        const redraw = touchesWhatWasRead(changedKeys(m));
        apply(m);
        if (redraw) onChange();
      })
      .catch(() => {});
  });
}
