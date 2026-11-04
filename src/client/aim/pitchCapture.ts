/**
 * The launcher's pitch reader, in the screen marker's page (owner, 2026-11-04: "use the on-screen data locally …
 * re-adjust the angle every 2 seconds"; then "use only the on-screen data … updated live"). A capture of the game's monitor (Windows' own, through Electron: the main
 * process hands this page that one screen and nothing else, aimWindow.cjs), one frame every 2 s while there are plants
 * to point at, the middle of it read for the HUD's pitch boxes (shared/hudPitchReader.ts) and the number posted to this
 * PC's own server. Nothing is kept, nothing leaves the PC. A frame it cannot read posts "not read": the marker keeps
 * its own estimate.
 */
import { readHudHeading, readHudPitch } from "@shared/hudPitchReader";
import { HUD_PITCH_GLYPHS } from "@shared/hudPitchGlyphs";

/** How often a frame is read. */
export const READ_EVERY_MS = 250;
/** The middle share of the screen read, either way. */
const CROP = 0.4;

export interface PitchCapture {
  stop(): void;
}

type Bridge = { getAimCaptureSource?: () => Promise<string | null> };

/**
 * Start reading; `onRead` gets each result (null: not read). Resolves `{ error }` when the capture cannot start (shown
 * on the status line). The game monitor's capture id comes from the main process, to this page only; the screen is
 * opened by id (getDisplayMedia would need a click, and this window is click-through).
 */
/** One reading: the pitch (to a tenth from the ladder), the roll, and the screen's pixels per degree when measured. */
export interface PitchRead {
  pitchDeg: number;
  rollDeg: number;
  pxPerDeg: number | null;
  /** The captured screen's height, pixels (pxPerDeg is in its pixels). */
  screenH: number;
  /** The heading off the HUD's tape (to about a degree, live), null when its box was not read. */
  headingDeg: number | null;
  /** The HUD's centre (where the nose points) as shares of the screen's width and height. */
  centre: { fx: number; fy: number };
}

/** The heading tape's strip: the top of the HUD, round the centre line (share of the screen). */
const TAPE = { x0: 0.38, x1: 0.62, y0: 0.2, y1: 0.34 };

export async function startPitchCapture(onRead: (r: PitchRead | null) => void): Promise<PitchCapture | { error: string }> {
  const bridge = (window as unknown as { edexoElectron?: Bridge }).edexoElectron;
  if (!bridge?.getAimCaptureSource) return { error: "needs the desktop app" };
  let stream: MediaStream;
  try {
    const id = await bridge.getAimCaptureSource();
    if (!id) return { error: "no screen found" };
    // Electron's desktop capture by id (Chromium's own constraint names).
    // Full size (Chromium can shrink a desktop capture without a maximum, and the glyphs are full-size ones).
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
  let canvas: OffscreenCanvas | null = null;
  let tape: OffscreenCanvas | null = null;
  /** The heading off the tape strip of the frame (its own small crop). */
  const readHeading = (vw: number, vh: number): number | null => {
    const tx = Math.round(vw * TAPE.x0);
    const ty = Math.round(vh * TAPE.y0);
    const tw = Math.round(vw * (TAPE.x1 - TAPE.x0));
    const th = Math.round(vh * (TAPE.y1 - TAPE.y0));
    if (!tape || tape.width !== tw || tape.height !== th) tape = new OffscreenCanvas(tw, th);
    const tctx = tape.getContext("2d", { willReadFrequently: true });
    if (!tctx) return null;
    tctx.drawImage(video, tx, ty, tw, th, 0, 0, tw, th);
    const hd = readHudHeading(tctx.getImageData(0, 0, tw, th).data, tw, th, HUD_PITCH_GLYPHS, { ox: tx, oy: ty, screen: { w: vw, h: vh } });
    return hd ? hd.headingDeg : null;
  };
  const read = () => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return onRead(null);
    const cw = Math.round(vw * CROP);
    const ch = Math.round(vh * CROP);
    if (!canvas || canvas.width !== cw || canvas.height !== ch) canvas = new OffscreenCanvas(cw, ch);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return onRead(null);
    ctx.drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, cw, ch);
    const px = ctx.getImageData(0, 0, cw, ch).data;
    const r = readHudPitch(px, cw, ch, HUD_PITCH_GLYPHS, { w: vw, h: vh });
    const cx0 = (vw - cw) / 2;
    const cy0 = (vh - ch) / 2;
    onRead(
      r
        ? {
            pitchDeg: r.pitchDeg,
            rollDeg: r.rollDeg,
            pxPerDeg: r.pxPerDeg,
            screenH: vh,
            headingDeg: readHeading(vw, vh),
            centre: { fx: (r.centre.x + cx0) / vw, fy: (r.centre.y + cy0) / vh },
          }
        : null,
    );
  };
  const timer = setInterval(read, READ_EVERY_MS);
  return {
    stop() {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
