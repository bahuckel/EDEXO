import { Fragment } from "react";
import type { SavedBoxelDTO } from "@shared/boxel";

/** How many of the order are listed; the rest are counted (the order is worked out again after every jump). */
const SHOWN = 20;

/**
 * A boxel flown in the shortest order (owner, 2026-11-04; shared/boxelOrder.ts): what is left in that order with the
 * light years of each leg, what it saves against flying by number, and how many still lack a position. A position
 * worked out from the system's address (shared/stellarPlacement.ts) is marked as predicted, with how often such a
 * prediction is exact (owner, 2026-11-24: "show threshold and mark predicted"). That share is high once a real
 * position has told the boxel's kind, and lower while the kind is a guess (2026-11-25).
 */
export function BoxelOrderLine({ b }: { b: SavedBoxelDTO }) {
  const order = b.order ?? [];
  if (!order.length) return null;
  const placed = b.placed ?? 0;
  const unplaced = order.length - placed;
  const suffix = b.prefix.slice(b.prefix.lastIndexOf(" ") + 1);
  if (!placed)
    return (
      <p className="boxel-order dim">
        Shortest order: no system left here has a position yet, so they go by number. Plot route to them in the galaxy map
        (Set target alone gives no position), or Look up the boxel on Spansh.
      </p>
    );
  return (
    <p className="boxel-order">
      <span className="dim">Shortest order from you: </span>
      {/* The separator outside each stop: a line may break there (2026-11-05: 59 stops ran off the screen). */}
      {order.slice(0, Math.min(placed, SHOWN)).map((o, i) => (
        <Fragment key={o.n}>
          {i ? <span className="dim"> › </span> : null}
          <span className="boxel-order__stop">
            <strong>
              {suffix}
              {o.n}
            </strong>
            {o.ly != null ? (
              <span className="dim" title={o.predicted ? "Predicted position" : undefined}>
                {" "}
                {o.predicted ? "≈ " : ""}
                {o.ly.toLocaleString("en-US")} ly
              </span>
            ) : null}
          </span>
        </Fragment>
      ))}
      {placed > SHOWN ? <span className="dim"> › {(placed - SHOWN).toLocaleString("en-US")} more</span> : null}
      {unplaced ? (
        <span className="dim">
          {" "}
          › then {suffix}
          {order[placed]!.n} onward by number
        </span>
      ) : null}
      <br />
      {placed > 1 && b.orderLy != null && b.numericLy != null ? (
        <span>
          <strong>{b.orderLy.toLocaleString("en-US")} ly</strong> for the {placed} with a position;{" "}
          <span className="dim">by number {b.numericLy.toLocaleString("en-US")} ly.</span>{" "}
        </span>
      ) : null}
      {b.predicted && b.predictedExact != null ? (
        <span className="dim">
          {b.predicted.toLocaleString("en-US")} of the {placed.toLocaleString("en-US")} positions{" "}
          {b.predicted === 1 ? "is" : "are"} predicted from the system's address (≈).{" "}
          {b.predictedChecked
            ? `The boxel's kind was read from ${b.predictedChecked.toLocaleString("en-US")} real ${b.predictedChecked === 1 ? "position" : "positions"}: such predictions are exact for ${Math.round(b.predictedExact * 100)} % of systems.`
            : b.predictedExact >= 0.98
              ? `Such predictions are exact for ${Math.round(b.predictedExact * 100)} % of systems.`
              : `No real position in this boxel is known yet, so its kind is a guess: exact for about ${Math.round(b.predictedExact * 100)} % of systems in a mass code ${suffix.replace(/\d+-?$/, "")} boxel this crowded, about half the boxel off for the rest. Flying into the boxel or plotting a route to one of its systems settles it.`}{" "}
          A plotted route or a Spansh look-up replaces a prediction.{" "}
        </span>
      ) : null}
      {unplaced ? (
        <span className="dim">
          {unplaced.toLocaleString("en-US")} without a position follow by number: Plot route to them in the galaxy map (Set
          target alone gives no position), or Look up the boxel on Spansh.
        </span>
      ) : null}
    </p>
  );
}
