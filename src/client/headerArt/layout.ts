/**
 * Where the header artwork may go. The header runs from 350 × 476 on a phone to 1816 × 135 on a wide
 * screen, and its cards move with the width and the system, so the picture is laid out against what is
 * actually drawn there: the land stays a thin line under the content and climbs where the header is free,
 * and the sky keeps calm behind every block and line of text.
 */
import { clamp } from "./maths";

/** A box something is drawn in, in the header's own pixels: left, top, right, bottom. */
export type Rect = [number, number, number, number];

export interface Layout {
  w: number;
  h: number;
  /** What is drawn in the header (cards, pills, borders, runs of bare text). */
  taken: Rect[];
}

/** Every box laid out in the header and every run of bare text. */
export function drawnRects(host: HTMLElement, art: Element): Rect[] {
  const box = host.getBoundingClientRect();
  const out: Rect[] = [];
  const add = (r: DOMRect) => out.push([r.left - box.left, r.top - box.top, r.right - box.left, r.bottom - box.top]);
  /*
    What lies over the header rather than in it is not layout (owner, 2026-11-16: opening Notices made the plants
    vanish and come back): a menu, the Notices list, a search dropdown, a badge. They are drawn over the picture
    like over anything else, so they and everything inside them are passed over.
  */
  let over: Element | null = null;
  for (const el of host.querySelectorAll<HTMLElement>("*")) {
    if (el === art || art.contains(el)) continue;
    if (over?.contains(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.position === "absolute" || cs.position === "fixed") {
      over = el;
      continue;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (cs.visibility === "hidden") continue;
    if (cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none" || parseFloat(cs.borderTopWidth) > 0) {
      add(r);
      continue;
    }
    // Bare text: the text itself, not its box (a full-width line with a few words on the left).
    for (const n of el.childNodes) {
      if (n.nodeType !== Node.TEXT_NODE || !n.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const t = range.getBoundingClientRect();
      if (t.width > 0) add(t);
    }
  }
  return out;
}

/**
 * How high the land may rise at each column: under the content a thin line, in the free part it climbs.
 * Worn down by more than the smoothing spreads, so the smooth line never rises into a block.
 */
export function envelope(L: Layout): { env: Float32Array; cap: number } {
  const W = Math.ceil(L.w) + 1;
  const cap = clamp(L.h * 0.44, 26, 118);
  const e = new Float32Array(W).fill(cap);
  for (const [l, , r, b] of L.taken) {
    const lim = clamp(L.h - b - 5, 3, cap);
    for (let x = Math.max(0, Math.floor(l - 10)); x <= Math.min(W - 1, Math.ceil(r + 10)); x++) if (lim < e[x]!) e[x] = lim;
  }
  const WEAR = 60;
  const worn = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let m = cap;
    for (let k = Math.max(0, x - WEAR); k <= Math.min(W - 1, x + WEAR); k++) if (e[k]! < m) m = e[k]!;
    worn[x] = m;
  }
  const box = (src: Float32Array, R: number): Float32Array => {
    const out = new Float32Array(W);
    let sum = 0;
    let n = 0;
    for (let x = -R; x < W; x++) {
      const add = x + R;
      if (add < W) {
        sum += src[Math.max(0, add)]!;
        n++;
      }
      const rem = x - R - 1;
      if (rem >= 0) {
        sum -= src[rem]!;
        n--;
      }
      if (x >= 0) out[x] = sum / n;
    }
    return out;
  };
  return { env: box(box(worn, 28), 28), cap };
}

/** The largest empty rectangle above the land (a grid of 6 px cells), leaning right: where a sky subject is aimed. */
export function freeRect(L: Layout, env: Float32Array): { x: number; y: number; w: number; h: number } | null {
  const C = 6;
  const cols = Math.floor(L.w / C);
  const rows = Math.floor(L.h / C);
  if (cols < 1 || rows < 1) return null;
  const occ = new Uint8Array(cols * rows);
  for (const [l, t, r, b] of L.taken)
    for (let cy = Math.max(0, Math.floor((t - 10) / C)); cy <= Math.min(rows - 1, Math.floor((b + 10) / C)); cy++)
      for (let cx = Math.max(0, Math.floor((l - 12) / C)); cx <= Math.min(cols - 1, Math.floor((r + 12) / C)); cx++) occ[cy * cols + cx] = 1;
  for (let cx = 0; cx < cols; cx++) {
    const top = L.h - env[Math.min(env.length - 1, cx * C + 3)]! * 0.5;
    for (let cy = Math.max(0, Math.floor(top / C)); cy < rows; cy++) occ[cy * cols + cx] = 1;
  }
  const hist = new Int32Array(cols);
  let best: { x: number; y: number; w: number; h: number } | null = null;
  let score = 0;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) hist[cx] = occ[cy * cols + cx] ? 0 : hist[cx]! + 1;
    const st: number[] = [];
    for (let cx = 0; cx <= cols; cx++) {
      const cur = cx < cols ? hist[cx]! : 0;
      while (st.length && hist[st[st.length - 1]!]! >= cur) {
        const hh = hist[st.pop()!]!;
        const left = st.length ? st[st.length - 1]! + 1 : 0;
        const ww = cx - left;
        if (hh * C < 26 || ww * C < 60) continue;
        const sc = Math.min(ww, hh * 5) * hh * (0.55 + 0.45 * ((left + ww / 2) / cols));
        if (sc > score) {
          score = sc;
          best = { x: left * C, y: (cy - hh + 1) * C, w: ww * C, h: hh * C };
        }
      }
      st.push(cx);
    }
  }
  return best;
}
