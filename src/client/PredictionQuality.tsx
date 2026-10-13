/**
 * "How good are my predictions" in Statistics (plan 1.9, 2026-10-11): the prediction log, scored on the
 * server (`predictionQuality.ts`). A calibration chart (what the app said against what grew, on bodies
 * where every signal was sampled), first-in-genus hit rates per genus and species, the misses with what
 * beat them, and the same by app version so a refit shows its effect.
 */
import { useEffect, useState } from "react";
import type { CalibrationBandDTO, PredictionHitsDTO, PredictionQualityDTO } from "@shared/dto/predictions";
import { LoadingNote } from "./ui/Loading";

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : "—");

/*
  In tw: utilities (plan 3.4, 2026-10-12): no rules of its own in statistics.css. The tables share
  stats-rec with the rest of Statistics and keep it; the pq-* names stay as hooks.
*/
const SERIES = {
  fss: {
    line: "tw:fill-none tw:[stroke-width:1.2] tw:stroke-[var(--accent-a45)]",
    dot: "tw:fill-none tw:stroke-accent tw:[stroke-width:1.3]",
  },
  dss: {
    line: "tw:fill-none tw:[stroke-width:1.2] tw:stroke-[rgba(79,208,255,0.5)]",
    dot: "tw:[fill:var(--ok,#4fd0ff)] tw:[fill-opacity:0.75]",
  },
} as const;
const GRID_TEXT = "tw:fill-muted tw:[font-size:8px]";
const GRID_LINE = "tw:stroke-[rgba(255,255,255,0.07)]";
const KEY = "pq-key tw:inline-block tw:w-[8px] tw:h-[8px] tw:rounded-[50%] tw:align-middle";
const MISSES_SHOWN = 12;

/* ------------------------------------------------------------------ calibration chart */

const CW = 260;
const CH = 200;
const PAD = 28;

function Series({ bands, cls, label }: { bands: CalibrationBandDTO[]; cls: "fss" | "dss"; label: string }) {
  const max = Math.max(1, ...bands.map((b) => b.n));
  const x = (said: number) => PAD + (said / 100) * (CW - PAD - 8);
  const y = (was: number) => CH - PAD - (was / 100) * (CH - PAD - 8);
  const pts = bands.filter((b) => b.n > 0);
  return (
    <g className={`pq-cal__${cls}`}>
      <polyline
        className={SERIES[cls].line}
        points={pts.map((b) => `${x(b.saidMean).toFixed(1)},${y((b.there / b.n) * 100).toFixed(1)}`).join(" ")}
      />
      {pts.map((b) => (
        <circle className={SERIES[cls].dot} key={b.band} cx={x(b.saidMean)} cy={y((b.there / b.n) * 100)} r={2.5 + 4 * Math.sqrt(b.n / max)}>
          <title>
            {`${label}, said ${b.band * 10}–${b.band * 10 + 10} % (mean ${b.saidMean} %): there on ${b.there} of ${b.n} (${pct(b.there, b.n)})`}
          </title>
        </circle>
      ))}
    </g>
  );
}

function CalibrationChart({ q }: { q: PredictionQualityDTO }) {
  const ticks = [0, 25, 50, 75, 100];
  const x = (v: number) => PAD + (v / 100) * (CW - PAD - 8);
  const y = (v: number) => CH - PAD - (v / 100) * (CH - PAD - 8);
  return (
    <figure className="pq-cal tw:m-0 tw:w-[min(100%,20rem)]">
      <svg
        className="tw:block tw:w-full tw:h-auto tw:[background:var(--panel-2,rgba(255,255,255,0.03))]"
        viewBox={`0 0 ${CW} ${CH}`}
        role="img"
        aria-label="What the app said against how often it was there"
      >
        {ticks.map((t) => (
          <g key={t} className="pq-cal__grid">
            <line className={GRID_LINE} x1={x(t)} x2={x(t)} y1={y(0)} y2={y(100)} />
            <line className={GRID_LINE} x1={x(0)} x2={x(100)} y1={y(t)} y2={y(t)} />
            <text className={GRID_TEXT} x={x(t)} y={CH - PAD + 12} textAnchor="middle">
              {t}
            </text>
            <text className={GRID_TEXT} x={PAD - 4} y={y(t) + 3} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        <line
          className="pq-cal__ideal tw:stroke-[rgba(255,255,255,0.35)] tw:[stroke-dasharray:3_3]"
          x1={x(0)} y1={y(0)} x2={x(100)} y2={y(100)} />
        <text className={`pq-cal__axis ${GRID_TEXT}`} x={x(50)} y={CH - 2} textAnchor="middle">
          the app said (%)
        </text>
        <text className={`pq-cal__axis ${GRID_TEXT}`} x={8} y={y(50)} textAnchor="middle" transform={`rotate(-90 8 ${y(50)})`}>
          it was there (%)
        </text>
        <Series bands={q.calibration.fss} cls="fss" label="Before the DSS" />
        <Series bands={q.calibration.dss} cls="dss" label="After the DSS" />
      </svg>
      <figcaption className="dim tw:mt-2 tw:text-2xs tw:leading-[1.4]">
        <span className={`${KEY} pq-key--fss tw:[border:1.3px_solid_var(--accent)]`} /> before the DSS ·{" "}
        <span className={`${KEY} pq-key--dss tw:[background:var(--ok,#4fd0ff)]`} /> after it. On the line
        the chance was right; above it the app was too cautious, below it too sure. Dot size is how many candidates.
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ tables */

function HitsRow({ h, sub }: { h: PredictionHitsDTO; sub?: boolean }) {
  return (
    <tr className={sub ? "pq-sub" : undefined}>
      <td className={sub ? "tw:pl-[1.6rem] tw:text-text-dim" : undefined}>{h.label}</td>
      <td className="stats-rec__n">{h.n}</td>
      <td className="stats-rec__n">
        <b>{pct(h.top, h.n)}</b>
      </td>
      <td className="stats-rec__n">{h.shown || ""}</td>
      <td className="stats-rec__n">{h.unlikely || ""}</td>
      <td className="stats-rec__n">{h.absent || ""}</td>
    </tr>
  );
}

function HitsTable({ q }: { q: PredictionQualityDTO }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="stats-rec__scroll">
      <table className="stats-rec">
        <thead>
          <tr>
            <th>Genus</th>
            <th className="stats-rec__n" title="Confirmed and scored">
              Scored
            </th>
            <th className="stats-rec__n" title="The confirmed species was first among its genus on the list before landing">
              First
            </th>
            <th className="stats-rec__n" title="Shown, but another of its genus was above it">
              Below
            </th>
            <th className="stats-rec__n" title="Only behind “show unlikely”">
              Unlikely
            </th>
            <th className="stats-rec__n" title="Never offered">
              Missing
            </th>
          </tr>
        </thead>
        <tbody>
          {q.genera.map((g) => {
            const kids = q.species.filter((s) => s.genus === g.key);
            return [
              <tr key={g.key} className="pq-genus tw:cursor-pointer" onClick={() => setOpen((k) => (k === g.key ? null : g.key))}>
                <td>
                  <button
                    type="button"
                    className="pq-toggle tw:[background:none] tw:[border:none] tw:p-0 tw:[color:inherit] tw:[font:inherit] tw:cursor-pointer"
                    aria-expanded={open === g.key}
                  >
                    {open === g.key ? "▾" : "▸"} {g.label}
                  </button>
                </td>
                <td className="stats-rec__n">{g.n}</td>
                <td className="stats-rec__n">
                  <b>{pct(g.top, g.n)}</b>
                </td>
                <td className="stats-rec__n">{g.shown || ""}</td>
                <td className="stats-rec__n">{g.unlikely || ""}</td>
                <td className="stats-rec__n">{g.absent || ""}</td>
              </tr>,
              ...(open === g.key ? kids.map((s) => <HitsRow key={s.key} h={s} sub />) : []),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

const VERDICT: Record<string, string> = { shown: "below another", unlikely: "only under unlikely", absent: "not offered" };

function Misses({ q }: { q: PredictionQualityDTO }) {
  const [all, setAll] = useState(false);
  if (!q.misses.length) return <p className="dim stats-note">No misses: every confirmed species was first in its genus.</p>;
  const shown = all ? q.misses : q.misses.slice(0, MISSES_SHOWN);
  return (
    <>
      <ul className="pq-misses tw:list-none tw:m-[0_0_0.4rem] tw:p-0 tw:grid tw:gap-[0.15rem] tw:text-xs">
        {shown.map((m, i) => (
          <li key={`${m.bodyName}-${m.grew}-${i}`}>
            <span className="dim tiny">{m.at.slice(0, 10)}</span> <b>{m.bodyName}</b>: {m.grew}
            {m.grewPercent != null ? ` (${m.grewPercent.toFixed(1)} %)` : ""} grew, {VERDICT[m.verdict]}
            {m.beatenBy ? (
              <>
                {" "}
                · first was <b>{m.beatenBy}</b>
                {m.beatenByPercent != null ? ` (${m.beatenByPercent.toFixed(1)} %)` : ""}
              </>
            ) : null}
            <span className="dim tiny"> · {m.stage === "dss" ? "after the DSS" : "before the DSS"}</span>
          </li>
        ))}
      </ul>
      {q.misses.length > MISSES_SHOWN ? (
        <button type="button" className="btn-top-toggle" onClick={() => setAll((v) => !v)}>
          {all ? "Fewer" : `All ${q.misses.length} misses`}
        </button>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ section */

export function PredictionQualitySection() {
  // undefined while loading; null when the log is off or empty.
  const [q, setQ] = useState<PredictionQualityDTO | null | undefined>(undefined);
  useEffect(() => {
    void fetch("/api/predictions/quality", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: PredictionQualityDTO | null) => setQ(j && j.scoredBodies > 0 ? j : null))
      .catch(() => setQ(null));
  }, []);
  if (q === undefined) return <LoadingNote label="Scoring your predictions…" />;
  if (!q) return null;
  const versions = q.versions.filter((v) => v.n > 0);
  return (
    <>
      <h3 className="stats-h3">How good are my predictions</h3>
      <p className="dim stats-note">
        Every species you confirmed, against the app's list just before your first sample on that body: {q.scoredBodies} bodies
        ({q.completeBodies} with every signal sampled, which the chart uses).
        {q.unscored ? ` ${q.unscored} confirmations had no list from before them (journal replay or a late start).` : ""}
      </p>
      <div className="pq-top tw:flex tw:flex-wrap tw:items-start tw:gap-[0.8rem_1.4rem] tw:m-[0.4rem_0_0.6rem]">
        <CalibrationChart q={q} />
        {versions.length > 1 || versions[0]?.appVersion ? (
          <table className="stats-rec pq-versions tw:w-auto tw:min-w-[14rem]">
            <thead>
              <tr>
                <th>Version</th>
                <th className="stats-rec__n">Scored</th>
                <th className="stats-rec__n">First</th>
                <th className="stats-rec__n">Shown</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.appVersion ?? "before"}>
                  <td>{v.appVersion ?? "before 1.2.15"}</td>
                  <td className="stats-rec__n">{v.n}</td>
                  <td className="stats-rec__n">{pct(v.top, v.n)}</td>
                  <td className="stats-rec__n">{pct(v.shown, v.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
      <HitsTable q={q} />
      <h4 className="pq-h4 tw:m-[0.7rem_0_0.25rem] tw:text-xs tw:text-muted tw:font-[600]">Misses, newest first</h4>
      <Misses q={q} />
    </>
  );
}
