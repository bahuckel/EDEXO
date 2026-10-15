import type { ExoMinimapDTO } from "@shared/types";
import { esc } from "./core";

/*
  The radar (minimap) of the exo-distance tracker. It stays a small imperative island inside the React HUD: the
  tracker renders the <svg> element and nothing in it, and this module draws into it — the static rim once, the
  world layer on each fix — as public/hud/radar.js did. Rebuilding it through React would restart the sweep's CSS
  animation on every frame, which is what made it jerk before it was split into layers.
*/

type Minimap = ExoMinimapDTO;
type Mark = Minimap["marks"][number];
type RadarSvg = SVGSVGElement & { __staticBuilt?: boolean; __mmPredict?: PredictState };

/* ============================================================== Exo-distance tracker ======== */
/*
  Green is reserved for the run in progress. The game samples one species per planet at a time,
  so every other mark on this rock is a leftover from something the commander is no longer
  collecting. They still belong on the map -- they are places worth not walking back to -- but
  drawing them the same green is how you end up reading a Stratum mark as the Tussock you are
  three samples into. The colour is a hash of the species name, so a species keeps the same
  colour for as long as it is on screen, and no palette entry is green.
*/
export const LEFTOVER_COLOURS = ["#c9a227", "#b25fd0", "#3fa7d6", "#e06c4a", "#d05a86", "#5a8bd0", "#a8842c", "#8c6fd0"];
export function leftoverColour(label: string): string {
  let h = 0;
  const t = String(label || "");
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return LEFTOVER_COLOURS[h % LEFTOVER_COLOURS.length]!;
}

export const MAP_R = 100;
/*
  The radar has two layers. The rim, rings, crosshair and the rotating sweep never change and are
  built once; only the world (marks, ticks, North) is rebuilt on each snapshot. Rebuilding the whole
  SVG every 320 ms restarted the sweep's CSS animation every time, which is what made it jerk.
*/
function radarStatic(svg: RadarSvg): void {
  if (svg.__staticBuilt) return;
  svg.__staticBuilt = true;
  svg.innerHTML =
    '<defs><linearGradient id="hudSweepGrad" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0" stop-color="currentColor" stop-opacity="0"/>' +
    '<stop offset="1" stop-color="currentColor" stop-opacity="0.28"/></linearGradient>' +
    // The sample rings stop at the rim: a ring round a plant out of range still shows its near edge.
    '<clipPath id="hudRadarClip"><circle cx="0" cy="0" r="' +
    MAP_R +
    '"/></clipPath></defs>' +
    '<circle class="minimap-rim-outer" cx="0" cy="0" r="' +
    (MAP_R + 7) +
    '" />' +
    '<circle class="minimap-rim" cx="0" cy="0" r="' +
    MAP_R +
    '" />' +
    '<circle class="minimap-grid" cx="0" cy="0" r="' +
    MAP_R / 4 +
    '" />' +
    '<circle class="minimap-grid" cx="0" cy="0" r="' +
    MAP_R / 2 +
    '" />' +
    '<circle class="minimap-grid" cx="0" cy="0" r="' +
    (MAP_R * 3) / 4 +
    '" />' +
    '<line class="minimap-cross" x1="-' +
    MAP_R +
    '" y1="0" x2="' +
    MAP_R +
    '" y2="0" />' +
    '<line class="minimap-cross" x1="0" y1="-' +
    MAP_R +
    '" x2="0" y2="' +
    MAP_R +
    '" />' +
    '<path class="minimap-sweep" style="color:var(--hud)" d="M0,0 L' +
    MAP_R +
    ",0 A" +
    MAP_R +
    "," +
    MAP_R +
    " 0 0,0 0,-" +
    MAP_R +
    '" />' +
    '<g class="mm-world"></g><g class="mm-you"></g>';
}
function arcPath(r: number, a0: number, a1: number): string {
  const p = (a: number) => {
    const t = (a * Math.PI) / 180;
    return [(r * Math.cos(t)).toFixed(1), (r * Math.sin(t)).toFixed(1)];
  };
  const s = p(a0);
  const e = p(a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return "M" + s[0] + "," + s[1] + " A" + r + "," + r + " 0 " + large + ",1 " + e[0] + "," + e[1];
}
/**
 * Draw the world layer of the radar.
 *
 * Plot units are a 100-unit radius circle; metres are scaled into it. Anything beyond the radius
 * becomes an arrow on the rim with its distance beside it, which is the owner's rule and also the
 * only honest way to show it — clamping a 3 km plant to the edge as a dot would say it is 500 m
 * away. "Up" is the way the commander is facing when the game reports a heading. Without one it
 * stays north-up and the label stays visible so the difference is not silent.
 *
 * `hint` (optional): when the second sample would be too close, an arc on the min-gap ring facing
 * away from the first sample — the direction to walk. Nothing is drawn when the sample is not on
 * the map, because a guess would be worse than no arrow.
 */
function drawMinimapAt(svg: RadarSvg, mm: Minimap, hint: boolean): boolean {
  if (!mm || !mm.marks) return false;
  radarStatic(svg);
  const heading = typeof mm.headingDeg === "number" && isFinite(mm.headingDeg) ? mm.headingDeg : null;
  const rot = heading == null ? 0 : -heading; // rotating the scene by -heading puts "ahead" at the top
  const scale = MAP_R / (mm.radiusM > 0 ? mm.radiusM : 500);
  const parts: string[] = [];
  const minR = mm.minSampleDistanceM > 0 ? mm.minSampleDistanceM * scale : 0;
  /*
    A ring round each sample, its genus's sample distance across (owner, 2026-10-04: "a circle around
    each of the dots … so the user would know what the radius is and will not enter that circle").
    The next sample has to be outside every ring of its species. Until there is one, the ring round
    the commander still shows how far that is.
  */
  const ringed = mm.marks.some((m) => m.kind === "sample" && m.active && (m.ringM ?? 0) > 0);
  if (!ringed && minR > 0 && minR < MAP_R) {
    parts.push('<circle class="minimap-minring" cx="0" cy="0" r="' + minR.toFixed(1) + '" />');
  }
  parts.push('<g transform="rotate(' + rot.toFixed(2) + ')">');
  const rings: string[] = [];
  for (const s of mm.marks) {
    if (s.kind !== "sample" || !((s.ringM ?? 0) > 0)) continue;
    const sx = s.eastM * scale;
    const sy = -s.northM * scale;
    const sr = (s.ringM ?? 0) * scale;
    // Entirely off the radar: nothing to show.
    if (Math.sqrt(sx * sx + sy * sy) - sr > MAP_R) continue;
    rings.push(
      '<circle class="minimap-sample-ring' +
        (s.active ? "" : " minimap-sample-ring--left") +
        '" cx="' +
        sx.toFixed(1) +
        '" cy="' +
        sy.toFixed(1) +
        '" r="' +
        sr.toFixed(1) +
        '"' +
        (s.active ? "" : ' style="stroke:' + leftoverColour(s.label) + '"') +
        " />",
    );
  }
  if (rings.length) parts.push('<g clip-path="url(#hudRadarClip)">' + rings.join("") + "</g>");
  for (let t = 0; t < 360; t += 30) {
    const major = t % 90 === 0;
    parts.push(
      '<line class="minimap-tick' +
        (major ? " minimap-tick--major" : "") +
        '" x1="0" y1="-' +
        MAP_R +
        '" x2="0" y2="-' +
        (MAP_R + (major ? 7 : 4)) +
        '" transform="rotate(' +
        t +
        ')" />',
    );
  }
  let firstActive: { x: number; y: number } | null = null;
  for (const m of mm.marks) {
    const x = m.eastM * scale;
    const y = -m.northM * scale; // SVG y grows downward and north is up
    const r = Math.sqrt(x * x + y * y);
    const cls = m.kind === "ship" ? "ship" : "sample";
    if (m.kind === "sample" && m.active && !firstActive) firstActive = { x, y };
    const tint = m.kind === "sample" && !m.active ? ' style="fill:' + leftoverColour(m.label) + '"' : "";
    const title = "<title>" + esc(m.label) + " — " + Math.round(m.distanceM) + " m</title>";
    if (r <= MAP_R - 6) {
      if (m.kind === "ship") {
        parts.push(
          '<g transform="translate(' +
            x.toFixed(1) +
            "," +
            y.toFixed(1) +
            ") rotate(" +
            (-rot).toFixed(2) +
            ')"><polygon class="minimap-ship" points="0,-5.5 5,4.5 0,2.2 -5,4.5" />' +
            title +
            "</g>",
        );
      } else {
        parts.push(
          '<rect class="minimap-sample"' +
            tint +
            ' x="-3.2" y="-3.2" width="6.4" height="6.4" transform="translate(' +
            x.toFixed(1) +
            "," +
            y.toFixed(1) +
            ') rotate(45)">' +
            title +
            "</rect>",
        );
      }
    } else {
      const ang = (Math.atan2(y, x) * 180) / Math.PI;
      const ax = Math.cos((ang * Math.PI) / 180) * (MAP_R - 8);
      const ay = Math.sin((ang * Math.PI) / 180) * (MAP_R - 8);
      parts.push(
        '<g transform="translate(' +
          ax.toFixed(1) +
          "," +
          ay.toFixed(1) +
          ") rotate(" +
          ang.toFixed(1) +
          ')"><polygon class="minimap-arrow--' +
          cls +
          '"' +
          tint +
          ' points="7,0 -3,-4.5 -3,4.5" />' +
          title +
          "</g>",
      );
      parts.push(
        '<text class="minimap-far-label" x="' +
          (ax * 0.8).toFixed(1) +
          '" y="' +
          (ay * 0.8).toFixed(1) +
          '" text-anchor="middle" transform="rotate(' +
          (-rot).toFixed(2) +
          "," +
          (ax * 0.8).toFixed(1) +
          "," +
          (ay * 0.8).toFixed(1) +
          ')">' +
          Math.round(m.distanceM) +
          "</text>",
      );
    }
  }
  // The way to walk: the min-gap ring, on the side away from the first sample.
  if (hint && firstActive && minR > 0) {
    const away = (Math.atan2(firstActive.y, firstActive.x) * 180) / Math.PI + 180;
    const rr = Math.min(minR + 6, MAP_R - 4);
    parts.push('<path class="minimap-hint" d="' + arcPath(rr, away - 55, away + 55) + '" />');
    parts.push(
      '<polygon class="minimap-hint-arrow" transform="rotate(' +
        away.toFixed(1) +
        ") translate(" +
        (rr + 4).toFixed(1) +
        ',0)" points="0,-4 6,0 0,4" />',
    );
  }
  parts.push(
    '<text class="minimap-north" x="0" y="' +
      (-MAP_R + 13) +
      '" text-anchor="middle" transform="rotate(' +
      (-rot).toFixed(2) +
      ",0," +
      (-MAP_R + 13) +
      ')">NORTH</text>',
  );
  parts.push("</g>");
  svg.querySelector(".mm-world")!.innerHTML = parts.join("");
  svg.querySelector(".mm-you")!.innerHTML =
    heading == null
      ? '<circle class="minimap-you" cx="0" cy="0" r="3.5" />'
      : '<polygon class="minimap-you" points="0,-7.5 5,4.5 0,1.8 -5,4.5" />';
  return true;
}

/*
  ============================ the radar predicts forward ============================

  `Status.json` is the only place a position exists, and it changes about 0.33 times a second.
  Prediction (continuing the commander's motion between fixes) was built and is OFF on the owner's
  report after flying it (2026-09-21): "the radar dots keep drifting away when I move — make them
  fixed in place and updated dynamically without drifting." Position was predicted and heading
  deliberately was not, so turning while walking pushed the dots along the old bearing and every fix
  snapped them back. The machinery stays for the straight-line case; see public/hud/radar.js's history.
  With it off, each fix is drawn exactly as it arrives, which is also what prefers-reduced-motion does.
*/
export const PREDICT_ENABLED = false;
export const PREDICT_MAX_GAPS = 1.5;
export const PREDICT_MIN_GAP_MS = 200;
export const PREDICT_MAX_GAP_MS = 8000;
/** Below this the commander is standing still; predicting it only adds jitter. */
export const PREDICT_MIN_SPEED_M = 0.05;

interface PredictState {
  last: Minimap | null;
  at: number;
  gap: number;
  motion: { north: number; east: number } | null;
  raf: number;
  sig: string | null;
  hint: boolean;
}

const markKey = (m: Mark) => m.kind + "|" + m.label;

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function cloneMinimap(mm: Minimap): Minimap {
  return {
    radiusM: mm.radiusM,
    headingDeg: mm.headingDeg,
    minSampleDistanceM: mm.minSampleDistanceM,
    marks: mm.marks.map((m) => ({
      kind: m.kind,
      label: m.label,
      active: m.active,
      northM: m.northM,
      eastM: m.eastM,
      distanceM: m.distanceM,
      ringM: m.ringM,
    })),
  };
}

/** How far every mark moved between two fixes — the commander's movement, negated. */
function motionBetween(prev: Minimap, next: Minimap): { north: number; east: number } | null {
  const by: Record<string, Mark> = {};
  for (const m of prev.marks) by[markKey(m)] = m;
  const dN: number[] = [];
  const dE: number[] = [];
  for (const m of next.marks) {
    const p = by[markKey(m)];
    if (!p) continue;
    dN.push(m.northM - p.northM);
    dE.push(m.eastM - p.eastM);
  }
  if (!dN.length) return null;
  return { north: median(dN), east: median(dE) };
}

/** The radar as it should look `t` ms after the newest fix (heading is never predicted). */
function predictMinimap(st: PredictState, t: number): Minimap {
  const out = cloneMinimap(st.last!);
  const f = st.gap > 0 ? t / st.gap : 0;
  if (st.motion) {
    for (const m of out.marks) {
      m.northM += st.motion.north * f;
      m.eastM += st.motion.east * f;
      m.distanceM = Math.sqrt(m.northM * m.northM + m.eastM * m.eastM);
    }
  }
  return out;
}

let reduceMotion = false;
try {
  reduceMotion = !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
} catch {
  /* no matchMedia: predict, which is the better default */
}

/**
 * A fingerprint of the fix, so a re-render can be told from a new position: the tracker re-renders on every
 * snapshot push and hands over the same minimap each time, and only a change of position is a fix.
 */
function minimapSignature(mm: Minimap): string {
  let s = String(mm.headingDeg) + "|" + mm.radiusM + "|" + mm.minSampleDistanceM;
  for (const m of mm.marks) s += "|" + m.kind + ":" + m.label + ":" + m.northM + "," + m.eastM;
  return s;
}

const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

/**
 * Draw the radar (and, were prediction on, continue the commander's motion between fixes). State lives on the
 * SVG element so two radars cannot share a loop. False when there is no map to draw (off a surface).
 */
export function drawMinimap(svg: SVGSVGElement, mm: Minimap | null | undefined, hint: boolean): boolean {
  if (!mm || !mm.marks) return false;
  const el = svg as RadarSvg;
  let st = el.__mmPredict;
  if (!st) st = el.__mmPredict = { last: null, at: 0, gap: 0, motion: null, raf: 0, sig: null, hint };

  const t0 = now();
  const next = cloneMinimap(mm);
  const sig = minimapSignature(next);

  // A repeat of the fix already showing: keep it, but honour the newest `hint`, which changes on its own schedule.
  if (st.sig === sig && st.last) {
    st.hint = hint;
    if (!st.raf) {
      const held = st.gap > 0 ? Math.min(t0 - st.at, st.gap * PREDICT_MAX_GAPS) : 0;
      drawMinimapAt(el, st.motion ? predictMinimap(st, held) : st.last, hint);
    }
    return true;
  }

  const gap = st.last ? t0 - st.at : 0;
  if (!PREDICT_ENABLED || reduceMotion || !st.last || gap < PREDICT_MIN_GAP_MS || gap > PREDICT_MAX_GAP_MS) {
    st.motion = null;
  } else {
    const motion = motionBetween(st.last, next);
    const moved = motion ? Math.sqrt(motion.north * motion.north + motion.east * motion.east) : 0;
    st.motion = motion && moved >= PREDICT_MIN_SPEED_M ? motion : null;
    st.gap = gap;
  }

  st.last = next;
  st.at = t0;
  st.sig = sig;
  st.hint = hint;

  if (st.raf) {
    cancelAnimationFrame(st.raf);
    st.raf = 0;
  }
  // The newest fix is the truth: draw it, then start estimating forward from it.
  drawMinimapAt(el, next, hint);
  if (!st.motion) return true;

  const state = st;
  const limit = state.gap * PREDICT_MAX_GAPS;
  const step = () => {
    state.raf = 0;
    if (!el.isConnected) return;
    let t = now() - state.at;
    if (t > limit) t = limit;
    drawMinimapAt(el, predictMinimap(state, t), state.hint);
    if (t < limit) state.raf = requestAnimationFrame(step);
  };
  state.raf = requestAnimationFrame(step);
  return true;
}
