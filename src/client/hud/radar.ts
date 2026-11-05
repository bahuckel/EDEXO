import type { ExoMinimapDTO } from "@shared/types";
import { esc } from "./core";

/*
  The radar (minimap) of the exo-distance tracker. It stays a small imperative island inside the React HUD: the
  tracker renders the <svg> element and nothing in it, and this module draws into it — the static rim once, the
  world layer on each fix — as public/hud/radar.js did. Rebuilding it through React would restart the sweep's CSS
  animation on every frame, which is what made it jerk before it was split into layers.
*/

type Minimap = ExoMinimapDTO;
type RadarSvg = SVGSVGElement & { __staticBuilt?: boolean; __clipId?: string };
/**
 * Each radar's own clip id: two radars in one page sharing "hudRadarClip" both clip to the first one's, and when that
 * one is hidden its rings can go with it (owner, 2026-11-04: the sample rings not shown).
 */
let clipSeq = 0;

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

/** A distance on the radar (review P15, owner 2026-11-05): metres under 1 km ("640 m"), else km ("1.2 km", "12 km"). */
export function fmtRadarDistance(m: number): string {
  const r = Math.round(m);
  if (r < 1000) return r + " m";
  const km = m / 1000;
  return (km < 10 ? km.toFixed(1) : String(Math.round(km))) + " km";
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
  svg.__clipId = "hudRadarClip" + ++clipSeq;
  svg.innerHTML =
    '<defs><linearGradient id="hudSweepGrad" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0" stop-color="currentColor" stop-opacity="0"/>' +
    '<stop offset="1" stop-color="currentColor" stop-opacity="0.28"/></linearGradient>' +
    // The sample rings stop at the rim: a ring round a plant out of range still shows its near edge.
    '<clipPath id="' +
    svg.__clipId +
    '"><circle cx="0" cy="0" r="' +
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
  if (rings.length) parts.push('<g clip-path="url(#' + svg.__clipId + ')">' + rings.join("") + "</g>");
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
    // A composition scan of another species than the one being sampled: yellow (review P14; green is the run's).
    const other = m.kind === "codex" && !m.active;
    const cls = m.kind === "ship" ? "ship" : m.kind === "codex" ? (other ? "codex-other" : "codex") : m.kind === "srv" ? "srv" : "sample";
    if (m.kind === "sample" && m.active && !firstActive) firstActive = { x, y };
    const tint = m.kind === "sample" && !m.active ? ' style="fill:' + leftoverColour(m.label) + '"' : "";
    const title = "<title>" + esc(m.label) + " — " + fmtRadarDistance(m.distanceM) + "</title>";
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
      } else if (m.kind === "srv") {
        // The SRV left standing (plan 1.3.6 S-2): a small square with its wheels, upright like the ship.
        parts.push(
          '<g transform="translate(' +
            x.toFixed(1) +
            "," +
            y.toFixed(1) +
            ") rotate(" +
            (-rot).toFixed(2) +
            ')"><rect class="minimap-srv" x="-4" y="-3" width="8" height="6" rx="1" /><circle class="minimap-srv-wheel" cx="-3" cy="3.6" r="1.3" /><circle class="minimap-srv-wheel" cx="3" cy="3.6" r="1.3" />' +
            title +
            "</g>",
        );
      } else if (m.kind === "codex") {
        // A composition-scan waypoint: a hollow circle, never mistaken for a sample taken. Placed by two crossing scans
        // it gets a second ring; from one scan without a range, a short line the way the ship was pointed.
        if (m.located === "scanned-from" && m.scanHeadingDeg != null) {
          const t = (m.scanHeadingDeg * Math.PI) / 180;
          parts.push(
            '<line class="minimap-codex-heading' + (other ? " minimap-codex-heading--other" : "") + '" x1="' + x.toFixed(1) + '" y1="' + y.toFixed(1) + '" x2="' +
              (x + Math.sin(t) * 16).toFixed(1) + '" y2="' + (y - Math.cos(t) * 16).toFixed(1) + '" />',
          );
        }
        if (m.located === "crossing")
          parts.push('<circle class="minimap-codex minimap-codex--outer' + (other ? " minimap-codex--other" : "") + '" r="7" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" />');
        parts.push(
          '<circle class="minimap-codex' + (m.target ? " minimap-codex--target" : "") + (other ? " minimap-codex--other" : "") + '" r="4" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '">' + title + "</circle>",
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
        // Which of the run's three scans (review P15), beside the mark and upright.
        if (m.scanNo)
          parts.push(
            '<text class="minimap-scan-no" x="' + (x + 5).toFixed(1) + '" y="' + (y - 4).toFixed(1) + '" transform="rotate(' + (-rot).toFixed(2) + "," + x.toFixed(1) + "," + y.toFixed(1) + ')">' + m.scanNo + "</text>",
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
          fmtRadarDistance(m.distanceM) +
          "</text>",
      );
    }
  }
  // The next plant to sample (owner, 2026-11-04): a line from you to it, to the rim when it is off the map.
  const next = mm.marks.find((m) => m.target);
  if (next) {
    const nx = next.eastM * scale;
    const ny = -next.northM * scale;
    const k = Math.min(1, (MAP_R - 8) / Math.max(1e-6, Math.hypot(nx, ny)));
    parts.push('<line class="minimap-target-line" x1="0" y1="0" x2="' + (nx * k).toFixed(1) + '" y2="' + (ny * k).toFixed(1) + '" />');
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
  // The clear key's first press (owner, 2026-11-04): the second one, within 3 s, clears this planet's marks.
  if (mm.clearArmed) {
    const n = mm.clearArmed;
    parts.push(
      '<text class="minimap-clear" x="0" y="' + (MAP_R - 22) + '" text-anchor="middle">Press again: clear ' + n + " mark" + (n === 1 ? "" : "s") + "</text>",
    );
  }
  svg.querySelector(".mm-world")!.innerHTML = parts.join("");
  svg.querySelector(".mm-you")!.innerHTML =
    heading == null
      ? '<circle class="minimap-you" cx="0" cy="0" r="3.5" />'
      : '<polygon class="minimap-you" points="0,-7.5 5,4.5 0,1.8 -5,4.5" />';
  return true;
}

/*
  Each fix is drawn exactly as it arrives and stays until the next one. Prediction (continuing the commander's motion
  between Status.json fixes, about one every three seconds) was built and switched off on the owner's report after
  flying it (2026-09-21): "the radar dots keep drifting away when I move — make them fixed in place and updated
  dynamically without drifting." Its leftover machinery (a copy of the map, a fingerprint to skip repeats) was taken
  out on 2026-11-05: a field missing from the copy or the fingerprint froze on screen, the line to the next plant
  among them (95c56ac). Its history is in public/hud/radar.js's and in git.
*/

/** Draw the radar. False when there is no map to draw (off a surface). */
export function drawMinimap(svg: SVGSVGElement, mm: Minimap | null | undefined, hint: boolean): boolean {
  if (!mm || !mm.marks) return false;
  return drawMinimapAt(svg as RadarSvg, mm, hint);
}
