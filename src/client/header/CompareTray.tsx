/**
 * Compare's tray under the app bar: the data value, D-Scan, the neutron route, FSD wear, first discovery,
 * the route and fuel, and the next boxel. Moved out of HeaderBar.tsx (audit 2026-10-22), with the route
 * card's distance/refuel switch, which only the tray shows.
 */
import { Tooltip } from "../ui/Tooltip";
import { NextBoxelCard } from "../NextBoxelCard";
import { fmtCrExact, fmtCrShort, fmtLy } from "@shared/format";
import { useEffect, useState, type ReactNode } from "react";
import { DScanBodiesBadge } from "../DScanBodiesBadge";
import type { AppSnapshot } from "@shared/types";
import {
  readRouteHeaderMetricMode,
  routeHeaderBarAria,
  routeHeaderBarModel,
  routeHeaderToggleTitleHint,
  routeNavCardTitle,
  writeRouteHeaderMetricMode,
} from "../routeHeader";
import type { RouteHeaderMetricMode } from "../routeHeader";

/*
  An AFMU repairs the FSD in flight (owner, 2026-10-13, the Laboratory): when one is fitted, the FSD warning says so and
  how many refills the hold makes. Its ammunition is not in the journals, so not how full it is.
*/
function afmuNote(j: AppSnapshot["jumponium"]): string {
  if (!j?.afmu?.length) return "";
  const made = j.known ? (j.afmTiers ?? []).map((t) => `${t.count} ${t.name}`).join(", ") : null;
  return ` An AFMU is fitted: it repairs the FSD in flight.${made ? ` AFM refills you can make: ${made}.` : ""}`;
}

export function CompareTray({
  snap,
  scanDataOn,
  totalDataCr,
  dataValueFlash,
  pendingSamplesFlash,
  onToggleScanData,
  onOpenBreakdown,
}: {
  snap: AppSnapshot;
  scanDataOn: boolean;
  totalDataCr: number;
  /*
    The two flashes stay with the header, which is always mounted, so a value that changes while the
    tray is folded flashes exactly as it did when the tray was part of the header.
  */
  dataValueFlash: string;
  pendingSamplesFlash: string;
  onToggleScanData: () => void;
  onOpenBreakdown: () => void;
}) {
  const [routeHeaderMetricMode, setRouteHeaderMetricMode] = useState<RouteHeaderMetricMode>(() =>
    readRouteHeaderMetricMode(),
  );

  useEffect(() => {
    writeRouteHeaderMetricMode(routeHeaderMetricMode);
  }, [routeHeaderMetricMode]);

  const routeCardRefuelClass = (() => {
    const nav = snap.liveShipFuelRange?.navRoute;
    if (!nav?.onPlot) return "";
    if (nav.routeRefuelAlert === "red") return " header-route--refuel-red";
    if (nav.routeRefuelAlert === "yellow") return " header-route--refuel-yellow";
    return "";
  })();

  return (
    <div className="header-data-value-row header-tray" id="header-tray">
      <button
        type="button"
        className={`header-scan-data-plus${scanDataOn ? " header-scan-data-plus--on" : ""}`}
        onClick={onToggleScanData}
        title="Add planetary scans to data value"
        aria-pressed={scanDataOn}
      >
        ⊕
      </button>
      <button
        type="button"
        className="data-value-pill data-value-pill--clickable tray-tile"
        title={
          scanDataOn
            ? "Unsold exobiology plus your unsold planetary scans — click for a breakdown"
            : "Unsold exobiology — click for a per-sample breakdown. ⊕ adds your unsold planetary scans."
        }
        onClick={onOpenBreakdown}
      >
        {/* "Data value" either way (owner, 2026-09-30); the tooltip says what it holds. */}
        <span className="data-value-label tray-tile__label">Data value</span>
        <span className="tray-tile__value">
          <span className={`data-value-amount ${dataValueFlash}`.trim()} title={fmtCrExact(totalDataCr)}>
            {fmtCrShort(totalDataCr)} CR
          </span>
          {snap.organicPendingSampleCount > 0 ? (
            <span
              className={`data-value-meta tray-tile__meta ${pendingSamplesFlash}`.trim()}
              title="Completed samples not yet sold"
            >
              ({snap.organicPendingSampleCount})
            </span>
          ) : null}
        </span>
      </button>
      <div className="header-dscan-cluster">
        <div className="header-dscan-pill">
          {snap.dScanBodies ? (
            <DScanBodiesBadge d={snap.dScanBodies} className="d-scan-card--header-row" headerMetrics />
          ) : (
            <Tooltip text="No FSS honk line in merged journal for this system yet — if you already mapped everything, totals still come from Scan rows and the system map. Use “Load bodies from EDSM” next to the search when browsing a system, or widen journal history / re-honk in game if counts stay empty.">
              <button
                type="button"
                className="d-scan-card d-scan-card--placeholder d-scan-card--header-row tray-tile"
              >
                <span className="tray-tile__label">D-Scan</span>
                <span className="tray-tile__value">
                  <span className="tray-tile__meta">No body tally yet</span>
                </span>
              </button>
            </Tooltip>
          )}
        </div>
        {snap.neutronLive ? (
          <div
            className="d-scan-card d-scan-card--header-row header-route-mini header-neutron tray-tile"
            title={
              snap.neutronLive.done
                ? `Neutron route done: ${snap.neutronLive.destination}`
                : `Neutron route to ${snap.neutronLive.destination}: stop ${snap.neutronLive.at} of ${snap.neutronLive.total}. The next stop is on the clipboard after each jump onto a stop: target it in the game's galaxy map, don't plot a route to it: the game can refuse to plot a full-range jump on a part tank (F6 copies it again).`
            }
          >
            <span className="tray-tile__label">
              {snap.neutronLive.done
                ? "⚡ Route done"
                : snap.neutronLive.refuelHere
                  ? snap.neutronLive.refuelHalf
                    ? "⛽ Scoop to half"
                    : "⛽ Scoop here"
                  : snap.neutronLive.superchargeHere
                    ? "⚡ Supercharge here"
                    : `⚡ ${snap.neutronLive.at}/${snap.neutronLive.total}`}
            </span>
            <span className="tray-tile__value">{snap.neutronLive.next ?? snap.neutronLive.destination}</span>
          </div>
        ) : null}
        {snap.fsdHealth?.warn ? (
          <div
            className="d-scan-card d-scan-card--header-row header-route-mini header-fsd-warn tray-tile"
            title={`The FSD is at ${snap.fsdHealth.estimate ? "about " : ""}${Math.round(snap.fsdHealth.health * 100)} % (the last Loadout, less ${snap.fsdHealth.boostsSince} supercharge${snap.fsdHealth.boostsSince === 1 ? "" : "s"} since): further jumps before a repair are not recommended. Carriers → Stations → Repair finds the nearest.${afmuNote(snap.jumponium)}`}
          >
            <span className="tray-tile__label">FSD</span>
            <span className="tray-tile__value">
              ⚠ {snap.fsdHealth.estimate ? "~" : ""}
              {Math.round(snap.fsdHealth.health * 100)} %
            </span>
          </div>
        ) : null}
        {snap.focusedSystemUndiscovered ? (
          <div
            className="d-scan-card d-scan-card--complete d-scan-card--header-row header-route-mini tray-tile"
            title="You scanned this system's main star before anyone else had — the system is your discovery, and its cartographic data pays the first-discovery bonus."
          >
            {/* On two lines like the other tiles (owner, 2026-10-27). */}
            <span className="tray-tile__label">◆ First</span>
            <span className="tray-tile__value">Discovery</span>
          </div>
        ) : null}
        {snap.remainingJumpsInRoute != null || snap.liveShipFuelRange != null
          ? (() => {
              const fr = snap.liveShipFuelRange;
              const nav = fr?.navRoute;
              const jumpsShown =
                nav?.onPlot && nav.routeJumpsRemaining != null
                  ? nav.routeJumpsRemaining
                  : snap.remainingJumpsInRoute;
              const barModel = routeHeaderBarModel(snap, routeHeaderMetricMode);
              const barTitle = `${routeNavCardTitle(snap)}\n\n${routeHeaderToggleTitleHint(routeHeaderMetricMode)}`;
              const barAria = routeHeaderBarAria(snap, routeHeaderMetricMode, barModel);
              let sepN = 0;
              const sep = () => (
                <span key={`sep-${sepN++}`} className="tray-tile__meta">
                  {" · "}
                </span>
              );
              const compactLine: ReactNode[] = [];
              if (nav) {
                if (jumpsShown != null) {
                  compactLine.push(
                    <span key="j" className="header-route-num">
                      {jumpsShown}
                    </span>,
                    sep(),
                  );
                }
                if (routeHeaderMetricMode === "refuel" && nav.onPlot) {
                  const jl = nav.jumpsToLastScoopableOnRoute;
                  compactLine.push(
                    <span key="refuel" className="header-route-refuel-metric">
                      {jl != null ? `Refuel in ${jl}` : "No scoop ahead"}
                    </span>,
                  );
                } else {
                  compactLine.push(
                    <span key="ly">
                      {nav.onPlot && nav.routeRemainingLy != null
                        ? `${fmtLy(nav.routeRemainingLy)} left`
                        : fmtLy(nav.routeTotalLy)}
                    </span>,
                  );
                }
              } else if (jumpsShown != null) {
                compactLine.push(<span key="jonly">{jumpsShown}</span>);
              }
              if (fr && !nav?.onPlot && fr.estJumpsRemaining != null && fr.hasLiveStatusFuel) {
                if (compactLine.length) compactLine.push(sep());
                compactLine.push(
                  <span key="est" className="tray-tile__meta">
                    ~{fr.estJumpsRemaining} max
                  </span>,
                );
              }
              if (nav && !nav.onPlot) {
                if (compactLine.length) compactLine.push(sep());
                compactLine.push(
                  <span key="off" className="tray-tile__meta">
                    off plot
                  </span>,
                );
              }
              const lineContent = compactLine.length > 0 ? compactLine : <span className="tray-tile__meta">—</span>;
              const barBg = barModel.indeterminate
                ? undefined
                : `linear-gradient(to right, rgba(90, 170, 255, 0.95) 0%, rgba(90, 170, 255, 0.95) ${barModel.bluePct}%, rgba(220, 70, 70, 0.92) ${barModel.bluePct}%, rgba(220, 70, 70, 0.92) 100%)`;
              return (
                <div
                  className={`d-scan-card d-scan-card--route d-scan-card--header-row header-route-mini header-route-mini--stacked tray-tile${routeCardRefuelClass}`}
                >
                  <button
                    type="button"
                    className="header-route-compact header-route-compact--toggle"
                    title={barTitle}
                    aria-label={barAria}
                    onClick={() =>
                      setRouteHeaderMetricMode((m) => (m === "distance" ? "refuel" : "distance"))
                    }
                  >
                    <span className="tray-tile__label">Route</span>
                    <span className="tray-tile__value">{lineContent}</span>
                    {barModel.showBar ? (
                      <div
                        className={`header-route-bar-track${barModel.indeterminate ? " header-route-bar-track--unknown" : ""}`}
                        style={barModel.indeterminate ? undefined : { background: barBg }}
                      />
                    ) : null}
                  </button>
                </div>
              );
            })()
          : null}
        <NextBoxelCard systemAddress={snap.currentSystemAddress} />
      </div>
    </div>
  );
}
