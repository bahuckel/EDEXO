import { Fragment } from "react";
import type { SavedBoxelDTO } from "@shared/boxel";

/** How many of the order are listed; the rest are counted (the order is worked out again after every jump). */
const SHOWN = 20;

/**
 * A boxel flown in the shortest order (owner, 2026-11-04; shared/boxelOrder.ts): what is left in that order with the
 * light years of each leg, what it saves against flying by number, and how many still lack a position.
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
            {o.ly != null ? <span className="dim"> {o.ly.toLocaleString()} ly</span> : null}
          </span>
        </Fragment>
      ))}
      {placed > SHOWN ? <span className="dim"> › {(placed - SHOWN).toLocaleString()} more</span> : null}
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
          <strong>{b.orderLy.toLocaleString()} ly</strong> for the {placed} with a position;{" "}
          <span className="dim">by number {b.numericLy.toLocaleString()} ly.</span>{" "}
        </span>
      ) : null}
      {unplaced ? (
        <span className="dim">
          {unplaced.toLocaleString()} without a position follow by number: Plot route to them in the galaxy map (Set
          target alone gives no position), or Look up the boxel on Spansh.
        </span>
      ) : null}
    </p>
  );
}
