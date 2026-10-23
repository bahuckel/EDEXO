/**
 * The sortable, windowed table (or cards) that My discoveries and the Boxels screen draw their rows in.
 *
 * Moved out of DiscoveriesTables.tsx (audit 2026-10-22): Boxels used only this, and importing it from
 * there made the Boxels screen, and the first-discovery backlog for one constant, load the whole
 * discoveries chunk. DiscoveriesTables re-exports these names, so its importers are unchanged.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "./ErrorBoundary";
import { ScrollArea } from "./ScrollArea";
import { Select } from "./Select";
import { csvFileName, downloadCsv, toCsv } from "../csv";
import { PAGE } from "./tablePage";

/** List (a table, the default) or cards — owner, 2026-09-25; every tab offers both. */
export type DiscoveriesLayout = "list" | "cards";

export interface Column<T> {
  key: string;
  label: string;
  /** Right-aligned, tabular figures — every numeric column. */
  numeric?: boolean;
  /** Sort key. Null sorts last whichever way the column is pointing. */
  value: (r: T) => number | string | null;
  render: (r: T) => React.ReactNode;
  title?: string;
}

function SortHeader<T>({
  col,
  sort,
  onSort,
}: {
  col: Column<T>;
  sort: { key: string; dir: 1 | -1 };
  onSort: (key: string) => void;
}) {
  const active = sort.key === col.key;
  return (
    <th
      scope="col"
      className={`disc-th${col.numeric ? " disc-th--num" : ""}${active ? " disc-th--active" : ""}`}
      title={col.title}
    >
      <button type="button" className="disc-sort" onClick={() => onSort(col.key)}>
        {col.label}
        <span className="disc-sort-caret">{active ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

/**
 * One set of rows, as a table or as cards. The cards are built from the same columns — the first
 * column is the card's title, every other column one labelled fact — so a card can never show less
 * than its row, and the copy icon rides along with the name (owner: "everything it currently has but
 * in a card").
 */
/**
 * The table in an error boundary: a row that fails to draw leaves a message and a button in its place, not an
 * empty screen (owner, 2026-10-11).
 */
export function Table<T>(props: Parameters<typeof TableInner<T>>[0]) {
  return (
    <ErrorBoundary label="This table">
      <TableInner {...props} />
    </ErrorBoundary>
  );
}

function TableInner<T>({
  rows,
  columns,
  sort,
  onSort,
  rowKey,
  empty,
  layout = "list",
  resetKey,
  csvName,
}: {
  rows: T[];
  columns: Column<T>[];
  sort: { key: string; dir: 1 | -1 };
  onSort: (key: string) => void;
  rowKey: (r: T) => string;
  empty: string;
  layout?: DiscoveriesLayout;
  /** Scrolls back to the top when it changes. */
  resetKey?: unknown;
  /** Offers "Export CSV" of every row (not only the first page), in the current order (F-5.11). */
  csvName?: string;
}) {
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) ?? columns[0]!;
    const out = [...rows];
    out.sort((a, b) => {
      const av = col.value(a);
      const bv = col.value(b);
      // Null is "not measured", never "zero" — it sorts to the bottom either way, so pointing a
      // column the other way does not fill the top of the screen with blanks.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const d =
        typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return d * sort.dir;
    });
    return out;
  }, [rows, columns, sort]);

  const shown = sorted.slice(0, PAGE);
  /*
    The table draws only the rows in view, plus a margin (owner, 2026-10-04, plan 3.4): every row is
    there to scroll to, with no first-300 cap, and a 20,000-body log costs what a screenful does.

    Each row's height is measured once it has been drawn, and a row not drawn yet counts as the
    average of those that were. Rows can wrap (the Boxels table's species and badges run 32-90 px), so
    one height measured off the first drawn row was wrong: every scroll put a different row first, the
    height changed, the window moved, and the next first row changed it back — React stopped the loop
    by unmounting the whole screen (owner, 2026-10-10: "scroll fast up and down in the boxel screen,
    everything in it disappears"). A drawn row's height does not change, so the updates end.
  */
  const [view, setView] = useState({ top: 0, height: 600 });
  const heights = useRef(new Map<string, number>());
  const [measured, setMeasured] = useState(0);
  const tbody = useRef<HTMLTableSectionElement>(null);
  const OVERSCAN_PX = 640;
  const onView = useCallback(
    (top: number, height: number) =>
      setView((v) => (Math.abs(v.top - top) < OVERSCAN_PX / 4 && v.height === height ? v : { top, height })),
    [],
  );
  // Prefix offsets of every row: its own measured height, else the average of the measured ones.
  const offsets = useMemo(() => {
    let sum = 0;
    for (const h of heights.current.values()) sum += h;
    const avg = heights.current.size ? sum / heights.current.size : 28;
    const out = new Float64Array(sorted.length + 1);
    for (let i = 0; i < sorted.length; i++) out[i + 1] = out[i]! + (heights.current.get(rowKey(sorted[i]!)) ?? avg);
    return out;
    // `measured` stands for the contents of `heights`, which is a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, rowKey, measured]);
  // The first row whose bottom is past `y`.
  const rowAt = (y: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1]! > y) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  /*
    Never past the end: a position beyond the rows (the list shrank, or a jump outran the estimate) drew
    nothing but the spacers.
  */
  const top = Math.max(0, Math.min(view.top, offsets[sorted.length]! - view.height));
  const from = rowAt(top - OVERSCAN_PX);
  const to = Math.min(sorted.length, rowAt(top + view.height + OVERSCAN_PX) + 1);
  /*
    The columns are as wide as the rows drawn, so a row can measure differently in another window.
    A few re-measures per scroll position settle it; past that the estimate stands until the next
    scroll, so no window can feed itself.
  */
  const settle = useRef({ top: -1, n: 0 });
  useLayoutEffect(() => {
    if (settle.current.top !== view.top) settle.current = { top: view.top, n: 0 };
    if (settle.current.n >= 3) return;
    let changed = false;
    for (const tr of tbody.current?.querySelectorAll<HTMLTableRowElement>("tr[data-row-key]") ?? []) {
      const k = tr.dataset.rowKey!;
      const h = tr.getBoundingClientRect().height;
      if (h > 4 && Math.abs((heights.current.get(k) ?? 0) - h) > 0.5) {
        heights.current.set(k, h);
        changed = true;
      }
    }
    if (changed) {
      settle.current.n++;
      setMeasured((n) => n + 1);
    }
  }, [from, to, sorted, columns, view.top]);
  if (rows.length === 0) return <p className="dim disc-empty">{empty}</p>;

  const exportCsv = csvName ? (
    <div className="disc-export">
      <button
        type="button"
        className="btn secondary tiny"
        title="Every row of this table, in this order, as a CSV file for a spreadsheet"
        onClick={() => downloadCsv(csvFileName(csvName), toCsv(sorted, columns))}
      >
        Export CSV ({sorted.length.toLocaleString()})
      </button>
    </div>
  ) : null;

  const more =
    sorted.length > PAGE ? (
      <p className="dim tiny disc-more">
        Showing the first {PAGE.toLocaleString()} of {sorted.length.toLocaleString()} — narrow the search or
        sort to bring the rest into view.
      </p>
    ) : null;

  if (layout === "cards") {
    const [title, ...facts] = columns;
    return (
      <>
        {exportCsv}
        {/* No column headers to click in a card view, so the sort is a control of its own. */}
        <div className="disc-card-sort">
          <span className="small-caps dim">Sort</span>
          <Select
            ariaLabel="Sort by"
            className="disc-card-sort__select"
            value={sort.key}
            options={columns.map((c) => ({ value: c.key, label: c.label }))}
            onChange={onSort}
          />
          <button
            type="button"
            className="disc-card-sort__dir"
            title={sort.dir === 1 ? "Ascending — click for descending" : "Descending — click for ascending"}
            onClick={() => onSort(sort.key)}
          >
            {sort.dir === 1 ? "▲" : "▼"}
          </button>
        </div>
        <ScrollArea className="disc-card-scroll" resetKey={resetKey}>
          <ul className="disc-card-grid">
            {shown.map((r) => (
              <li key={rowKey(r)} className="disc-card">
                <div className="disc-card__title">{title!.render(r)}</div>
                <dl className="disc-card__facts">
                  {facts.map((c) => (
                    <div key={c.key} className="disc-card__fact">
                      <dt>{c.label}</dt>
                      <dd className={c.numeric ? "tab" : undefined}>{c.render(r)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </ScrollArea>
        {more}
      </>
    );
  }

  return (
    <>
      {exportCsv}
      <ScrollArea className="disc-table-wrap" resetKey={resetKey} onView={onView}>
        <table className="disc-table" aria-rowcount={sorted.length + 1}>
          <thead>
            <tr>
              {columns.map((c) => (
                <SortHeader key={c.key} col={c} sort={sort} onSort={onSort} />
              ))}
            </tr>
          </thead>
          <tbody ref={tbody}>
            {from > 0 ? <tr aria-hidden style={{ height: offsets[from] }} /> : null}
            {sorted.slice(from, to).map((r) => {
              const k = rowKey(r);
              return (
                <tr key={k} data-row-key={k}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.numeric ? "disc-td disc-td--num" : "disc-td"}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {to < sorted.length ? (
              <tr aria-hidden style={{ height: offsets[sorted.length]! - offsets[to]! }} />
            ) : null}
          </tbody>
        </table>
      </ScrollArea>
    </>
  );
}
