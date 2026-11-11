/**
 * The launcher's pitch reader, in the screen marker's page (owner, 2026-11-04: "use the on-screen data locally …
 * re-adjust the angle every 2 seconds"; then "use only the on-screen data … updated live"). The game's monitor
 * (gameScreen.ts, shared with the distance reader) read four times a second while there are plants to point at, the
 * middle of it for the HUD's pitch boxes (shared/hudPitchReader.ts) and the number posted to this PC's own server.
 * Nothing is kept, nothing leaves the PC. A frame it cannot read posts "not read": the marker keeps its own estimate.
 */
import type { PitchColours } from "@shared/hudPitchReader";
import { watchEdhmHint } from "./edhmHint";
import { acquireGameScreen, hudRecolourFor } from "./gameScreen";
import { readEvery, startReaderThread } from "./readerThread";

/** How often a frame is read. */
export const READ_EVERY_MS = 250;
/** The middle share of the screen read, either way. */
const CROP = 0.4;
/** A recoloured HUD's learned colours are forgotten after this many frames unread (2 s), and looked for again. */
const FORGET_COLOURS_AFTER = 8;
/** Unread, the colours are looked for on every this many frames (once a second): finding them doubles a frame's time. */
const DISCOVER_EVERY = 4;

export interface PitchCapture {
  stop(): void;
}

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

/**
 * Start reading; `onRead` gets each result (null: not read). Resolves `{ error }` when the capture cannot start (shown
 * on the status line).
 */
export async function startPitchCapture(onRead: (r: PitchRead | null) => void): Promise<PitchCapture | { error: string }> {
  const screen = await acquireGameScreen();
  if ("error" in screen) return screen;
  /*
    A recoloured HUD's box colours (owner 2026-11-07, EDHM: grey or white digits in a green box), learned from the
    screen: looked for while the default look does not read, then read in.
  */
  let colours: PitchColours | null = null;
  let misses = 0;
  /* EDHM's own colours for the boxes (server edhmColours.ts), a hint for finding them; null without EDHM. */
  let hint: PitchColours | null = null;
  const stopEdhm = watchEdhmHint((e) => {
    hint = e ? { text: e.pitchText, frame: e.pitchFrame } : null;
  });
  /* The reading itself in a worker (readerThread.ts): the marks keep moving while a frame is read. */
  const thread = startReaderThread();
  let stopped = false;
  /** The heading off the tape strip of the frame (its own small crop). */
  const readHeading = async (vw: number, vh: number): Promise<number | null> => {
    const tx = Math.round(vw * TAPE.x0);
    const ty = Math.round(vh * TAPE.y0);
    const tw = Math.round(vw * (TAPE.x1 - TAPE.x0));
    const th = Math.round(vh * (TAPE.y1 - TAPE.y0));
    const px = screen.crop(tx, ty, tw, th);
    if (!px) return null;
    const hd = await thread.run({ kind: "heading", px, w: tw, h: th, ox: tx, oy: ty, screen: { w: vw, h: vh }, recolour: hudRecolourFor("pitch") });
    return hd ? hd.headingDeg : null;
  };
  const read = async () => {
    const vw = screen.width();
    const vh = screen.height();
    if (!vw || !vh) return onRead(null);
    const cw = Math.round(vw * CROP);
    const ch = Math.round(vh * CROP);
    const cx0 = (vw - cw) / 2;
    const cy0 = (vh - ch) / 2;
    const px = screen.crop(cx0, cy0, cw, ch);
    if (!px) return onRead(null);
    const found = await thread.run({
      kind: "pitch",
      px,
      w: cw,
      h: ch,
      screen: { w: vw, h: vh },
      colours,
      discover: misses % DISCOVER_EVERY === 0,
      hint,
      recolour: hudRecolourFor("pitch"),
    });
    if (stopped) return;
    const r = found?.reading ?? null;
    if (found) colours = found.colours;
    misses = r ? 0 : misses + 1;
    if (misses >= FORGET_COLOURS_AFTER) colours = null;
    if (!r) return onRead(null);
    const headingDeg = await readHeading(vw, vh);
    if (stopped) return;
    onRead({
      pitchDeg: r.pitchDeg,
      rollDeg: r.rollDeg,
      pxPerDeg: r.pxPerDeg,
      screenH: vh,
      headingDeg,
      centre: { fx: (r.centre.x + cx0) / vw, fy: (r.centre.y + cy0) / vh },
    });
  };
  const timer = readEvery(READ_EVERY_MS, () =>
    read().catch(() => {
      if (!stopped) onRead(null);
    }),
  );
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      thread.stop();
      stopEdhm();
      screen.release();
    },
  };
}
