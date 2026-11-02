"use strict";

/*
  The HUD windows' pure parts (hudWindows.cjs requires and re-exports them; moved out, audit 2026-10-22): one
  reading of an overlay request for the IPC handlers and the HTTP bridge, a saved free spot, and the stack's
  columns. No Electron, no state, so tests can call them as they are.
*/

/** The space between two HUD windows in a stack (px). */
const HUD_STACK_GAP = 6;

/*
  An overlay window is transparent, so any height it has beyond its content reads as empty space
  between it and the next one — the owner's "spacing between them is too large" was mostly windows
  bigger than what they were drawing. They ask to be resized to their own content instead, which
  also fixes the opposite failure: the distance HUD grew a radar and was being cut off by a window
  sized before the radar existed.
*/
const HUD_MIN_HEIGHT = 90;
/*
  A sanity cap on what a page may ask for; the real one is the screen it is on (relayout). It was 900,
  which cut the merged HUD at a large scale on a 4K screen with no sign of it (plan 2.1, Fable C12).
*/
const HUD_MAX_HEIGHT = 2400;

/*
  One reading of an overlay request, shared by the IPC handlers and the HTTP bridge.

  Both doors take the same `{ pathname, width, height }` and must agree on every default, so they
  call these rather than each repeating the coercion. Two copies of a default is how one of them
  quietly stops matching the other.
*/
const HUD_DEFAULT_PATH = "/distance-overlay.html";
const HUD_DEFAULT_WIDTH = 404;
const HUD_DEFAULT_HEIGHT = 330;

function hudPathFrom(opts, fallback = HUD_DEFAULT_PATH) {
  const o = opts && typeof opts === "object" ? opts : {};
  const raw = typeof o.pathname === "string" && o.pathname.trim() ? o.pathname.trim() : fallback;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

/*
  Bounded (combined plan 1.7): these come from the launcher and, with LAN access on, from paired
  devices through /api/hud/overlay/*, and the width is saved in hud-layout.json. An absurd one made
  every HUD that wide, after a restart too.
*/
const HUD_MIN_WIDTH = 200;
const HUD_MAX_WIDTH = 1600;

function hudWidthFrom(opts) {
  const n = Number(opts && typeof opts === "object" ? opts.width : NaN);
  return Number.isFinite(n) && n > 0 ? Math.max(HUD_MIN_WIDTH, Math.min(HUD_MAX_WIDTH, Math.floor(n))) : HUD_DEFAULT_WIDTH;
}

function hudHeightFrom(opts) {
  const n = Number(opts && typeof opts === "object" ? opts.height : NaN);
  return Number.isFinite(n) && n > 0 ? Math.max(HUD_MIN_HEIGHT, Math.min(HUD_MAX_HEIGHT, Math.floor(n))) : HUD_DEFAULT_HEIGHT;
}

/**
 * The slot identity: the page, not its query string (the merged HUD changes sections via the query) — except a
 * chained group's `g`, so several groups can be open at once (owner, 2026-11-01: chain two panels into one).
 */
function hudSlotKey(pathNorm) {
  const [page, query = ""] = String(pathNorm).split("?");
  const g = /(?:^|&)g=(\d+)/.exec(query);
  return g ? `${page}?g=${g[1]}` : page;
}

/*
  Chained HUDs (owner, 2026-11-01: "if two panels of HUD are close to each other, a 'chain' button appears there,
  allowing you to click it and merge only those panels ... Merging is dependent on their initial order"). A group is
  the merged page with only its sections and an id: /hud-overlay.html?s=jump,fss&g=2. The section of each separate
  page is the launcher's table (src/client/launcher/hudOverlays.js HUD_SECTION_BY_PATH; tests/hudChain.test.ts keeps
  the two equal).
*/
const HUD_MERGED_PAGE = "/hud-overlay.html";
const HUD_SECTION_BY_PATH = {
  "/jump-overlay.html": "jump",
  "/fss-scan-overlay.html": "fss",
  "/exo-candidates-overlay.html": "candidates",
  "/distance-overlay.html": "distance",
  "/data-value-overlay.html": "datavalue",
  "/achievement-overlay.html": "achievement",
  "/notable-overlay.html": "notable",
  "/notices-overlay.html": "notices",
  "/colonize-overlay.html": "colonize",
  "/ship-overlay.html": "ship",
  "/carrier-overlay.html": "carrier",
};
const HUD_PATH_BY_SECTION = Object.fromEntries(Object.entries(HUD_SECTION_BY_PATH).map(([p, s]) => [s, p]));

/** The sections a window shows: its own one, or the merged page's `s` (every section when absent). */
function hudSectionsOf(pathNorm) {
  const [page, query = ""] = String(pathNorm).split("?");
  if (page !== HUD_MERGED_PAGE) return HUD_SECTION_BY_PATH[page] ? [HUD_SECTION_BY_PATH[page]] : [];
  const m = /(?:^|&)s=([^&]*)/.exec(query);
  const all = Object.values(HUD_SECTION_BY_PATH);
  if (!m) return all;
  return decodeURIComponent(m[1]).split(",").filter((x) => all.includes(x));
}

/** A chained group's id, or null for any other window. */
function hudGroupOf(pathNorm) {
  const query = String(pathNorm).split("?")[1] || "";
  const g = /(?:^|&)g=(\d+)/.exec(query);
  return g ? Number(g[1]) : null;
}

/** The page of a group: its sections in the order given, and its id. */
function hudGroupPath(sections, g) {
  return `${HUD_MERGED_PAGE}?s=${sections.join(",")}&g=${g}`;
}

/** Pixels between two HUDs' edges for them to count as touching (a drop by hand lands a little apart). */
const HUD_CHAIN_GAP = 40;

/**
 * Which HUDs touch, for the chain buttons: for each window, the one right below it (`below`) and the one right of it
 * (`right`), by key; the nearest when several are. `rects`: { key, x, y, width, height } in screen pixels.
 */
function hudChainOffers(rects) {
  const out = {};
  const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  for (const a of rects) {
    let below = null;
    let right = null;
    for (const b of rects) {
      if (b === a) continue;
      const dy = b.y - (a.y + a.height);
      if (dy >= -HUD_CHAIN_GAP && dy <= HUD_CHAIN_GAP && overlap(a.x, a.x + a.width, b.x, b.x + b.width) >= 0.5 * Math.min(a.width, b.width)) {
        if (!below || Math.abs(dy) < below.d) below = { key: b.key, d: Math.abs(dy) };
      }
      const dx = b.x - (a.x + a.width);
      if (dx >= -HUD_CHAIN_GAP && dx <= HUD_CHAIN_GAP && overlap(a.y, a.y + a.height, b.y, b.y + b.height) >= 0.3 * Math.min(a.height, b.height)) {
        if (!right || Math.abs(dx) < right.d) right = { key: b.key, d: Math.abs(dx) };
      }
    }
    out[a.key] = { below: below ? below.key : null, right: right ? right.key : null };
  }
  return out;
}

/** A saved free spot, or null when it is not one (a hand-edited file). */
function freePointFrom(v) {
  if (!v || typeof v !== "object") return null;
  const x = Number(v.x);
  const y = Number(v.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e5 || Math.abs(y) > 1e5) return null;
  return { x: Math.round(x), y: Math.round(y), bottom: v.bottom === true };
}

/**
 * The unmerged HUDs' own spots, by page key (owner, 2026-11-01: "When the HUD is not merged, every module is moved
 * separately in the free move mode"): each a free spot as above; anything else dropped. At most 16 (the stack's cap).
 */
function freeEachFrom(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out = {};
  for (const [k, p] of Object.entries(v).slice(0, 16)) {
    const f = freePointFrom(p);
    if (typeof k === "string" && k.startsWith("/") && f) out[k] = f;
  }
  return out;
}

/*
  A stack taller than its screen goes on in a second column beside the first (owner, 2026-10-04: on a
  125 % screen every panel is a quarter taller, the stack ran past the bottom and the windows down
  there were pushed up over the ones above). Each column holds what fits in `room`; a window taller
  than that gets a column to itself. Returns the indexes, column by column.
*/
function splitIntoColumns(heights, room, gap = HUD_STACK_GAP) {
  const cols = [];
  let col = [];
  let used = 0;
  heights.forEach((h, i) => {
    if (h == null) return;
    const need = (col.length ? gap : 0) + h;
    if (col.length && used + need > room) {
      cols.push(col);
      col = [];
      used = 0;
    }
    used += (col.length ? gap : 0) + h;
    col.push(i);
  });
  if (col.length) cols.push(col);
  return cols;
}

/** The x of column `c`: the next one goes inwards, away from the screen edge it started at. */
function columnX(x0, c, w, area, leftwards, gap = HUD_STACK_GAP) {
  const step = (w + gap) * c * (leftwards ? -1 : 1);
  return Math.max(area.x, Math.min(x0 + step, area.x + area.width - w));
}

module.exports = {
  HUD_STACK_GAP,
  HUD_MIN_HEIGHT,
  HUD_MAX_HEIGHT,
  HUD_DEFAULT_PATH,
  HUD_DEFAULT_WIDTH,
  HUD_DEFAULT_HEIGHT,
  HUD_MIN_WIDTH,
  HUD_MAX_WIDTH,
  hudPathFrom,
  hudWidthFrom,
  hudHeightFrom,
  hudSlotKey,
  freePointFrom,
  freeEachFrom,
  HUD_MERGED_PAGE,
  HUD_SECTION_BY_PATH,
  HUD_PATH_BY_SECTION,
  hudSectionsOf,
  hudGroupOf,
  hudGroupPath,
  HUD_CHAIN_GAP,
  hudChainOffers,
  splitIntoColumns,
  columnX,
};
