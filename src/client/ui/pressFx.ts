/**
 * M1 Button press (owner 2026-11-05): a button sinks to 95 % while held and springs back on release, and a pixelated
 * wave of small triangles in hues of the accent colour runs out from where it was pressed.
 *
 * One listener for the whole page (the app and the launcher), so every button through the shared classes gets it and
 * nothing is added to React's tree: the wave is a canvas laid over the button in <body>, clipped to the button's own
 * shape (its chamfer), never taking a click. Not on the galaxy map, list rows or the HUD overlays (those do not use
 * these classes or this page). Plays only when motionCore says so (Options › Look › Motion › Button press, level Full).
 */
import { fxOn } from "../motionCore";

const BUTTONS = ".btn, .btn-top-toggle, .btn-mini, .fdb-chip";
const DOWN_MS = 80;
const UP_MS = 460;
/** Overshoots a little and settles: the spring. */
const SPRING = "linear(0, 0.22 7%, 0.62 15%, 1.04 27%, 1.08 34%, 1.03 45%, 0.99 60%, 1)";
const WAVE_MS = 620;
/** Triangle edge, CSS px. */
const CELL = 7;

let installed = false;

export function installPressFx(doc: Document = document): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  doc.addEventListener("pointerdown", onDown, true);
}

function onDown(ev: PointerEvent): void {
  if (ev.button !== 0 || !fxOn("press")) return;
  const btn = (ev.target as Element | null)?.closest?.(BUTTONS);
  if (!(btn instanceof HTMLElement) || typeof btn.animate !== "function") return;
  if ((btn as HTMLButtonElement).disabled || btn.getAttribute("aria-disabled") === "true") return;
  const down = btn.animate([{ scale: "1" }, { scale: "0.95" }], { duration: DOWN_MS, easing: "ease-out", fill: "forwards" });
  const release = () => {
    window.removeEventListener("pointerup", release, true);
    window.removeEventListener("pointercancel", release, true);
    down.cancel();
    btn.animate([{ scale: "0.95" }, { scale: "1" }], { duration: UP_MS, easing: SPRING });
  };
  window.addEventListener("pointerup", release, true);
  window.addEventListener("pointercancel", release, true);
  wave(btn, ev.clientX, ev.clientY);
}

/** The accent as [r, g, b] from the button's own tokens (a themed region keeps its colour). */
function accentRgb(el: Element): [number, number, number] {
  const raw = getComputedStyle(el).getPropertyValue("--accent-rgb");
  const n = raw.match(/[\d.]+/g)?.map(Number) ?? [];
  return n.length >= 3 ? [n[0]!, n[1]!, n[2]!] : [255, 140, 0];
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

/** Small deterministic noise per cell, so the hues stay put while the wave runs. */
function noise(i: number, j: number): number {
  const x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function wave(btn: HTMLElement, x: number, y: number): void {
  const rect = btn.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return;
  const canvas = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.ceil(rect.width * dpr);
  canvas.height = Math.ceil(rect.height * dpr);
  const cs = getComputedStyle(btn);
  Object.assign(canvas.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    pointerEvents: "none",
    zIndex: "2147483000",
    clipPath: cs.clipPath,
    borderRadius: cs.borderRadius,
    mixBlendMode: "screen",
  } satisfies Partial<CSSStyleDeclaration>);
  canvas.setAttribute("aria-hidden", "true");
  canvas.className = "press-wave";
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  document.body.appendChild(canvas);
  ctx.scale(dpr, dpr);

  const [h, s, l] = rgbToHsl(accentRgb(btn));
  const ox = x - rect.left;
  const oy = y - rect.top;
  const reach = Math.hypot(Math.max(ox, rect.width - ox), Math.max(oy, rect.height - oy)) + CELL * 2;
  const rowH = (CELL * Math.sqrt(3)) / 2;
  const cols = Math.ceil(rect.width / (CELL / 2)) + 2;
  const rows = Math.ceil(rect.height / rowH) + 1;
  const start = performance.now();

  const frame = (now: number) => {
    const t = Math.min(1, (now - start) / WAVE_MS);
    const front = reach * (1 - (1 - t) ** 2.2);
    const band = CELL * 3;
    ctx.clearRect(0, 0, rect.width, rect.height);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        // Alternating up and down triangles tile the button.
        const up = (i + j) % 2 === 0;
        const cx = (i * CELL) / 2;
        const top = j * rowH;
        const mx = cx;
        const my = top + rowH / 2;
        const dist = Math.hypot(mx - ox, my - oy);
        const k = 1 - Math.abs(dist - front) / band;
        if (k <= 0) continue;
        const r = noise(i, j);
        const a = k * (1 - t) * (0.25 + r * 0.35);
        ctx.fillStyle = `hsla(${h + (r - 0.5) * 36}, ${s}%, ${Math.min(85, l + (r - 0.3) * 30)}%, ${a})`;
        ctx.beginPath();
        if (up) {
          ctx.moveTo(cx - CELL / 2, top + rowH);
          ctx.lineTo(cx, top);
          ctx.lineTo(cx + CELL / 2, top + rowH);
        } else {
          ctx.moveTo(cx - CELL / 2, top);
          ctx.lineTo(cx + CELL / 2, top);
          ctx.lineTo(cx, top + rowH);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
    if (t < 1) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
  // A window that stops drawing (minimised, hidden) stops the frames: the canvas still goes.
  window.setTimeout(() => canvas.remove(), WAVE_MS + 300);
}
