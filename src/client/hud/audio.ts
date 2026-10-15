import { HUD } from "./core";
import { pref } from "./theme";
import type { HudSnapshot } from "./types";

/* ============================================================== Audio cues =================== */
/*
  Two short tones, off by default (owner, 2026-09-13): one when the min-gap ring is cleared after
  a sample, a two-note chime when the third sample lands. Synthesised, no asset. The tracker's
  render calls `cueFromOverlay` with each snapshot and the cue fires on the edge, once.
*/
let audioCtx: AudioContext | null = null;
export function audioOn(): boolean {
  return pref("edexoHudAudio", "0") === "1";
}
function tone(freq: number, atMs: number, durMs: number, gain: number): void {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime + atMs / 1000;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start(t0);
  o.stop(t0 + durMs / 1000 + 0.02);
}
export function playCue(kind: "clear" | "third"): void {
  if (typeof HUD.onCue === "function") HUD.onCue(kind);
  if (!audioOn()) return;
  try {
    const w = window as Window & { webkitAudioContext?: typeof AudioContext };
    const AC = window.AudioContext || w.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended" && typeof audioCtx.resume === "function") void audioCtx.resume();
    if (kind === "clear") {
      tone(880, 0, 120, 0.18);
    } else if (kind === "third") {
      tone(660, 0, 140, 0.18);
      tone(990, 150, 220, 0.2);
    }
  } catch {
    /* no audio device, or the page is not allowed to play: the cue is optional */
  }
}
let cuePrev = { key: "", count: 0, clear: false };
export function cueFromOverlay(eo: HudSnapshot["exoOrganicOverlay"] | undefined): void {
  if (!eo || !eo.visible) {
    cuePrev = { key: "", count: 0, clear: false };
    return;
  }
  /*
    A frame that does not know how far the nearest plant is changes nothing.

    `nearestSampleMeetsMin` is null when there is no position to measure from. Treating that as
    "not far enough" armed the cue again, so the next frame that *did* know looked like a fresh
    crossing and played the tone — once per radar update rather than once per boundary. The server
    no longer manufactures those nulls (it stops reporting a fix lost to a torn read at all), and
    this makes the HUD indifferent to them whatever their source.
  */
  if (eo.nearestSampleMeetsMin == null && (eo.sampleCount === 1 || eo.sampleCount === 2)) return;
  // `bodyKeyOnFoot` is not on the overlay DTO, so this key has always been the species alone (kept as it was in the
  // port to React; the body would be `trackingBodyKey`).
  const key = String((eo as { bodyKeyOnFoot?: string }).bodyKeyOnFoot || "") + "|" + String(eo.speciesDisplay || "");
  const count = Math.max(0, Math.min(3, eo.sampleCount || 0));
  const clear = eo.nearestSampleMeetsMin === true && (count === 1 || count === 2);
  const same = key === cuePrev.key;
  if (same && count === 3 && cuePrev.count < 3) playCue("third");
  else if (same && clear && !cuePrev.clear && count === cuePrev.count) playCue("clear");
  cuePrev = { key, count, clear };
}
