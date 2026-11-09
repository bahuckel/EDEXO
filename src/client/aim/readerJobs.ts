/**
 * What the screen marker's readers ask of their worker (readerWorker.ts, plan §4.3.5 / Fable review: the readers took
 * 10-350 ms a frame on the page's own thread, four times a second, and the marks froze meanwhile). Pure: pixels and
 * the reader's state in, the reading out; the state (learned colours, misses, where the label was) stays with the
 * capture. Also run on the page when the worker cannot start (readerThread.ts).
 */
import { readHudHeading, readHudPitchAnyColour, type PitchColours } from "@shared/hudPitchReader";
import { readTargetDistanceAnyColour, type Rgb } from "@shared/hudTargetDistance";
import { HUD_PITCH_GLYPHS } from "@shared/hudPitchGlyphs";
import { HUD_PITCH_GLYPHS_ANY } from "@shared/hudPitchGlyphsAny";
import { HUD_DISTANCE_GLYPHS } from "@shared/hudDistanceGlyphs";
import { HUD_DISTANCE_GLYPHS_ORANGE } from "@shared/hudDistanceGlyphsOrange";

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
}
export interface HeadingJob {
  kind: "heading";
  px: Uint8ClampedArray;
  w: number;
  h: number;
  ox: number;
  oy: number;
  screen: Screen;
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

export function runReaderJob<J extends ReaderJob>(job: J): ReaderResult<J>;
export function runReaderJob(job: ReaderJob): PitchResult | HeadingResult | DistanceResult {
  switch (job.kind) {
    case "pitch":
      return readHudPitchAnyColour(job.px, job.w, job.h, HUD_PITCH_GLYPHS, HUD_PITCH_GLYPHS_ANY, job.screen, job.colours, job.discover, job.hint);
    case "heading":
      return readHudHeading(job.px, job.w, job.h, HUD_PITCH_GLYPHS, { ox: job.ox, oy: job.oy, screen: job.screen });
    case "distance":
      return readTargetDistanceAnyColour(job.px, job.w, job.h, HUD_DISTANCE_GLYPHS, job.screenH, job.colour, HUD_DISTANCE_GLYPHS_ORANGE, job.hint);
  }
}
