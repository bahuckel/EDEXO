/** The next trip, front and centre, and the trips after it with their ticks. */
import { useState } from "react";
import type { HaulTrip, TripStop } from "../../../shared/colonize/logisticsPlanner";
import { formatHopLy } from "../../../shared/colonize/systemDistanceLy";
import { formatPrice, formatTons as t } from "../../../shared/colonize/formatPrice";
import { tripBuyLineId, tripDeliverLineId } from "../../../shared/colonize/tripPlanProgress";
import { BTN, BTN_GO, BTN_LINK, Panel, copyText } from "./ui";

type TripProps = {
  trips: HaulTrip[];
  completed: Set<string>;
  onToggle: (lineId: string) => void;
  onBan: (systemName: string, stationName: string) => void;
  /** A paired phone: the ticks are shown, not changed, and nothing writes. */
  readOnly?: boolean;
};

/** Every line of a trip that can be ticked: its buys, and each site's delivery. */
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
/** Tick (or untick) every line of a trip. */
function setTrip(trip: HaulTrip, completed: Set<string>, done: boolean, onToggle: (id: string) => void) {
  for (const id of tripLineIds(trip)) if (completed.has(id) !== done) onToggle(id);
}

function stopFacts(s: TripStop): string {
  const bits = [formatHopLy(s.distanceLy)];
  if (s.stationType) bits.push(s.stationType);
  if (s.pad) bits.push(`${s.pad} pad`);
  if (s.arrivalLs != null) bits.push(`${Math.round(s.arrivalLs).toLocaleString("en-US")} ls from the star`);
  if (s.isPlanetaryOrGround) bits.push("planet port");
  if (s.boughtBefore) bits.push("bought here before");
  return bits.filter(Boolean).join(" · ");
}

export function NextTripCard({ trips, completed, onToggle, onBan, readOnly = false }: TripProps) {
  const next = trips.find((tr) => !tripDone(tr, completed));
  const [copied, setCopied] = useState<string | null>(null);
  if (!next) {
    return (
      <Panel k="next-trip" tone="info" title="All planned trips done">
        <p style={{ margin: 0 }}>Every trip in the plan is ticked. New trips appear as the sites report what they still need.</p>
      </Panel>
    );
  }
  const buyStops = next.stops.filter((s) => s.kind === "buy" && s.buys.length);
  const deliverStops = next.stops.filter((s) => (s.deliveries ?? []).length);
  const firstOpen = buyStops.find((s) => s.buys.some((b) => !completed.has(tripBuyLineId(next.tripNumber, s.stopIndex, b.commodityId))));
  const copyTarget = firstOpen ?? deliverStops[0];
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
      <div className="cz-stack" style={{ gap: 14 }}>
        <div className="cz-next">
          <div className="cz-stack">
            {buyStops.map((s) => (
              <div key={s.stopIndex}>
                <div className="cz-label">Buy at</div>
                <div className="cz-row" style={{ alignItems: "center" }}>
                  <span className="cz-big">{s.stationName}</span>
                  {readOnly ? null : (
                    <button type="button" className={BTN_LINK} onClick={() => onBan(s.systemName, s.stationName)}>
                      Never use this station
                    </button>
                  )}
                </div>
                <div className="cz-soft">
                  {s.systemName} · {stopFacts(s)}
                </div>
                <div className="cz-table-wrap">
                  <table className="cz-table" style={{ marginTop: 8 }}>
                    <thead>
                      <tr>
                        <th scope="col">Buy</th>
                        <th scope="col" className="r">
                          Tons
                        </th>
                        <th scope="col" className="r">
                          Price
                        </th>
                        <th scope="col">Done</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.buys.map((b) => {
                        const id = tripBuyLineId(next.tripNumber, s.stopIndex, b.commodityId);
                        const done = completed.has(id);
                        return (
                          <tr key={id} className={done ? "is-done" : undefined}>
                            <td>{b.label}</td>
                            <td className={`r cz-strong${done ? "" : " cz-hi"}`}>{t(b.buyTons)}</td>
                            <td className="r cz-dim">{b.buyPrice != null ? `${formatPrice(b.buyPrice)} cr` : ""}</td>
                            <td>
                              <input
                                type="checkbox"
                                className="cz-tick"
                                checked={done}
                                disabled={readOnly}
                                onChange={() => onToggle(id)}
                                aria-label={`${b.label} bought`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
          <div className="cz-next__then cz-stack">
            <div className="cz-label">Then deliver to</div>
            {deliverStops.flatMap((s) =>
              (s.deliveries ?? []).map((d) => (
                <div key={`${s.stopIndex}-${d.depotMarketId}`}>
                  <div className="cz-site__name">{d.depotLabel}</div>
                  <div className="cz-small cz-soft">
                    {d.systemName} · {d.materials.map((x) => `${x.label} ${t(x.tons)}`).join(", ")}
                  </div>
                </div>
              )),
            )}
          </div>
        </div>
        {readOnly ? null : (
          <div className="cz-actions">
            {copyTarget ? (
              <button
                type="button"
                className={BTN_GO}
                onClick={() => {
                  void copyText(copyTarget.systemName);
                  setCopied(copyTarget.systemName);
                  window.setTimeout(() => setCopied(null), 1800);
                }}
              >
                {copied === copyTarget.systemName ? "Copied" : `Copy “${copyTarget.systemName}”`}
              </button>
            ) : null}
            <button type="button" className={BTN} onClick={() => setTrip(next, completed, true, onToggle)}>
              Mark trip done
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}

export function TripList({ trips, completed }: TripProps) {
  const [all, setAll] = useState(false);
  const next = trips.find((tr) => !tripDone(tr, completed));
  const rest = trips.filter((tr) => tr !== next);
  const shown = all ? rest : rest.slice(0, 8);
  return (
    <Panel k="trips" title="After that" className="cz-panel--flush">
      {shown.map((tr) => {
        const done = tripDone(tr, completed);
        const buy = tr.stops.find((s) => s.kind === "buy" && s.buys.length);
        const buys = tr.stops.flatMap((s) => s.buys).map((b) => `${b.label} ${t(b.buyTons)}`);
        const sites = [...new Set(tr.stops.flatMap((s) => (s.deliveries ?? []).map((d) => d.depotLabel)))];
        return (
          <div key={tr.tripNumber} className={`cz-trip${done ? " cz-trip--done" : ""}`}>
            {/*
              No tick here (owner, 2026-10-23): a trip hauled out of order shows in the sites' deliveries, and the plan is
              made again from what is left (planRefreshFingerprint), so it simply leaves the list.
            */}
            <div className="cz-trip__main">
              <span className="cz-trip__n">{tr.tripNumber}</span>
              <b>{buy?.stationName ?? "—"}</b>
              <span className="cz-small cz-dim">{buy ? formatHopLy(buy.distanceLy) : ""}</span>
            </div>
            <span className="cz-trip__buys">{buys.join(" · ")}</span>
            <span className="cz-trip__to">{sites.length ? `→ ${sites.join(", ")}` : ""}</span>
          </div>
        );
      })}
      {rest.length > 8 ? (
        <div className="cz-trip">
          <button type="button" className={BTN} onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${rest.length} trips`}
          </button>
        </div>
      ) : null}
    </Panel>
  );
}
