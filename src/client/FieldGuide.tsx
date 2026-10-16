/**
 * The Encyclopedia's species card in the field-guide layout of the website's species page (owner,
 * 2026-09-29): photo, description, published conditions, where it was actually found, and measured
 * charts — here with the body the commander is looking at marked on every scale.
 *
 * Data: `/api/field-guide` (shared/fieldGuide.ts). The charts are the site's: equal-width bins over
 * the measured range (the site lights the mode's bin; here the middle half, below). The body's own value is a
 * second line in the "matches" blue, or an arrow at the edge when it lies outside the measured range.
 *
 * Bands (plan 1.8, 2026-10-11): the charts light the middle half of the bodies instead of a mode (from
 * the EDDN year where a species has it, else read off the chart's own bins), and the card shows
 * per-atmosphere bands (5-95 % light, 25-75 % dark, a tick at the median) and how often it is this
 * species when its genus is on a body.
 * The bands are information only: the matcher grades by the codex windows, never by these.
 */
import type { EstimatedSurfaceTempBand, PlanetScan, SpeciesMatchContext } from "@shared/types";
import { reportsVolcanism, volcanismFamily } from "@shared/volcanismText";
import { atmosphereTypeKeyOf } from "@shared/scanAtmosphereMatch";
import { foldSpelling } from "@shared/spelling";
import {
  GUIDE_ATMO_PREFIX,
  GUIDE_PARAMS,
  guideBodyName,
  guideParam,
  guideStarClass,
  type GuideBand,
  type GuideBands,
  type GuideColours,
  type GuideGenus,
  type GuideHist,
  type GuideMeasured,
  type GuideRequirement,
  type GuideShare,
  type GuideSpecies,
  type GuideWithinRow,
} from "@shared/fieldGuide";
import { journalPressureToAtm } from "@shared/journalPhysics";
import { fmtPct } from "@shared/format";
import { useState, type ReactNode } from "react";

/** One formatter for every chart label: `toLocaleString` per call was a tenth of the Encyclopedia's open. */
const GROUPED = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** A number the way a commander reads it: no false precision, thousands grouped. */
export function fmtGuide(v: number): string {
  const a = Math.abs(v);
  if (a >= 100) return GROUPED.format(Math.round(v));
  if (a >= 10) return String(Number(v.toFixed(1)));
  if (a >= 1) return String(Number(v.toFixed(2)));
  if (a === 0) return "0";
  return String(Number(v.toPrecision(2)));
}

const withUnit = (v: number, unit: string) =>
  unit === "" ? fmtGuide(v) : unit === "%" || unit === "°" ? `${fmtGuide(v)}${unit}` : `${fmtGuide(v)} ${unit}`;

const pct = (n: number, total: number) => fmtPct((n / total) * 100);

/* ------------------------------------------------------------------ the body being compared */

export interface GuideBody {
  label: string;
  /** Values in the guide's units, keyed by parameter id. */
  values: Record<string, number>;
  planet: string | null;
  atmosphere: string | null;
  /** the atmosphere as the bands key it ("carbondioxide", "none") */
  atmoKey: string | null;
  volcanism: string | null;
  /** "none", "water", "silicate", ... as the within-genus shares key it */
  volcFamily: string | null;
  star: string | null;
  materials: Record<string, number>;
}

const norm = (s: string) =>
  // The journal spells it "sulfur", the shares "Sulphur" (owner, 2026-10-06: "not seen" on a body
  // whose atmosphere was a third of the list).
  foldSpelling(s)
    .toLowerCase()
    .replace(/\s+(atmosphere|volcanism)$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** "", "No volcanism" and "none" are the same thing. */
const normVolc = (s: string) => (reportsVolcanism(s) ? norm(s) : "no volcanism");

export function guideBodyFrom(
  scan: PlanetScan | null,
  est: EstimatedSurfaceTempBand | null,
  ctx: SpeciesMatchContext | null,
  label: string,
): GuideBody | null {
  if (!scan) return null;
  const v: Record<string, number> = {};
  const put = (id: string, x: number | null | undefined) => {
    if (typeof x === "number" && Number.isFinite(x)) v[id] = x;
  };
  put("body.surfaceTemperature", scan.SurfaceTemperature ?? est?.midK ?? null);
  put("body.gravity", scan.SurfaceGravity != null ? scan.SurfaceGravity / 9.80665 : null);
  put("body.surfacePressure", scan.SurfacePressure != null ? journalPressureToAtm(scan.SurfacePressure) : null);
  put("body.distanceToArrival", scan.distanceFromArrivalLs ?? ctx?.distanceFromArrivalLs ?? null);
  put("body.radius", scan.radius != null ? scan.radius / 1000 : null);
  put("body.earthMasses", scan.MassEM);
  put("body.semiMajorAxis", scan.SemiMajorAxis != null ? scan.SemiMajorAxis / 1.495978707e11 : null);
  put("body.orbitalPeriod", scan.OrbitalPeriod != null ? scan.OrbitalPeriod / 86400 : null);
  put("body.rotationalPeriod", scan.RotationPeriod != null ? scan.RotationPeriod / 86400 : null);
  put("body.orbitalEccentricity", scan.Eccentricity);
  put("body.axialTilt", scan.AxialTilt != null ? (scan.AxialTilt * 180) / Math.PI : null);
  for (const [k, f] of Object.entries(scan.composition ?? {})) {
    const key = k.charAt(0).toUpperCase() + k.slice(1).toLowerCase();
    put(`body.solidComposition.${key}`, f <= 1 ? f * 100 : f);
  }
  for (const g of scan.atmosphereComposition ?? []) {
    const name = (g.Name ?? g.name ?? "").trim();
    const p = g.Percent ?? g.percent;
    if (name) put(`${GUIDE_ATMO_PREFIX}${name}`, p);
  }
  const materials: Record<string, number> = {};
  for (const m of scan.materials ?? []) {
    const name = (m.Name ?? m.name ?? "").trim();
    const p = m.Percent ?? m.percent;
    if (name && typeof p === "number") materials[name.charAt(0).toUpperCase() + name.slice(1)] = p;
  }
  const star = ctx?.parentStarType ? guideStarClass(ctx.parentStarType) : null;
  return {
    label,
    values: v,
    planet: scan.PlanetClass ? guideBodyName(scan.PlanetClass) : null,
    atmosphere: scan.Atmosphere != null ? scan.Atmosphere || "No atmosphere" : null,
    atmoKey: atmoKeyOf(scan),
    volcanism: scan.Volcanism != null ? scan.Volcanism || "No volcanism" : null,
    volcFamily: scan.Volcanism != null ? volcanismFamily(scan.Volcanism) : null,
    star,
    materials,
  };
}

/**
 * The atmosphere as the bands key it: from `AtmosphereType` where the scan has one, else from the
 * `Atmosphere` text ("thin neon rich atmosphere" -> "neonrich"); "none" for no atmosphere.
 */
function atmoKeyOf(scan: PlanetScan): string | null {
  if (scan.AtmosphereType) return atmosphereTypeKeyOf(scan) || "none";
  if (scan.Atmosphere == null) return null;
  const t = foldSpelling(scan.Atmosphere)
    .toLowerCase()
    .replace(/\batmosphere\b/g, "")
    .replace(/\b(hot|thin|thick)\b/g, "")
    .trim();
  return !t || t === "no" ? "none" : t.replace(/[^a-z]/g, "");
}

/** The journal names gases one way and the corpus another ("CarbonDioxide", "Carbon dioxide"). */
function bodyValueFor(body: GuideBody | null, id: string): number | null {
  if (!body) return null;
  if (id in body.values) return body.values[id]!;
  if (id.startsWith(GUIDE_ATMO_PREFIX)) {
    const want = norm(id.slice(GUIDE_ATMO_PREFIX.length)).replace(/ /g, "");
    for (const [k, x] of Object.entries(body.values)) {
      if (k.startsWith(GUIDE_ATMO_PREFIX) && norm(k.slice(GUIDE_ATMO_PREFIX.length)).replace(/ /g, "") === want) return x;
    }
    return 0;
  }
  return null;
}

/* ------------------------------------------------------------------ charts */

const W = 240;
const H = 60;
const GAP = 2;

/** "176–179 K", or one value when both ends read the same. */
export function guideRange(a: number, b: number, unit: string): string {
  const lo = fmtGuide(a);
  return lo === fmtGuide(b) ? withUnit(a, unit) : `${lo}–${withUnit(b, unit)}`;
}

/**
 * Quantiles read off a chart's own bins (linear inside a bin), for a parameter the EDDN year has no band
 * for: the rare surface species and the extra charts.
 */
export function bandFromHist(h: GuideHist): GuideBand | null {
  const total = h.counts.reduce((a, c) => a + c, 0);
  if (!(total > 0) || !(h.max >= h.min)) return null;
  const w = (h.max - h.min) / h.counts.length;
  const q = (p: number) => {
    const target = p * total;
    let acc = 0;
    for (let i = 0; i < h.counts.length; i++) {
      const c = h.counts[i]!;
      if (c > 0 && acc + c >= target) return h.min + w * (i + (target - acc) / c);
      acc += c;
    }
    return h.max;
  };
  return [q(0.05), q(0.25), q(0.5), q(0.75), q(0.95)];
}

/**
 * One measured chart, with the body's value on the same scale when there is one. The bins holding the
 * middle half of the bodies are lit and the line sits on the median: from the EDDN band where there is
 * one, else read off the bins; the mode only for a chart with no counts.
 */
function GuideChart({ id, h, bodyValue, band: eddn }: { id: string; h: GuideHist; bodyValue: number | null; band?: GuideBand | null }) {
  const def = guideParam(id) ?? { id, label: id, unit: "" };
  const band = eddn ?? bandFromHist(h);
  const bins = h.counts.length;
  const peak = Math.max(...h.counts, 0);
  const span = h.max - h.min;
  const at = (v: number) => (span > 0 ? Math.min(Math.max((v - h.min) / span, 0), 1) : 0.5);
  const t = at(band ? band[2] : h.mode);
  const modeBin = Math.min(bins - 1, Math.floor(t * bins));
  const litLo = band ? at(band[1]) : 0;
  const litHi = band ? at(band[3]) : 0;
  const bw = W / bins;
  let bars = "";
  let lit = "";
  h.counts.forEach((c, i) => {
    if (!(c > 0) || !(peak > 0)) return;
    const bh = Math.max((c / peak) * (H - 4), 1.5);
    const d = `M${(i * bw + GAP / 2).toFixed(1)} ${H}v-${bh.toFixed(1)}h${(bw - GAP).toFixed(1)}v${bh.toFixed(1)}z`;
    // A bin is lit when it overlaps the middle half; a half too narrow for any bin edge lights its one bin.
    const inBand = band ? (i + 1) / bins > litLo && i / bins < litHi : false;
    if (band ? inBand || i === modeBin : i === modeBin) lit += d;
    else bars += d;
  });
  const x = (t * W).toFixed(1);
  let body: ReactNode = null;
  let where: "below" | "above" | "in" | null = null;
  if (bodyValue != null) {
    const raw = span > 0 ? (bodyValue - h.min) / span : 0.5;
    where = raw < 0 ? "below" : raw > 1 ? "above" : "in";
    const bx = (Math.min(Math.max(raw, 0), 1) * W).toFixed(1);
    body =
      where === "in" ? (
        <line className="fg-body-line" x1={bx} x2={bx} y1="0" y2={H} />
      ) : (
        <path
          className="fg-body-edge"
          d={where === "below" ? `M0 ${H / 2}l8 -6v12z` : `M${W} ${H / 2}l-8 -6v12z`}
        />
      );
  }
  const middle = band ? guideRange(band[1], band[3], def.unit) : null;
  const label = `${def.label}: from ${withUnit(h.min, def.unit)} to ${withUnit(h.max, def.unit)}, ${
    middle ? `most at ${middle}` : `mode ${withUnit(h.mode, def.unit)}`
  }, measured on ${GROUPED.format(h.n)} bodies`;
  return (
    <figure className="fg-chart">
      <figcaption>
        <span className="fg-chart-k">{def.label}</span>
        {middle ? (
          <span
            className="fg-mode"
            title={`Half of the bodies ${eddn ? "it was logged on lie here (EDDN year)" : "lie here, read off the chart"}; median ${withUnit(band![2], def.unit)}`}
          >
            most at <b>{middle}</b>
          </span>
        ) : (
          <span className="fg-mode" title="The most common value">
            mode <b>{withUnit(h.mode, def.unit)}</b>
          </span>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <path className="fg-bars" d={bars} />
        <path className="fg-bars-mode" d={lit} />
        <line className="fg-mode-line" x1={x} x2={x} y1="0" y2={H} />
        {body}
      </svg>
      <div className="fg-axis">
        <span>{withUnit(h.min, def.unit)}</span>
        <span>{withUnit(h.max, def.unit)}</span>
      </div>
      {bodyValue != null ? (
        <div className={`fg-body-val fg-body-val--${where}`} title="The body you are looking at">
          {where === "below" ? "◂ below the range · " : where === "above" ? "above the range ▸ · " : ""}this body{" "}
          <b>{withUnit(bodyValue, def.unit)}</b>
        </div>
      ) : null}
    </figure>
  );
}

/* ------------------------------------------------------------------ shares */

const SEG = ["var(--accent)", "var(--accent-bright)", "#c2561a", "#7be07b", "#ffd23f"];

const STAR_COLOUR: Record<string, string> = {
  O: "#6f8cff",
  B: "#8fb0ff",
  A: "#cfdcff",
  F: "#fff3c9",
  G: "#ffd966",
  K: "#ffa94d",
  M: "#ff6f4f",
  L: "#d8434b",
  T: "#a8407c",
  Y: "#7d4b3c",
  "Neutron star": "#00d4ff",
  "White dwarf": "#e9edff",
  "T Tauri": "#c9a0ff",
  "Herbig Ae/Be": "#9fe3ff",
  "Wolf-Rayet": "#b24bff",
  "Black hole": "#3a3f55",
  "Carbon / S": "#ff5533",
};

/** A stacked bar and its legend: the top four, the rest as "other"; the body's own class marked. */
function ShareRow({
  label,
  items,
  colour,
  mine,
  same = (a, b) => norm(a) === norm(b),
}: {
  label: string;
  items: GuideShare[];
  colour: (s: GuideShare, i: number) => string;
  mine: string | null;
  same?: (a: string, b: string) => boolean;
}) {
  const total = items.reduce((n, s) => n + s.n, 0);
  if (total === 0) return null;
  const top = items.slice(0, 4);
  const rest = total - top.reduce((n, s) => n + s.n, 0);
  const parts = top.map((s, i) => ({ label: s.label, n: s.n, c: colour(s, i) }));
  if (rest > 0) parts.push({ label: "Other", n: rest, c: "rgba(255, 230, 207, 0.22)" });
  const hit = mine != null ? items.find((s) => same(s.label, mine)) : undefined;
  const hitInTop = hit ? top.includes(hit) : false;
  return (
    <div className="fg-share">
      <dt>{label}</dt>
      <dd>
        <div className="fg-stack" aria-hidden="true">
          {parts.map((p) => (
            <i key={p.label} style={{ flexGrow: p.n, background: p.c }} title={`${p.label} ${pct(p.n, total)}`} />
          ))}
        </div>
        <ul className="fg-legend">
          {parts.map((p) => (
            <li key={p.label} className={hit && hitInTop && p.label === hit.label ? "fg-legend--mine" : undefined}>
              <i style={{ background: p.c }} />
              {p.label} <b>{pct(p.n, total)}</b>
            </li>
          ))}
          {mine != null ? (
            <li className={`fg-legend-body${hit ? "" : " fg-legend-body--none"}`} title="The body you are looking at">
              this body: {mine}
              {hit ? (hitInTop ? "" : ` · ${pct(hit.n, total)}`) : " · not seen"}
            </li>
          ) : null}
        </ul>
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ colours */

const SWATCH: Record<string, string> = {
  amethyst: "#9966cc",
  aquamarine: "#6fe3c4",
  blue: "#3b6cf6",
  brown: "#8b5a2b",
  cobalt: "#1f5fd1",
  cyan: "#00c8f0",
  emerald: "#2fbf71",
  gold: "#f5c542",
  green: "#43b047",
  grey: "#9aa0a6",
  indigo: "#5a4fcf",
  lime: "#a4e04a",
  magenta: "#e0309a",
  maroon: "#8b1e3f",
  mauve: "#c89bd6",
  mulberry: "#c54b8c",
  ocher: "#cc7722",
  orange: "#ff8c1a",
  peach: "#ffb38a",
  purple: "#8e44d6",
  red: "#e53935",
  rose: "#f06b9a",
  sage: "#9caf88",
  teal: "#1fb5ad",
  turquoise: "#40e0d0",
  white: "#f2f4fa",
  yellow: "#ffe14d",
};

const COLOUR_BY: Record<GuideColours["by"], string> = {
  star: "Colour follows the parent star",
  material: "Colour follows a material on the body",
  geology: "Colour follows the body’s geology",
};

export function GuideColoursBlock({ c }: { c: GuideColours | null }) {
  if (!c) return null;
  return (
    <div className="fg-colours">
      <p className="fg-sub">{COLOUR_BY[c.by]}</p>
      <ul className="fg-swatches">
        {c.map.map(([k, name]) => (
          <li key={k} title={`${k}: ${name}`}>
            <i style={{ background: SWATCH[name.toLowerCase().split(/[\s/]/)[0]!] ?? "transparent" }} />
            <span className="fg-sw-k">{k}</span> {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GuideRequires({ list }: { list: GuideRequirement[] }) {
  if (list.length === 0) return null;
  return (
    <dl className="fg-req">
      {list.map((r, i) => (
        <div key={`${r.label}-${i}`}>
          <dt>{r.label}</dt>
          <dd>{r.text}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ bands (plan 1.8) */

const BW = 240;
const BH = 12;
/** Pressure and distance span decades: drawn on a log scale when the shown cells span more than ×10. */
const LOG_PARAMS = new Set(["body.surfacePressure", "body.distanceToArrival"]);
const VISIBLE_ATMOS = 2;

type Scale = { at: (v: number) => number };

function scaleFor(id: string, bands: GuideBand[]): Scale | null {
  if (!bands.length) return null;
  let lo = Math.min(...bands.map((b) => b[0]));
  let hi = Math.max(...bands.map((b) => b[4]));
  const log = LOG_PARAMS.has(id) && lo > 0 && hi / lo > 10;
  const f = (v: number) => (log ? Math.log10(Math.max(v, 1e-12)) : v);
  lo = f(lo);
  hi = f(hi);
  const pad = (hi - lo) * 0.04 || Math.abs(hi) * 0.04 || 1;
  const a = lo - pad;
  const span = hi + pad - a;
  return { at: (v: number) => (f(v) - a) / span };
}

/** One parameter of one atmosphere: the 5-95 % bar, the 25-75 % bar inside it, the median, the body. */
/*
  The bands and within-genus blocks (plan 1.8) in tw: utilities (plan 3.4, 2026-10-12): no rules of their
  own in encyclopedia.css. The class names stay as hooks; fg-h, fg-sub and the body marks are shared
  with the other blocks and keep theirs. Hover / focus as [&:hover], not hover:, which only applies with
  a mouse.
*/
const BLOCK = "tw:flex tw:flex-col tw:gap-3 tw:pt-4 tw:[border-top:1px_solid_var(--accent-a15)]";
const BAND_BODY = "fg-band-body tw:font-[600]";
const WITHIN_CELL = "tw:p-[0.05rem_0.3rem_0.05rem_0]";
const WITHIN_SHARE = "tw:text-right tw:w-[45%]";
const WITHIN_TH = "tw:font-[400] tw:text-muted tw:p-[0_0.3rem_0.15rem_0]";
const TITLE_B = "tw:text-accent-bright tw:font-[600]";

function BandRow({ id, band, scale, bodyValue }: { id: string; band: GuideBand; scale: Scale; bodyValue: number | null }) {
  const def = guideParam(id) ?? { id, label: id, unit: "" };
  const x = (v: number) => Math.min(Math.max(scale.at(v), 0), 1) * BW;
  const [p5, p25, p50, p75, p95] = band;
  let body: ReactNode = null;
  let where: "below" | "above" | "in" | null = null;
  if (bodyValue != null) {
    const raw = scale.at(bodyValue);
    where = bodyValue < p5 ? "below" : bodyValue > p95 ? "above" : "in";
    body =
      raw < 0 || raw > 1 ? (
        <path className="fg-body-edge" d={raw < 0 ? `M0 ${BH / 2}l6 -5v10z` : `M${BW} ${BH / 2}l-6 -5v10z`} />
      ) : (
        <line className="fg-body-line" x1={x(bodyValue)} x2={x(bodyValue)} y1="0" y2={BH} />
      );
  }
  const aria = `${def.label}: 90 % of bodies ${guideRange(p5, p95, def.unit)}, half ${guideRange(p25, p75, def.unit)}, median ${withUnit(p50, def.unit)}`;
  return (
    <div className="fg-band tw:grid tw:grid-cols-[auto_minmax(0,1fr)] tw:[grid-template-areas:'k_v'_'bar_bar'] tw:gap-[0.1rem_0.6rem] tw:items-baseline tw:text-2xs">
      <span className="fg-band-k tw:[grid-area:k] tw:text-muted tw:whitespace-nowrap">{def.label}</span>
      <svg
        className="tw:[grid-area:bar] tw:block tw:w-full tw:h-[12px] tw:bg-[rgba(255,255,255,0.04)]"
        viewBox={`0 0 ${BW} ${BH}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={aria}
      >
        <rect className="fg-band-outer tw:fill-[var(--accent-a30)]" x={x(p5)} y="3" width={Math.max(x(p95) - x(p5), 1)} height={BH - 6} />
        <rect className="fg-band-inner tw:fill-accent" x={x(p25)} y="2" width={Math.max(x(p75) - x(p25), 1.5)} height={BH - 4} />
        <line
          className="fg-band-mid tw:stroke-accent-bright tw:stroke-2 tw:[vector-effect:non-scaling-stroke]"
          x1={x(p50)}
          x2={x(p50)}
          y1="0"
          y2={BH}
        />
        {body}
      </svg>
      <span className="fg-band-v tw:[grid-area:v] tw:text-right tw:text-text-dim tw:tabular-nums tw:min-w-0">
        {guideRange(p5, p95, def.unit)} · most {guideRange(p25, p75, def.unit)}
        {bodyValue != null ? (
          <b
            className={`${BAND_BODY} fg-band-body--${where} ${where === "in" ? "tw:[color:var(--ok-bright)]" : "tw:[color:var(--warn-soft)]"}`}
            title="The body you are looking at"
          >
            {" "}
            · this body {withUnit(bodyValue, def.unit)}
          </b>
        ) : null}
      </span>
    </div>
  );
}

/**
 * Where most of its bodies lie, one block per atmosphere it was logged on 20+ times: the body's own
 * atmosphere first, then the commonest. Every atmosphere of a parameter shares one scale, so a cold
 * methane band and a hot water band read against each other.
 */
export function GuideBandsBlock({ b, body }: { b: GuideBands; body: GuideBody | null }) {
  const [open, setOpen] = useState(false);
  if (!b.atmo.length) return null;
  const mine = body?.atmoKey ? b.atmo.find((a) => a.key === body.atmoKey) : undefined;
  const cells = mine ? [mine, ...b.atmo.filter((a) => a !== mine)] : b.atmo;
  const shown = open ? cells : cells.slice(0, VISIBLE_ATMOS);
  const params = GUIDE_PARAMS.filter((p) => p.core && b.atmo.some((a) => a.bands[p.id]));
  const scales = new Map(params.map((p) => [p.id, scaleFor(p.id, b.atmo.flatMap((a) => (a.bands[p.id] ? [a.bands[p.id]!] : [])))]));
  const temp = "body.surfaceTemperature";
  const more = cells.length - VISIBLE_ATMOS;
  return (
    <div className={`fg-bands ${BLOCK}`}>
      <span className="fg-h">Where most of them grow</span>
      <p className="fg-sub">
        On <b>{GROUPED.format(b.n)}</b> bodies logged to EDDN, by atmosphere: the light bar holds 90 % of them, the
        dark bar half, the tick the middle one.
      </p>
      {body?.atmoKey && !mine ? (
        <p className="fg-band-none tw:m-0 tw:text-xs tw:[color:var(--warn-soft)]">
          Not logged on {body.atmosphere ?? "this atmosphere"} often enough for a band (20 bodies).
        </p>
      ) : null}
      {shown.map((a) => {
        const t = a.bands[temp];
        return (
          <section
            key={a.key}
            className={`fg-band-atmo${a === mine ? " fg-band-atmo--mine" : ""} tw:flex tw:flex-col tw:gap-[0.15rem] tw:p-[0.3rem_0_0.2rem_0.5rem] ${a === mine ? "tw:[border-left:2px_solid_var(--ok)]" : "tw:[border-left:2px_solid_var(--accent-a15)]"}`}
          >
            <p className="fg-band-title tw:m-[0_0_0.1rem] tw:text-xs tw:text-text-dim">
              {t ? (
                <>
                  <b className={TITLE_B}>{guideRange(t[0], t[4], "K")}</b> on {a.label}, most at <b className={TITLE_B}>{guideRange(t[1], t[3], "K")}</b>
                </>
              ) : (
                <b className={TITLE_B}>{a.label}</b>
              )}
              <small className={`tw:text-2xs ${a === mine ? "tw:[color:var(--ok-bright)]" : "tw:text-muted"}`}>
                {" "}
                · {GROUPED.format(a.n)} bodies{a === mine ? " · this body's atmosphere" : ""}
              </small>
            </p>
            {params.map((p) => {
              const band = a.bands[p.id];
              const scale = scales.get(p.id);
              return band && scale ? (
                <BandRow key={p.id} id={p.id} band={band} scale={scale} bodyValue={a === mine ? bodyValueFor(body, p.id) : null} />
              ) : null;
            })}
          </section>
        );
      })}
      {more > 0 ? (
        <button
          type="button"
          className="fg-band-more tw:self-start tw:[background:none] tw:[border:none] tw:p-0 tw:cursor-pointer tw:text-xs tw:text-accent tw:[&:hover]:text-accent-bright tw:[&:hover]:underline tw:[&:focus-visible]:text-accent-bright tw:[&:focus-visible]:underline"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "Fewer atmospheres" : `${more} more atmosphere${more === 1 ? "" : "s"}`}
        </button>
      ) : null}
    </div>
  );
}

const WITHIN_ROWS = 6;

function WithinTable({ title, rows, mine }: { title: string; rows: GuideWithinRow[]; mine: string | null }) {
  if (!rows.length) return null;
  const top = rows.slice(0, WITHIN_ROWS);
  const own = mine != null ? rows.find((r) => r.key === mine) : undefined;
  if (own && !top.includes(own)) top.push(own);
  return (
    <table className="fg-within-t tw:border-collapse tw:text-2xs tw:w-full">
      <thead>
        <tr>
          <th scope="col" className={`${WITHIN_TH} tw:text-left`}>
            {title}
          </th>
          <th scope="col" className={`${WITHIN_TH} ${WITHIN_SHARE}`} title="Of the bodies its genus was on">
            share
          </th>
        </tr>
      </thead>
      <tbody>
        {top.map((r) => {
          const rate = r.genusN > 0 ? r.n / r.genusN : 0;
          return (
            <tr
              key={r.key}
              className={r === own ? "fg-within--mine" : undefined}
              title={`${GROUPED.format(r.n)} of ${GROUPED.format(r.genusN)} bodies`}
            >
              <td
                className={`${WITHIN_CELL} ${r === own ? "tw:[color:var(--ok-bright)] tw:before:content-['▸_']" : "tw:text-text-dim"}`}
              >
                {r.label}
              </td>
              <td className={`${WITHIN_CELL} ${WITHIN_SHARE} tw:relative ${r === own ? "tw:[color:var(--ok-bright)]" : "tw:text-text-dim"}`}>
                <i
                  className="fg-within-bar tw:absolute tw:left-0 tw:top-1/4 tw:h-1/2 tw:[background:var(--accent-a22)]"
                  style={{ width: `${Math.round(rate * 100)}%` }}
                />
                <b className="tw:relative tw:text-text tw:font-[600]">{fmtPct(rate * 100)}</b>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Given its genus is on a body, how often it is this species, by atmosphere / volcanism / host star. */
export function GuideWithinBlock({ b, name, body }: { b: GuideBands; name: string; body: GuideBody | null }) {
  const w = b.within;
  if (!w || !(w.atmosphere.length || w.volcanism.length || w.host.length)) return null;
  return (
    <div className={`fg-within ${BLOCK}`}>
      <span className="fg-h">Within {w.genus}</span>
      <p className="fg-sub">
        When {w.genus} grows on a body, how often it is {name} ({GROUPED.format(w.genusN)} {w.genus} bodies)
        {body ? "; the body's own kind is marked" : ""}.
      </p>
      <div className="fg-within-grid tw:grid tw:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] tw:gap-[0.4rem_0.9rem]">
        <WithinTable title="Atmosphere" rows={w.atmosphere} mine={body?.atmoKey ?? null} />
        <WithinTable title="Volcanism" rows={w.volcanism} mine={body?.volcFamily ?? null} />
        <WithinTable title="Host star" rows={w.host} mine={body?.star ?? null} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ measured block */

export function GuideMeasuredBlock({ m, body, bands }: { m: GuideMeasured; body: GuideBody | null; bands?: GuideBands | null }) {
  const [more, setMore] = useState(false);
  const star = (x: GuideShare, i: number) => STAR_COLOUR[x.label] ?? SEG[i % SEG.length]!;
  const seg = (_: GuideShare, i: number) => SEG[i % SEG.length]!;
  const core = GUIDE_PARAMS.filter((p) => p.core && m.hist[p.id]);
  const rest = [
    ...GUIDE_PARAMS.filter((p) => !p.core).map((p) => p.id),
    ...Object.keys(m.hist).filter((id) => !GUIDE_PARAMS.some((p) => p.id === id)),
  ].filter((id) => m.hist[id]);
  return (
    <>
      <div className="fg-found">
        <p className="fg-sub">
          Measured on <b>{GROUPED.format(m.bodies)}</b> bodies where it was confirmed
          {m.sharesFromEddn ? (
            <>
              {" "}
              · body and atmosphere over <b>{GROUPED.format(m.sharesFromEddn)}</b> bodies logged to EDDN
            </>
          ) : null}
        </p>
        <dl className="fg-shares">
          <ShareRow label="Body" items={m.planet} colour={seg} mine={body?.planet ?? null} />
          <ShareRow label="Atmosphere" items={m.atmosphere} colour={seg} mine={body?.atmosphere ?? null} />
          <ShareRow
            label="Volcanism"
            items={m.volcanism}
            colour={seg}
            mine={body?.volcanism ?? null}
            same={(a, b) => normVolc(a) === normVolc(b)}
          />
          <ShareRow label="Host star" items={m.star} colour={star} mine={body?.star ?? null} same={(a, b) => a === b} />
        </dl>
        {m.locked != null ? <p className="fg-sub">Tidally locked on {pct(m.locked, 1)} of them.</p> : null}
      </div>
      <div className="fg-charts">
        {core.map((p) => (
          <GuideChart key={p.id} id={p.id} h={m.hist[p.id]!} bodyValue={bodyValueFor(body, p.id)} band={bands?.all[p.id]} />
        ))}
      </div>
      {rest.length || m.materials.length ? (
        <details className="fg-more" onToggle={(e) => setMore((e.target as HTMLDetailsElement).open)}>
          <summary>More measurements</summary>
          {more ? (
            <div className="fg-more-body">
              <div className="fg-charts">
                {rest.map((id) => (
                  <GuideChart key={id} id={id} h={m.hist[id]!} bodyValue={bodyValueFor(body, id)} band={bands?.all[id]} />
                ))}
              </div>
              {m.materials.length ? (
                <>
                  <h5 className="fg-h">Surface materials</h5>
                  <p className="fg-sub">
                    The most common share of each, and how many of the bodies carry it
                    {body ? "; the body's own share beside it" : ""}.
                  </p>
                  <ul className="fg-mats">
                    {m.materials.map((x) => {
                      const mine = body?.materials[x.name];
                      return (
                        <li key={x.name}>
                          <span>{x.name}</span>
                          <b>{fmtGuide(x.mode)}%</b>
                          <small>{pct(x.n, m.bodies)}</small>
                          {body ? (
                            <em className={mine == null ? "fg-mat-none" : undefined}>
                              {mine == null ? "—" : `${fmtGuide(mine)}%`}
                            </em>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
        </details>
      ) : null}
    </>
  );
}

/** The genus heading's field-guide part: description, genus-wide conditions, colour table. */
export function GuideGenusIntro({ g }: { g: GuideGenus | undefined }) {
  if (!g) return null;
  if (!g.description && g.requires.length === 0 && !g.colours) return null;
  return (
    <div className="fg-genus-intro">
      {g.description ? <p className="fg-gdesc">{g.description}</p> : null}
      {g.sampleDistanceM ? <span className="fg-chip">Clonal range {g.sampleDistanceM.toLocaleString("en-US")} m</span> : null}
      <GuideRequires list={g.requires} />
      <GuideColoursBlock c={g.colours} />
    </div>
  );
}

export type { GuideSpecies };
