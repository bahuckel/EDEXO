/**
 * The filter widgets the three discoveries tabs share: the folding chip rows, the search box and the
 * helpers that build their options (moved out of DiscoveriesTables.tsx, audit 2026-10-22).
 */
import { BODY_FEATURES, type BodyFeatureKey } from "../../shared/bodyFeatures.js";
import { useState } from "react";
import { isBool, usePersistedState } from "../usePersistedState";

/**
 * A filter that is on when any chip is picked; an empty set means "everything".
 *
 * Folded by default behind its label (owner, 2026-10-04: "they take too much space … shown at all
 * times, + a drop down arrow"). Folded, the row still shows what is picked, so an active filter is
 * never out of sight; the open/closed state is remembered per label.
 */
export function ChipRow({
  label,
  options,
  picked,
  onToggle,
}: {
  label: string;
  options: { key: string; label: string; n?: number }[];
  picked: Set<string>;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = usePersistedState(`discoveries.chips.${label}`, false, isBool);
  if (options.length === 0) return null;
  const shown = open ? options : options.filter((o) => picked.has(o.key));
  return (
    <div className="disc-chip-row">
      <button
        type="button"
        className="disc-chip-label disc-chip-toggle small-caps dim"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={open ? "Hide these filters" : "Show these filters"}
      >
        {open ? "▾" : "▸"} {label}
        {!open ? <span className="tiny"> ({options.length})</span> : null}
      </button>
      {shown.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`disc-chip${picked.has(o.key) ? " disc-chip--on" : ""}`}
          onClick={() => onToggle(o.key)}
        >
          {o.label}
          {o.n != null ? <span className="dim tiny"> {o.n.toLocaleString()}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function useToggleSet(): [Set<string>, (k: string) => void, () => void] {
  const [set, setSet] = useState<Set<string>>(() => new Set());
  const toggle = (k: string) =>
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  return [set, toggle, () => setSet(new Set())];
}

/**
 * The values of a field, as chips — a filter list nobody has to maintain by hand.
 *
 * `limit` caps the list for fields whose values are open-ended, like a region name. Pass `Infinity`
 * where the set is closed and every member is worth filtering by: the owner asked for exactly that
 * on planet class, and he is right. Frequency is the wrong ranking for a filter, because the values
 * worth filtering *for* are the rare ones. On his data Earth-like world is the thirteenth commonest
 * class — 30 bodies against 10,170 Icy ones — so a top-twelve list cut off the very thing somebody
 * opens the panel to find, and Ammonia world, Water giant and Helium rich gas giant with it.
 *
 * Order stays by count, so the classes he has most of read first and the rarities sit at the end.
 */
export function topValues<T>(rows: T[], read: (r: T) => string | null, limit = 12) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = read(r);
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, n]) => ({ key, label: key, n }));
}

/**
 * The Feature chips (owner, 2026-10-03: the Notify-me body features "never added as filters in My
 * Discoveries"): every feature present in this tab's rows, in the Options order, with its count.
 * Only features that occur are offered, so the row stays short on a small log.
 */
export function featureOptions(rows: readonly { featureKeys?: BodyFeatureKey[] }[]) {
  const counts = new Map<BodyFeatureKey, number>();
  for (const r of rows) for (const k of r.featureKeys ?? []) counts.set(k, (counts.get(k) ?? 0) + 1);
  return BODY_FEATURES.filter((f) => counts.has(f.key)).map((f) => ({ key: f.key, label: f.label, n: counts.get(f.key) }));
}

/** Any picked feature, like the Type chips: "small bodies or fast orbits". */
export function hasPickedFeature(picked: Set<string>, keys: readonly BodyFeatureKey[] | undefined): boolean {
  return picked.size === 0 || (keys ?? []).some((k) => picked.has(k));
}

export function Search({
  query,
  setQuery,
  n,
  of,
  what,
}: {
  query: string;
  setQuery: (s: string) => void;
  n: number;
  of: number;
  what: string;
}) {
  return (
    <div className="my-exo-search">
      <input
        type="search"
        className="my-exo-search-input"
        placeholder={`Search ${what}…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <span className="my-exo-search-count dim tiny">
        {n === of ? `${of.toLocaleString()} ${what}` : `${n.toLocaleString()} of ${of.toLocaleString()}`}
      </span>
    </div>
  );
}
