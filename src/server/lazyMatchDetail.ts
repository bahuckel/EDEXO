/**
 * A candidate's habitat detail, built when something reads it (code review, 2026-10-14).
 *
 * The detail (distributions with their bins, per body and species) was built for every candidate of every body a
 * snapshot computed — 11 % of a first view on the owner's history — and the push then left it out and sent a flag and
 * a version stamp instead (wsChannels.ts `lazyDetail`). Only `/api/match-detail` reads it, when the commander opens a
 * card's habitat modal. So the snapshot attaches it as a getter that builds once, and marks the row with what the push
 * needs without building it: whether there will be anything to show, and a token that changes when the row is
 * computed again.
 *
 * A copy of the row (`{ ...m }`) reads the getter and gets the built detail with no mark, which the push handles the
 * way it always did; the rows are attached last in `computeBodyUncached` so nothing copies them afterwards.
 */
import type { ExomasteryDetailDTO } from "../shared/types.js";

export interface LazyDetailMark {
  /** New per computed row: the push's version stamp keys on it instead of hashing the detail. */
  token: object;
  /** The detail will have something to draw (it always does when the profile has a numeric fact it shows). */
  habitat: boolean;
}

const marks = new WeakMap<object, LazyDetailMark>();

export function attachLazyDetail(
  row: object,
  build: () => ExomasteryDetailDTO | null,
  habitat: boolean,
): void {
  marks.set(row, { token: {}, habitat });
  const settle = (value: ExomasteryDetailDTO | null): void => {
    Object.defineProperty(row, "exomasteryDetail", {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  };
  Object.defineProperty(row, "exomasteryDetail", {
    enumerable: true,
    configurable: true,
    get() {
      const v = build();
      settle(v);
      return v;
    },
    set(v: ExomasteryDetailDTO | null) {
      settle(v);
    },
  });
}

/** The mark of a row whose detail is still unbuilt or was built here; null for an ordinary row. */
export function lazyDetailOf(row: object): LazyDetailMark | null {
  return marks.get(row) ?? null;
}
