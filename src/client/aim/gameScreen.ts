/**
 * The game's monitor as a video, for the readers in the screen marker's page (pitchCapture.ts, distanceCapture.ts):
 * one capture shared while either wants it, stopped when the last lets go. Windows' own capture through Electron: the
 * main process hands this page that one screen and nothing else (aimWindow.cjs). Nothing is kept, nothing leaves the PC.
 */

import type { HudColourMatrix } from "@shared/hudColourMatrix";

/** Which reader a crop is for: each brings the commander's HUD colours back to its own part of the default look. */
export type HudReaderName = "distance" | "pitch";

type Bridge = { getAimCaptureSource?: () => Promise<string | null> };

/**
 * The launcher's HUD colours choice, per reader (main.tsx sets it): the inverse of GraphicsConfigurationOverride.xml's
 * matrix. Nothing for the default look. Applied in the reader's worker with the job (readerJobs.ts), not here on the
 * page's thread, where it took 7.5 ms a read at 1440p and 16 ms at 4K (review 2026-11-10 E7).
 */
let recolour: Partial<Record<HudReaderName, HudColourMatrix | null>> = {};
export function setHudRecolour(next: Partial<Record<HudReaderName, HudColourMatrix | null>>): void {
  recolour = next;
}
/** The matrix a reader's crops are to be put through, or null. */
export function hudRecolourFor(reader: HudReaderName): HudColourMatrix | null {
  return recolour[reader] ?? null;
}

export interface GameScreen {
  /** The capture's size, pixels (0 until the first frame). */
  width(): number;
  height(): number;
  /** RGBA pixels of a part of the screen as captured (hudRecolourFor says what to undo); null without a frame. */
  crop(x: number, y: number, w: number, h: number): Uint8ClampedArray | null;
  /** Let go; the capture stops when nobody holds it. */
  release(): void;
}

/** The open capture; `dead` once its track ended (the screen gone, the capture stopped by Windows or the driver). */
type Shared = { video: HTMLVideoElement; stream: MediaStream; users: number; dead: boolean };
let shared: Shared | null = null;
/** After a capture failed to open again, no new try before this (ms since epoch): a crop is asked four times a second. */
let reopenAfter = 0;
const REOPEN_PAUSE_MS = 5000;
let opening: Promise<{ video: HTMLVideoElement; stream: MediaStream } | { error: string }> | null = null;

/**
 * Open the screen by id (getDisplayMedia would need a click, and this window is click-through), full size (Chromium
 * can shrink a desktop capture without a maximum, and the glyphs are full-size ones).
 */
async function open(): Promise<{ video: HTMLVideoElement; stream: MediaStream } | { error: string }> {
  const bridge = (window as unknown as { edexoElectron?: Bridge }).edexoElectron;
  if (!bridge?.getAimCaptureSource) return { error: "needs the desktop app" };
  let stream: MediaStream;
  try {
    const id = await bridge.getAimCaptureSource();
    if (!id) return { error: "no screen found" };
    // Electron's desktop capture by id (Chromium's own constraint names).
    const video = {
      mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: id, maxFrameRate: 5, maxWidth: 7680, maxHeight: 4320 },
    } as unknown as MediaTrackConstraints;
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
  } catch (e) {
    return { error: e instanceof Error ? e.name || e.message : String(e) };
  }
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    return { error: e instanceof Error ? e.name || e.message : "video" };
  }
  return { video, stream };
}

/** The shared capture, opened when there is none. */
async function sharedScreen(): Promise<Shared | { error: string }> {
  if (!shared) {
    // Two asking at once wait for the same opening, and share what it opens.
    opening ??= open().finally(() => {
      opening = null;
    });
    const got = await opening;
    if ("error" in got) return got;
    if (!shared) {
      const s: Shared = { ...got, users: 0, dead: false };
      shared = s;
      /*
        A track that ends (review 2026-11-10 E3) left the video on its last frame, read again four times a second as if
        it were fresh. Now the capture is dropped; the readers holding it open a new one on their next crop.
      */
      for (const t of got.stream.getVideoTracks()) {
        t.addEventListener("ended", () => {
          s.dead = true;
          s.video.srcObject = null;
          if (shared === s) shared = null;
        });
      }
    }
  }
  return shared!;
}

/** Hold the game's screen; resolves `{ error }` when the capture cannot start (shown on the reader's status line). */
export async function acquireGameScreen(): Promise<GameScreen | { error: string }> {
  const first = await sharedScreen();
  if ("error" in first) return first;
  let s = first;
  s.users++;
  /*
    One canvas, grown to the largest crop asked for (review 2026-11-10 E7): one per crop size was kept before, and the
    distance reader's crop near the last reading changes size as the label moves, up to ~65 MB of canvases at 1440p.
  */
  let canvas: OffscreenCanvas | null = null;
  let released = false;
  let reopening = false;
  /** The capture ended: a new one, in the background; no frame until it is there. */
  const reopen = () => {
    if (reopening || Date.now() < reopenAfter) return;
    reopening = true;
    void sharedScreen().then((next) => {
      reopening = false;
      if ("error" in next) {
        reopenAfter = Date.now() + REOPEN_PAUSE_MS;
        return;
      }
      if (released) return;
      s.users--;
      s = next;
      s.users++;
    });
  };
  return {
    width: () => (s.dead ? 0 : s.video.videoWidth),
    height: () => (s.dead ? 0 : s.video.videoHeight),
    crop(x, y, w, h) {
      if (released) return null;
      if (s.dead) {
        reopen();
        return null;
      }
      if (!s.video.videoWidth || w <= 0 || h <= 0) return null;
      if (!canvas) canvas = new OffscreenCanvas(w, h);
      else if (canvas.width < w || canvas.height < h) {
        canvas.width = Math.max(canvas.width, w);
        canvas.height = Math.max(canvas.height, h);
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(s.video, x, y, w, h, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h).data;
    },
    release() {
      if (released) return;
      released = true;
      s.users--;
      if (s.users > 0 || shared !== s) return;
      s.stream.getTracks().forEach((t) => t.stop());
      s.video.srcObject = null;
      shared = null;
    },
  };
}
