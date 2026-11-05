/**
 * The game's monitor as a video, for the readers in the screen marker's page (pitchCapture.ts, distanceCapture.ts):
 * one capture shared while either wants it, stopped when the last lets go. Windows' own capture through Electron: the
 * main process hands this page that one screen and nothing else (aimWindow.cjs). Nothing is kept, nothing leaves the PC.
 */

type Bridge = { getAimCaptureSource?: () => Promise<string | null> };

export interface GameScreen {
  /** The capture's size, pixels (0 until the first frame). */
  width(): number;
  height(): number;
  /** RGBA pixels of a part of the screen; null without a frame. */
  crop(x: number, y: number, w: number, h: number): Uint8ClampedArray | null;
  /** Let go; the capture stops when nobody holds it. */
  release(): void;
}

let shared: { video: HTMLVideoElement; stream: MediaStream; users: number } | null = null;
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

/** Hold the game's screen; resolves `{ error }` when the capture cannot start (shown on the reader's status line). */
export async function acquireGameScreen(): Promise<GameScreen | { error: string }> {
  if (!shared) {
    // Two asking at once wait for the same opening, and share what it opens.
    opening ??= open().finally(() => {
      opening = null;
    });
    const got = await opening;
    if ("error" in got) return got;
    shared ??= { ...got, users: 0 };
  }
  const s = shared!;
  s.users++;
  // One canvas per crop size (the pitch reader reads two parts of each frame).
  const canvases = new Map<string, OffscreenCanvas>();
  let released = false;
  return {
    width: () => s.video.videoWidth,
    height: () => s.video.videoHeight,
    crop(x, y, w, h) {
      if (released || !s.video.videoWidth || w <= 0 || h <= 0) return null;
      const key = `${w}x${h}`;
      let canvas = canvases.get(key);
      if (!canvas) canvases.set(key, (canvas = new OffscreenCanvas(w, h)));
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
