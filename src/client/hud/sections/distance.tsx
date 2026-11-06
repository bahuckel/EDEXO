import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { HudSnapshot } from "../types";
import { cueFromOverlay } from "../audio";
import { cap, fmtClock, fmtCr } from "../core";
import { pref } from "../theme";
import { Guide } from "../guide";
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
  // On a surface when there is a map to draw (drawMinimap draws nothing and says false without one). A map of the
  // planet flown over (`near`) opens it with "Radar always on" (owner, 2026-11-04: the composition scanner's marks are
  // of no use while the radar folds shut off the ground).
  // A composition scan on the planet flown over opens it too (owner, 2026-11-04: "tracker radar not activating on comp
  // scan"): with something to show, the switch is not needed.
  const map = d.exoMinimap;
  const flownOverShows = !!map?.marks.some((m) => m.kind === "codex") || pref("edexoHudRadarAlways", "0") === "1";
  const onSurface = !d.journalBoot && !!map?.marks && (!map.near || flownOverShows);
  // Before the first snapshot the block stands open, as the page's markup did: the first frame folds it if it must.
  // A run in progress opens it only where there is a radar (owner, 2026-11-06: "radar not minimized" in supercruise at
  // 1 / 3: the game keeps the run until a sample elsewhere, Status.json has no position there); the head still says
  // "Sampling 1 / 3".
  const showTracker = waiting || onSurface || (live && !!map);
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
    // Folded with a run in progress (off the planet): the head still names it.
    status = d.journalBoot ? "Journal loading" : live && !waiting ? "Sampling " + Math.min(eo!.sampleCount || 0, 3) + " / 3" : "Standby";
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
            {e.footfallMult === 5 ? (
              <>
                {" "}
                <span style={{ opacity: 0.85 }}>(first footfall 5×)</span>
              </>
            ) : null}
          </>
        ) : (
          fmtCr(null)
        );
      note = e.footfallMult === 5 ? "Includes the first-footfall 5× on this body." : "No first-footfall 5× on this body.";
      cele = "Complete — hiding in " + (e.celebrationRemainSec || 0) + "s";
    } else {
      /*
        The estimate from the first scan (owner, 2026-10-02: "show the value after Log, not after
        Sample"): the Log names the species, which is all the price needs. It waited for the second.
      */
      const a = e.payEstimate;
      if (e.sampleCount >= 1 && a != null) {
        pay = (
          <span className="pay-est">
            {fmtCr(a)}
            {e.footfallMult === 5 ? <small>first footfall 5×</small> : null}
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
          e.footfallMult === 5
            ? "The list price × 5: you made the first footfall on this body."
            : "The list price: the first footfall here was not yours (no 5×).";
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
        {showTracker && !waiting ? <Guide map={map} /> : null}
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
