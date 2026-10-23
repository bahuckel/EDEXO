/**
 * The next trip as route steps, one card per stop (R5b, cards mockup P5), and the trips after it as a card grid (P6).
 * Nothing is ticked by hand (owner, 2026-10-23: "keep it automatic, no ticks"): a buy is done when its cargo is
 * aboard, a delivery when the site has it, and a trip done out of order makes a new plan from what is left. A line or
 * a trip that is done stays where it is, green or faint, so nothing jumps under the mouse (15a b).
 */
import { useRef, useState } from "react";
import { useFlip } from "../../ui/useFlip";
import type { HaulTrip, TripStop } from "../../../shared/colonize/logisticsPlanner";
import { formatHopLy } from "../../../shared/colonize/systemDistanceLy";
import { formatPrice, formatTons as t } from "../../../shared/colonize/formatPrice";
import { siteTotals } from "../../../shared/colonize/siteMaterials";
import type { DepotSnapshot } from "../../../shared/colonize/types";
import { tripBuyLineId, tripDeliverLineId } from "../../../shared/colonize/tripPlanProgress";
import { BTN, BTN_GO, BTN_LINK, Panel, copyText } from "./ui";

type TripProps = {
  trips: HaulTrip[];
  completed: Set<string>;
  onBan: (systemName: string, stationName: string) => void;
  /** The sites being built: what a delivery adds to each ("+3 % once delivered"). */
  sites?: DepotSnapshot[];
  /** A paired phone: nothing writes. */
  readOnly?: boolean;
};

/** Every line of a trip: its buys, and each site's delivery. */
function tripLineIds(trip: HaulTrip): string[] {
  const ids: string[] = [];
  for (const s of trip.stops) {
    for (const b of s.buys) ids.push(tripBuyLineId(trip.tripNumber, s.stopIndex, b.commodityId));
    for (const d of s.deliveries ?? [])
      for (const mat of d.materials) ids.push(tripDeliverLineId(trip.tripNumber, s.stopIndex, d.depotMarketId, mat.commodityId));
  }
  return ids;
}
const tripDone = (trip: HaulTrip, completed: Set<string>) => {
  const ids = tripLineIds(trip);
  return ids.length > 0 && ids.every((id) => completed.has(id));
};

/** A stop's facts as chips: distance, pad, from the star, the station's type, planet port, bought here before. */
function StopChips({ s }: { s: TripStop }) {
  return (
    <div className="cz-chiprow">
      <span className="sys-chip">{formatHopLy(s.distanceLy)}</span>
      {s.pad ? <span className="sys-chip">{s.pad} pad</span> : null}
      {s.arrivalLs != null ? (
        <span className="sys-chip" title="From the arrival star">
          {Math.round(s.arrivalLs).toLocaleString("en-US")} ls
        </span>
      ) : null}
      {s.stationType ? <span className="sys-chip sys-chip--dim">{s.stationType}</span> : null}
      {s.isPlanetaryOrGround ? <span className="sys-chip">Planet port</span> : null}
      {s.boughtBefore ? <span className="sys-chip sys-chip--accent">Bought before</span> : null}
    </div>
  );
}

/** "Copy <system>" on a stop (15a a: every stop); the first open one is the filled button. */
function CopyStop({ system, primary }: { system: string; primary: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`${primary ? BTN_GO : BTN} cz-btn--sm`}
      title={`Copy “${system}” for the galaxy map`}
      onClick={() => {
        void copyText(system);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? "Copied" : `Copy ${system}`}
    </button>
  );
}

export function NextTripCard({ trips, completed, onBan, sites = [], readOnly = false }: TripProps) {
  const next = trips.find((tr) => !tripDone(tr, completed));
  if (!next) {
    return (
      <Panel k="next-trip" tone="info" title="All planned trips done">
        <p style={{ margin: 0 }}>Every trip in the plan is bought and delivered. New trips appear as the sites report what they still need.</p>
      </Panel>
    );
  }
  const stops = next.stops
    .filter((s) => (s.kind === "buy" ? s.buys.length > 0 : (s.deliveries ?? []).length > 0))
    .sort((a, b) => a.stopIndex - b.stopIndex);
  const stopDone = (s: TripStop) =>
    s.kind === "buy"
      ? s.buys.every((b) => completed.has(tripBuyLineId(next.tripNumber, s.stopIndex, b.commodityId)))
      : (s.deliveries ?? []).every((d) =>
          d.materials.every((m) => completed.has(tripDeliverLineId(next.tripNumber, s.stopIndex, d.depotMarketId, m.commodityId))),
        );
  const firstOpen = stops.find((s) => !stopDone(s));
  const loadPct = next.capacity > 0 ? Math.min(100, (next.loadTons / next.capacity) * 100) : 0;
  let n = 0;
  return (
    <Panel
      k="next-trip"
      tone="hot"
      title={`Next trip · ${next.tripNumber} of ${trips.length}`}
      aside={
        <span className="cz-aside-note">
          loads {t(next.loadTons)} of {t(next.capacity)}
          {next.buyRouteLy > 0 ? ` · about ${Math.round(next.buyRouteLy)} ly of buying` : ""}
        </span>
      }
    >
      <div className="cz-steps-wrap">
        <div className="cz-steps">
          {stops.flatMap((s) => {
            const done = stopDone(s);
            if (s.kind === "buy") {
              n += 1;
              const here = s.buys.reduce((a, b) => a + b.buyTons, 0);
              return [
                <div key={s.stopIndex} className="cz-stepwrap">
                  <article className={`cz-card cz-step${done ? " cz-step--done" : ""}`} aria-label={`Stop ${n}: buy at ${s.stationName}`}>
                    <div className="cz-step__head">
                      <span className="cz-step__n">{done ? "✓" : n}</span>
                      <span className="cz-step__kind">Buy</span>
                      {readOnly ? null : (
                        <span className="cz-step__acts">
                          <CopyStop system={s.systemName} primary={s === firstOpen} />
                        </span>
                      )}
                    </div>
                    <div>
                      <div className="cz-step__name">{s.stationName}</div>
                      <div className="cz-soft">{s.systemName}</div>
                    </div>
                    <StopChips s={s} />
                    <ul className="cz-lines">
                      {s.buys.map((b) => {
                        const id = tripBuyLineId(next.tripNumber, s.stopIndex, b.commodityId);
                        const got = completed.has(id);
                        return (
                          <li key={id} className={got ? "is-done" : undefined}>
                            <span className="min0">
                              {got ? <span className="ck">✓</span> : null}
                              {b.label}
                              {b.forDepots.length ? <small>for {b.forDepots.join(", ")}</small> : null}
                            </span>
                            <span className="t">{got ? `${t(b.buyTons)} aboard` : t(b.buyTons)}</span>
                            <span className="p">{b.buyPrice != null ? `${formatPrice(b.buyPrice)} cr` : ""}</span>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="cz-row">
                      <span className="cz-xs cz-dim">{t(here)} here</span>
                      {readOnly ? null : (
                        <button
                          type="button"
                          className={BTN_LINK}
                          title="Leave this station out of every plan (Sources › Never use)"
                          onClick={() => onBan(s.systemName, s.stationName)}
                        >
                          Never use
                        </button>
                      )}
                    </div>
                  </article>
                </div>,
              ];
            }
            return (s.deliveries ?? []).map((d) => {
              n += 1;
              const site = sites.find((x) => x.marketId === d.depotMarketId);
              const tot = site ? siteTotals(site) : null;
              const tonsHere = d.materials.reduce((a, m) => a + m.tons, 0);
              const gain = tot && tot.required > 0 ? (tonsHere / tot.required) * 100 : 0;
              return (
                <div key={`${s.stopIndex}-${d.depotMarketId}`} className="cz-stepwrap">
                  <article
                    className={`cz-card cz-step cz-step--deliver${done ? " cz-step--done" : ""}`}
                    aria-label={`Stop ${n}: deliver to ${d.depotLabel}`}
                  >
                    <div className="cz-step__head">
                      <span className="cz-step__n">{done ? "✓" : n}</span>
                      <span className="cz-step__kind">Deliver</span>
                      {readOnly ? null : (
                        <span className="cz-step__acts">
                          <CopyStop system={d.systemName} primary={s === firstOpen} />
                        </span>
                      )}
                    </div>
                    <div>
                      <div className="cz-step__name">{d.depotLabel}</div>
                      <div className="cz-soft">{d.systemName}</div>
                    </div>
                    <div className="cz-chiprow">
                      {d.materials.map((m) => (
                        <span key={m.commodityId} className="cz-mchip">
                          {m.label} <b>{t(m.tons)}</b>
                        </span>
                      ))}
                    </div>
                    {tot && gain >= 0.5 ? (
                      <div className="cz-xs cz-ok">
                        +{Math.round(gain)} % to {d.depotLabel} once delivered ({Math.floor(tot.pct)} % → {Math.min(100, Math.floor(tot.pct + gain))} %)
                      </div>
                    ) : null}
                  </article>
                </div>
              );
            });
          })}
        </div>
      </div>
      <div className="cz-tripfoot">
        <div className="cz-load">
          <span className="cz-label">Load</span>
          <div className="cz-bar" role="progressbar" aria-label="Load" aria-valuemin={0} aria-valuemax={next.capacity} aria-valuenow={next.loadTons}>
            <i className="cz-bar__fill" style={{ width: `${loadPct}%` }} />
          </div>
          <span className="cz-small cz-num cz-strong">
            {next.loadTons.toLocaleString("en-US")} / {t(next.capacity)}
          </span>
        </div>
        {next.buyRouteLy > 0 ? <span className="cz-small cz-dim">about {Math.round(next.buyRouteLy)} ly of buying</span> : null}
      </div>
    </Panel>
  );
}

const CHIPS = 4;
const FIRST = 8;

export function TripList({ trips, completed }: TripProps) {
  const [all, setAll] = useState(false);
  const next = trips.find((tr) => !tripDone(tr, completed));
  const rest = trips.filter((tr) => tr !== next);
  const shown = all ? rest : rest.slice(0, FIRST);
  // After a delivery the plan is made again and the trips move up: they slide (useFlip), keyed by what they carry.
  const flipRef = useRef<HTMLDivElement>(null);
  useFlip(flipRef);
  return (
    <Panel k="trips" title="After that" className="cz-panel--flush" aside={<span className="cz-aside-note">{rest.length} more trips</span>}>
      <div ref={flipRef} className="cz-tripgrid">
        {shown.map((tr) => {
          const done = tripDone(tr, completed);
          const buy = tr.stops.find((s) => s.kind === "buy" && s.buys.length);
          const buys = tr.stops.flatMap((s) => s.buys);
          const sites = [...new Set(tr.stops.flatMap((s) => (s.deliveries ?? []).map((d) => d.depotLabel)))];
          const loadPct = tr.capacity > 0 ? Math.min(100, (tr.loadTons / tr.capacity) * 100) : 0;
          const more = buys.slice(CHIPS);
          return (
            <article
              key={tr.tripNumber}
              data-flip-key={`${buy?.systemName ?? ""}|${buy?.stationName ?? ""}|${buys.map((b) => `${b.label} ${b.buyTons}`).join(",")}`}
              className={`cz-card cz-tripcard${done ? " cz-tripcard--done" : ""}`}
              aria-label={`Trip ${tr.tripNumber}${buy ? `: ${buy.stationName}` : ""}`}
            >
              <div className="cz-tripcard__head">
                <span className="cz-badge">#{tr.tripNumber}</span>
                <b className="ell">
                  {done ? <span className="cz-live">✓ </span> : null}
                  {buy?.stationName ?? "—"}
                </b>
                <span className="cz-small cz-dim">{buy ? formatHopLy(buy.distanceLy) : ""}</span>
              </div>
              <div className="cz-load">
                <div className="cz-bar cz-bar--thin">
                  <i className="cz-bar__fill" style={{ width: `${loadPct}%` }} />
                </div>
                <span className="cz-xs cz-num">
                  {tr.loadTons.toLocaleString("en-US")} / {t(tr.capacity)}
                </span>
              </div>
              <div className="cz-chiprow">
                {buys.slice(0, CHIPS).map((b) => (
                  <span key={b.commodityId} className="cz-mchip">
                    {b.label} <b>{t(b.buyTons)}</b>
                  </span>
                ))}
                {more.length ? (
                  <span className="cz-mchip" title={more.map((b) => `${b.label} ${t(b.buyTons)}`).join(", ")}>
                    +{more.length} more
                  </span>
                ) : null}
              </div>
              <div className="cz-trip__to">{sites.length ? `→ ${sites.join(", ")}` : ""}</div>
            </article>
          );
        })}
      </div>
      {rest.length > FIRST ? (
        <div className="cz-gridfoot">
          <button type="button" className={BTN} onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${rest.length} trips`}
          </button>
        </div>
      ) : null}
    </Panel>
  );
}
