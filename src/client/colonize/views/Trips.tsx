/** The next trip, front and centre, and the trips after it with their ticks. */
import { useState } from "react";
import type { HaulTrip, TripStop } from "../../../shared/colonize/logisticsPlanner";
import { formatHopLy } from "../../../shared/colonize/systemDistanceLy";
import { formatPrice } from "../../../shared/colonize/formatPrice";
import { tripBuyLineId, tripDeliverLineId } from "../../../shared/colonize/tripPlanProgress";

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
const t = (n: number) => `${Math.round(n).toLocaleString("en-US")} t`;

function stopFacts(s: TripStop): string {
  const bits = [formatHopLy(s.distanceLy)];
  if (s.stationType) bits.push(s.stationType);
  if (s.isPlanetaryOrGround) bits.push("planet port");
  if (s.boughtBefore) bits.push("bought here before");
  return bits.filter(Boolean).join(" · ");
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* no clipboard in this browser: the name is on screen to copy by hand */
  }
}

export function NextTripCard({ trips, completed, onToggle, onBan, readOnly = false }: TripProps) {
  const next = trips.find((tr) => !tripDone(tr, completed));
  const [copied, setCopied] = useState<string | null>(null);
  if (!next) {
    return (
      <div className="cz-panel cz-panel--info">
        <p className="cz-eyebrow">All planned trips done</p>
        <p style={{ margin: 0 }}>Every trip in the plan is ticked. New trips appear as the sites report what they still need.</p>
      </div>
    );
  }
  const buyStops = next.stops.filter((s) => s.kind === "buy" && s.buys.length);
  const deliverStops = next.stops.filter((s) => (s.deliveries ?? []).length);
  const firstOpen = buyStops.find((s) => s.buys.some((b) => !completed.has(tripBuyLineId(next.tripNumber, s.stopIndex, b.commodityId))));
  const copyTarget = firstOpen ?? deliverStops[0];
  return (
    <article className="cz-panel cz-panel--hot cz-stack" aria-labelledby="cz-next-h" style={{ gap: 14 }}>
      <div className="cz-row">
        <h3 id="cz-next-h" className="cz-eyebrow">
          Next trip · {next.tripNumber} of {trips.length}
        </h3>
        <span className="cz-small cz-dim">
          loads {t(next.loadTons)} of {t(next.capacity)}
          {next.buyRouteLy > 0 ? ` · about ${Math.round(next.buyRouteLy)} ly of buying` : ""}
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        <div style={{ flex: "1 1 340px" }} className="cz-stack">
          {buyStops.map((s) => (
            <div key={s.stopIndex}>
              <div className="cz-small cz-dim">Buy at</div>
              <div className="cz-row" style={{ alignItems: "center" }}>
                <span className="cz-big">{s.stationName}</span>
                {readOnly ? null : (
                  <button type="button" className="cz-btn cz-btn--quiet cz-small" onClick={() => onBan(s.systemName, s.stationName)}>
                    Never use this station
                  </button>
                )}
              </div>
              <div style={{ color: "var(--text-dim)" }}>
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
                      <th scope="col">
                        <span className="cz-small">Done</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.buys.map((b) => {
                      const id = tripBuyLineId(next.tripNumber, s.stopIndex, b.commodityId);
                      const done = completed.has(id);
                      return (
                        <tr key={id} className={done ? "is-done" : undefined}>
                          <td>{b.label}</td>
                          <td className="r" style={{ fontWeight: 700 }}>
                            {t(b.buyTons)}
                          </td>
                          <td className="r cz-dim">{b.buyPrice != null ? `${formatPrice(b.buyPrice)} cr` : ""}</td>
                          <td>
                            <input
                              type="checkbox"
                              checked={done}
                              disabled={readOnly}
                              onChange={() => onToggle(id)}
                              aria-label={`${b.label} bought`}
                              style={{ accentColor: "var(--ok)" }}
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
        <div style={{ flex: "0 1 280px", paddingLeft: 20, borderLeft: "1px solid var(--hud-faint)" }} className="cz-stack">
          <div className="cz-small cz-dim">Then deliver to</div>
          {deliverStops.flatMap((s) =>
            (s.deliveries ?? []).map((d) => (
              <div key={`${s.stopIndex}-${d.depotMarketId}`}>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{d.depotLabel}</div>
                <div className="cz-small" style={{ color: "var(--text-dim)" }}>
                  {d.systemName} · {d.materials.map((x) => `${x.label} ${t(x.tons)}`).join(", ")}
                </div>
              </div>
            )),
          )}
        </div>
      </div>
      {readOnly ? null : (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {copyTarget ? (
          <button
            type="button"
            className="cz-btn cz-btn--primary"
            onClick={() => {
              void copy(copyTarget.systemName);
              setCopied(copyTarget.systemName);
              window.setTimeout(() => setCopied(null), 1800);
            }}
          >
            {copied === copyTarget.systemName ? "Copied" : `Copy “${copyTarget.systemName}”`}
          </button>
        ) : null}
        <button type="button" className="cz-btn" onClick={() => setTrip(next, completed, true, onToggle)}>
          Mark trip done
        </button>
      </div>
      )}
    </article>
  );
}

export function TripList({ trips, completed, onToggle, readOnly = false }: TripProps) {
  const [all, setAll] = useState(false);
  const next = trips.find((tr) => !tripDone(tr, completed));
  const rest = trips.filter((tr) => tr !== next);
  const shown = all ? rest : rest.slice(0, 8);
  return (
    <div className="cz-trips">
      <div className="cz-row" style={{ padding: "12px 16px" }}>
        <h3 className="cz-h3">After that</h3>
        {readOnly ? null : <span className="cz-small cz-dim">tick a trip you did out of order</span>}
      </div>
      {shown.map((tr) => {
        const done = tripDone(tr, completed);
        const buy = tr.stops.find((s) => s.kind === "buy" && s.buys.length);
        const buys = tr.stops.flatMap((s) => s.buys).map((b) => `${b.label} ${t(b.buyTons)}`);
        const sites = [...new Set(tr.stops.flatMap((s) => (s.deliveries ?? []).map((d) => d.depotLabel)))];
        return (
          <div key={tr.tripNumber} className={`cz-trip${done ? " cz-trip--done" : ""}`}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, flex: "1 1 340px" }}>
              <input type="checkbox" checked={done} disabled={readOnly} onChange={() => setTrip(tr, completed, !done, onToggle)} />
              <span className="cz-trip__n">{tr.tripNumber}</span>
              <b>{buy?.stationName ?? "—"}</b>
              <span className="cz-small cz-dim">{buy ? formatHopLy(buy.distanceLy) : ""}</span>
            </label>
            <span style={{ flex: "1 1 240px", color: done ? undefined : "var(--text-dim)" }}>{buys.join(" · ")}</span>
            <span className="cz-small cz-dim">{sites.length ? `→ ${sites.join(", ")}` : ""}</span>
          </div>
        );
      })}
      {rest.length > 8 ? (
        <button type="button" className="cz-btn cz-btn--quiet" style={{ margin: "8px 10px" }} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${rest.length} trips`}
        </button>
      ) : null}
    </div>
  );
}
