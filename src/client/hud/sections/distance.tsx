import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { HudSnapshot } from "../types";
import { cueFromOverlay } from "../audio";
import { cap, fmtClock, fmtCr } from "../core";
import { drawMinimap } from "../radar";
import { Head, Metres, Pill, type HudSection } from "../parts";
import { useLiveRev } from "../store";

/*
  Layout: the radar on the left, everything about the run on the right. Away from a surface the
  whole block folds shut (CSS transition on `.trk--away`) and a one-line message takes its place,
  so leaving a planet is a closing animation rather than a jump-cut.
*/

/** Live (sampling) and too close: the facts both the content and the frame colour read. */
function readRun(d: HudSnapshot) {
  const eo = d.exoOrganicOverlay;
  const live = !d.journalBoot && !!eo && eo.visible === true;
  // Standing on top of a plant is the same mistake whether you are looking for the second or the
  // third, and `nearestSampleMeetsMin` measures against every plant taken, not only the first.
  const hunting = live && (eo!.sampleCount === 1 || eo!.sampleCount === 2);
  const tooClose = hunting && eo!.nearestSampleMeetsMin === false;
  return { eo, live, tooClose };
}

function Row({
  label,
  muted,
  taken,
  scan,
  rule,
  children,
}: {
  label: string;
  muted?: boolean;
  taken?: boolean;
  scan?: boolean;
  rule?: boolean;
  children: ReactNode;
}) {
  const cls =
    "row" + (scan ? " row--scan" : "") + (rule ? " row--rule" : "") + (muted ? " row--muted" : "") + (taken ? " row--taken" : "");
  return (
    <div className={cls}>
      <span className="lbl">{label}</span>
      {children}
    </div>
  );
}

function Distance({ d, waiting = false }: { d: HudSnapshot; waiting?: boolean }) {
  // A radar frame (renderExoLive) merges into the snapshot in place and bumps this.
  useLiveRev();
  const svg = useRef<SVGSVGElement>(null);
  const { eo, live, tooClose } = readRun(d);
  // On a surface when there is a map to draw (drawMinimap draws nothing and says false without one).
  const onSurface = !d.journalBoot && !!(d.exoMinimap && d.exoMinimap.marks);
  // Before the first snapshot the block stands open, as the page's markup did: the first frame folds it if it must.
  const showTracker = waiting || onSurface || live;
  useLayoutEffect(() => {
    // The cue fires on the edge, once per frame of the run, as the tracker's render always fed it.
    cueFromOverlay(eo);
    if (svg.current && !d.journalBoot) drawMinimap(svg.current, d.exoMinimap, tooClose);
  });

  let status: string;
  let species = "—";
  let minGap = "—";
  let d1: number | null = null;
  let d2: number | null = null;
  let d3: number | null = null;
  const muted = { d1: !waiting, d2: !waiting, d3: !waiting, minGap: !waiting, timer: !waiting };
  const taken = [false, false, false];
  let pill2: boolean | null | undefined;
  let pill3: boolean | null | undefined;
  let pay: ReactNode = <span className="row--muted">—</span>;
  let note = "";
  let noteExplain = true;
  let cele: string | null = null;
  let timer = "—";
  if (waiting || !showTracker) {
    status = d.journalBoot ? "Journal loading" : "Standby";
    if (waiting) {
      noteExplain = false;
      pay = "—";
    }
  } else if (!live) {
    status = "On foot";
    species = "No sample in progress";
    note = "The radar shows your ship and any plants taken here while this app was running.";
  } else {
    const e = eo!;
    status =
      e.phase === "celebrate" ? "Complete" : tooClose ? "Too close" : "Sampling " + Math.min(e.sampleCount || 0, 3) + " / 3";
    species = cap(e.speciesDisplay || "—");
    // Which scans are taken, for the Elite Style's status squares (owner, 2026-10-04).
    for (let i = 0; i < 3; i++) taken[i] = e.phase === "celebrate" || (e.sampleCount || 0) > i;
    minGap = e.minSampleDistanceM > 0 ? e.minSampleDistanceM + " m" : "—";
    muted.minGap = false;
    muted.d1 = e.distToFirstM == null && e.phase === "tracking";
    d1 = e.distToFirstM;
    muted.d2 = e.sampleCount < 2 || (e.phase === "tracking" && e.distToSecondM == null);
    d2 = e.sampleCount >= 2 ? e.distToSecondM : null;
    // The third sample only exists once Analyse has been taken, and then it is a place like the others.
    muted.d3 = e.distToThirdM == null;
    d3 = e.distToThirdM;
    /*
      The pill answers one question — "far enough to take the next one here?" — so it belongs on the row for the
      scan about to be taken, and on that row only. `nearestSampleMeetsMin` measures against the nearest plant
      already sampled, which is the rule the game enforces.
    */
    pill2 = e.sampleCount === 1 ? e.nearestSampleMeetsMin : undefined;
    pill3 = e.sampleCount === 2 ? e.nearestSampleMeetsMin : undefined;
    // The run timer: first Log/Sample of this species on this body to now (frozen on completion).
    const startMs = e.runStartedIso ? Date.parse(e.runStartedIso) : NaN;
    muted.timer = !isFinite(startMs);
    timer = isFinite(startMs) ? fmtClock(Date.now() - startMs) : "—";
    if (e.phase === "celebrate") {
      pay =
        e.finalCredits != null ? (
          <>
            {fmtCr(e.finalCredits)}
            {e.analyseWasLogged === true ? (
              <>
                {" "}
                <span style={{ opacity: 0.7 }}>(logged)</span>
              </>
            ) : (
              <>
                {" "}
                <span style={{ opacity: 0.85 }}>(new codex 5×)</span>
              </>
            )}
          </>
        ) : (
          fmtCr(null)
        );
      note =
        e.analyseWasLogged === true
          ? e.footfallMult === 5
            ? "Includes first-footfall 5× on this body."
            : "No first-footfall 5× on this body."
          : e.footfallMult === 5
            ? "5× new-codex payout (first footfall does not stack another ×5)."
            : "5× new-codex payout.";
      cele = "Complete — hiding in " + (e.celebrationRemainSec || 0) + "s";
    } else {
      /*
        The estimate from the first scan (owner, 2026-10-02: "show the value after Log, not after
        Sample"): the Log names the species, which is all the price needs. It waited for the second.
      */
      const a = e.payLoggedCodex;
      const b = e.payNewCodex;
      if (e.sampleCount >= 1 && a != null && b != null) {
        pay = (
          <span className="pay-est">
            {fmtCr(b).replace(" CR", "")}
            <small>new</small>· {fmtCr(a).replace(" CR", "")}
            <small>logged</small>
          </span>
        );
      } else if (e.sampleCount >= 1) pay = "—";
      if (e.sampleCount === 1) {
        // Walk-distance guidance is a reading, not an explanation: it stays in compact mode.
        noteExplain = false;
        note = tooClose
          ? "Too close to Scan 1 — walk ≥ " + (e.minSampleDistanceM || "?") + " m the way the radar arc points."
          : "Need ≥ " + (e.minSampleDistanceM || "?") + " m from first sample before second.";
      } else if (e.sampleCount >= 2) {
        note =
          "Estimates: new codex = 5× list; logged codex = list × footfall (×1 or ×5). These are not multiplied together.";
      } else {
        noteExplain = false;
        note = "";
      }
    }
  }

  return (
    <>
      <Head title="Exo-distance tracker" status={status} />
      <div className={"trk" + (showTracker ? "" : " trk--away")} data-f="trk">
        <div className="trk__inner">
          {/* Drawn by radar.ts; React renders the element and nothing in it. */}
          <svg
            ref={svg}
            className="minimap trk__radar"
            data-f="minimap"
            viewBox="-112 -112 224 224"
            role="img"
            aria-label="Where your samples and ship are, around you"
          />
          <div className="trk__side">
            <div className="hud-big trk__species" data-f="species">
              {species}
            </div>
            <Row label="Scan 1" scan muted={muted.d1} taken={taken[0]}>
              <Metres className="val" field="d1" value={d1} />
            </Row>
            <Row label="Scan 2" scan muted={muted.d2} taken={taken[1]}>
              <span className="val">
                <Metres field="d2" value={d2} />
                <span data-f="pill2">
                  <Pill ok={pill2} />
                </span>
              </span>
            </Row>
            <Row label="Scan 3" scan muted={muted.d3} taken={taken[2]}>
              <span className="val">
                <Metres field="d3" value={d3} />
                <span data-f="pill3">
                  <Pill ok={pill3} />
                </span>
              </span>
            </Row>
            <Row label="Min gap" muted={muted.minGap}>
              <span className="val" data-f="minGap">
                {minGap}
              </span>
            </Row>
            <Row label="Run time" muted={muted.timer}>
              <span className="val" data-f="timer">
                {timer}
              </span>
            </Row>
          </div>
        </div>
        <Row label="Payout" rule>
          <span className="val" data-f="pay">
            {pay}
          </span>
        </Row>
        <div className={"hud-note" + (noteExplain ? " hud-explain" : "")} data-f="note">
          {note}
        </div>
        <div className="cele" data-f="cele" style={{ display: cele ? "block" : "none" }}>
          {cele}
        </div>
      </div>
      <div className={"trk__away" + (showTracker ? "" : " trk__away--on")} data-f="away">
        Approach a planet to see the tracker
      </div>
    </>
  );
}

export const distance: HudSection = {
  /* "Only when relevant": on or near a surface, where the tracker is live. */
  relevant: (d) => !d.journalBoot && !!d.exoOrganicOverlay && d.exoOrganicOverlay.visible === true,
  title: "Exo-distance tracker",
  state: (d) => {
    const { eo, live, tooClose } = readRun(d);
    if (!live) return null;
    return eo!.phase === "celebrate" ? "ok" : tooClose ? "warn" : null;
  },
  initial: () => <Distance d={{}} waiting />,
  render: (d) => <Distance d={d} />,
  // The run clock counts each second; the radar follows each live frame.
  ticks: true,
  live: true,
};
