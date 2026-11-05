/**
 * The motion level and the motion effects, without React: the app (motion.ts re-exports these) and the launcher (a
 * plain page) read the same switches, kept per PC in localStorage.
 *
 * Effects (owner 2026-11-05, "so the app feels a bit better and more premium"), each a switch in Options › Look ›
 * Motion, on by default; only the level "full" plays them, "reduced" and "off" never do:
 * - press: a button sinks to 95 % and springs back, a wave of triangles in the accent's hues runs from the click;
 * - pull: pull a list down at its top to refresh it, the list follows at 35 %;
 * - roll: numbers roll their digits into place, 100 ms apart;
 * - drag: the launcher's HUD order is dragged, the row lifts to 105 % and the others slide aside;
 * - expand: the "?" explanations open fast first, then slow (ease-out, 350 ms);
 * - tick: a circle, then a tick (470 ms) when the journal has loaded.
 *
 * `<html data-motion>` carries the level and `<html data-fx-off>` the effects switched off (space-separated), so CSS
 * keys on them: `html[data-motion="full"]:not([data-fx-off~="press"])`.
 */
export type MotionLevel = "full" | "reduced" | "off";
export type MotionFx = "press" | "pull" | "roll" | "drag" | "expand" | "tick";

export const MOTION_FX: { fx: MotionFx; label: string; note: string }[] = [
  { fx: "press", label: "Button press", note: "buttons sink and spring back, with a wave of triangles in the accent colour" },
  { fx: "expand", label: "Explanations open", note: "the ? explanations open fast first, then slow" },
  { fx: "roll", label: "Rolling numbers", note: "changed numbers roll their digits into place" },
  { fx: "tick", label: "Loaded tick", note: "a circle and a tick when the journal has loaded" },
  { fx: "drag", label: "Drag to reorder", note: "the launcher's HUD order: drag a row, the others slide aside" },
  { fx: "pull", label: "Pull to refresh", note: "pull a list down at its top (or scroll up past it) to refresh it" },
];

const KEY = "edexo.motion";
const FX_KEY = "edexo.motionFx.off";
export const MOTION_EVENT = "edexo:motion";

function systemPrefersLess(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function stored(): MotionLevel | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "full" || v === "reduced" || v === "off" ? v : null;
  } catch {
    return null;
  }
}

export function motionLevel(): MotionLevel {
  return stored() ?? (systemPrefersLess() ? "reduced" : "full");
}

function fxOffList(): MotionFx[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(FX_KEY) ?? "[]");
    return Array.isArray(v) ? MOTION_FX.map((f) => f.fx).filter((fx) => v.includes(fx)) : [];
  } catch {
    return [];
  }
}

/** The effect's switch (Options › Look › Motion), whatever the level. */
export function fxSwitchedOn(fx: MotionFx): boolean {
  return !fxOffList().includes(fx);
}

/** The effect plays: its switch is on and the level is "full". */
export function fxOn(fx: MotionFx): boolean {
  return motionLevel() === "full" && fxSwitchedOn(fx);
}

/** Puts the level and the switched-off effects on <html> (before the first paint) and keeps them there. */
export function applyMotion(): void {
  if (typeof document === "undefined") return;
  const set = () => {
    const html = document.documentElement;
    html.dataset.motion = motionLevel();
    const off = fxOffList();
    if (off.length) html.dataset.fxOff = off.join(" ");
    else delete html.dataset.fxOff;
  };
  set();
  window.addEventListener(MOTION_EVENT, set);
  // Another window of the app (or the launcher) changed it.
  window.addEventListener("storage", (e) => {
    if (e.key === KEY || e.key === FX_KEY) {
      set();
      window.dispatchEvent(new CustomEvent(MOTION_EVENT));
    }
  });
  if (typeof matchMedia === "function") matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", set);
}

export function setMotionLevel(level: MotionLevel): void {
  try {
    localStorage.setItem(KEY, level);
  } catch {
    /* storage blocked: this window, this session */
  }
  window.dispatchEvent(new CustomEvent(MOTION_EVENT));
}

export function setFxSwitchedOn(fx: MotionFx, on: boolean): void {
  const off = new Set(fxOffList());
  if (on) off.delete(fx);
  else off.add(fx);
  try {
    localStorage.setItem(FX_KEY, JSON.stringify([...off]));
  } catch {
    /* storage blocked */
  }
  window.dispatchEvent(new CustomEvent(MOTION_EVENT));
}
