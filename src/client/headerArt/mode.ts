/**
 * Options › Look › Header picture (plan-1.4.0 §6.3): how much of the header artwork shows. Kept per PC, like the
 * colour scheme and the motion level; every window of the app follows.
 *   turning  the whole picture, the sky turning once in 30 minutes (only while Motion is Full)
 *   still    the whole picture, the sky standing where the turn starts
 *   calm     stars and a low line of ground, nothing else
 *   off      no picture
 */
import { useSyncExternalStore } from "react";

export type HeaderArtMode = "turning" | "still" | "calm" | "off";

export const HEADER_ART_MODES: { mode: HeaderArtMode; label: string; note: string }[] = [
  { mode: "turning", label: "Turning", note: "the planet's surface under a sky that turns once in 30 minutes" },
  { mode: "still", label: "Still", note: "the same picture, the sky standing still" },
  { mode: "calm", label: "Calm", note: "stars and a low line of ground, nothing else" },
  { mode: "off", label: "Off", note: "no picture behind the header" },
];

const KEY = "edexo.headerArt";
export const HEADER_ART_EVENT = "edexo:header-art";

export function headerArtMode(): HeaderArtMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "turning" || v === "still" || v === "calm" || v === "off") return v;
  } catch {
    /* storage blocked: the default */
  }
  return "turning";
}

export function setHeaderArtMode(mode: HeaderArtMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* storage blocked: this window, this session */
  }
  window.dispatchEvent(new CustomEvent(HEADER_ART_EVENT));
}

function subscribe(cb: () => void): () => void {
  // Another window of the app changed it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) cb();
  };
  window.addEventListener(HEADER_ART_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(HEADER_ART_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useHeaderArtMode(): HeaderArtMode {
  return useSyncExternalStore(subscribe, headerArtMode, () => "turning");
}
