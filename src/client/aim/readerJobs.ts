/**
 * What the screen marker's readers ask of their worker (readerWorker.ts, plan §4.3.5 / Fable review: the readers took
 * 10-350 ms a frame on the page's own thread, four times a second, and the marks froze meanwhile). Pure: pixels and
 * the reader's state in, the reading out; the state (learned colours, misses, where the label was) stays with the
 * capture. Also run on the page when the worker cannot start (readerThread.ts).
 */
import { readHudHeading, readHudPitchAnyColour, type PitchColours } from "@shared/hudPitchReader";
import { readTargetDistanceAnyColour, type Rgb } from "@shared/hudTargetDistance";
import { recolourRgba, type HudColourMatrix } from "@shared/hudColourMatrix";

/*
  The glyph tables, loaded by the jobs that use them (review 2026-11-10 E7): each reader has its own worker, and both
  workers parsed all four tables (1.13 MB of pitch, 0.53 MB of distance) where each needs its own two.
*/
let pitchTables: Promise<{ glyphs: typeof import("@shared/hudPitchGlyphs").HUD_PITCH_GLYPHS; any: typeof import("@shared/hudPitchGlyphsAny").HUD_PITCH_GLYPHS_ANY }> | null = null;
const loadPitchTables = () =>
  (pitchTables ??= Promise.all([import("@shared/hudPitchGlyphs"), import("@shared/hudPitchGlyphsAny")]).then(([p, a]) => ({
    glyphs: p.HUD_PITCH_GLYPHS,
    any: a.HUD_PITCH_GLYPHS_ANY,
  })));
let distanceTables: Promise<{ glyphs: typeof import("@shared/hudDistanceGlyphs").HUD_DISTANCE_GLYPHS; orange: typeof import("@shared/hudDistanceGlyphsOrange").HUD_DISTANCE_GLYPHS_ORANGE }> | null = null;
const loadDistanceTables = () =>
  (distanceTables ??= Promise.all([import("@shared/hudDistanceGlyphs"), import("@shared/hudDistanceGlyphsOrange")]).then(([d, o]) => ({
    glyphs: d.HUD_DISTANCE_GLYPHS,
    orange: o.HUD_DISTANCE_GLYPHS_ORANGE,
  })));

type Screen = { w: number; h: number };

export interface PitchJob {
  kind: "pitch";
  px: Uint8ClampedArray;
  w: number;
  h: number;
  screen: Screen;
  colours: PitchColours | null;
  discover: boolean;
  hint: PitchColours | null;
  /** The launcher's XML matrix to undo first (gameScreen hudRecolourFor), or null. */
  recolour?: HudColourMatrix | null;
}
export interface HeadingJob {
  kind: "heading";
  px: Uint8ClampedArray;
  w: number;
  h: number;
  ox: number;
  oy: number;
  screen: Screen;
  recolour?: HudColourMatrix | null;
}
export interface DistanceJob {
  kind: "distance";
  px: Uint8ClampedArray;
  w: number;
  h: number;
  screenH: number;
  colour: Rgb | null;
  hint: Rgb | null;
}
export type ReaderJob = PitchJob | HeadingJob | DistanceJob;

export type PitchResult = ReturnType<typeof readHudPitchAnyColour>;
export type HeadingResult = ReturnType<typeof readHudHeading>;
export type DistanceResult = ReturnType<typeof readTargetDistanceAnyColour>;
export type ReaderResult<J extends ReaderJob> = J extends PitchJob ? PitchResult : J extends HeadingJob ? HeadingResult : DistanceResult;

export function runReaderJob<J extends ReaderJob>(job: J): Promise<ReaderResult<J>>;
export async function runReaderJob(job: ReaderJob): Promise<PitchResult | HeadingResult | DistanceResult> {
  switch (job.kind) {
    case "pitch": {
      const t = await loadPitchTables();
      if (job.recolour) recolourRgba(job.px, job.recolour);
      return readHudPitchAnyColour(job.px, job.w, job.h, t.glyphs, t.any, job.screen, job.colours, job.discover, job.hint);
    }
    case "heading": {
      const t = await loadPitchTables();
      if (job.recolour) recolourRgba(job.px, job.recolour);
      return readHudHeading(job.px, job.w, job.h, t.glyphs, { ox: job.ox, oy: job.oy, screen: job.screen });
    }
    case "distance": {
      const t = await loadDistanceTables();
      return readTargetDistanceAnyColour(job.px, job.w, job.h, t.glyphs, job.screenH, job.colour, t.orange, job.hint);
    }
  }
}
