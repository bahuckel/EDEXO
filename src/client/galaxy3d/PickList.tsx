/**
 * A drawer row's value with a search (owner, 2026-10-12: the Expedition drawer's species list "needs a
 * search field", and its native select grew to the longest name and covered the row's label). The
 * row shows the chosen value, cut with an ellipsis; a click opens, under the row inside the drawer, a
 * search field over the options. Typing filters (any word of the label), Arrow Up / Down move, Enter
 * picks, Escape closes and gives focus back to the value. A listbox, the search field its combobox.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Tooltip } from "../ui/Tooltip";

export interface PickOption {
  value: string;
  label: string;
  /** A second line, dimmed (a genus, a count). */
  note?: string;
}

/** Options whose words all start a word of the label, in their order. */
export function filterPick(options: readonly PickOption[], query: string): PickOption[] {
  const q = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!q.length) return [...options];
  return options.filter((o) => {
    const words = `${o.label} ${o.note ?? ""}`.toLowerCase().split(/[\s()/,-]+/);
    return q.every((t) => words.some((w) => w.startsWith(t)));
  });
}

export function PickList({
  label,
  hint,
  value,
  options,
  onChange,
  placeholder = "Search",
  maxShown = 60,
  onQuery,
  valueLabel,
}: {
  label: string;
  hint: string;
  value: string;
  options: readonly PickOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Rows drawn at once; the search narrows the rest. */
  maxShown?: number;
  /**
   * The search goes to the caller (a system name looked up on the server): `options` are then shown as
   * given, not filtered here.
   */
  onQuery?: (query: string) => void;
  /** What the closed row shows when the value is not among the options (a system picked earlier). */
  valueLabel?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const valueRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const current =
    options.find((o) => o.value === value) ?? (valueLabel ? { value, label: valueLabel } : options[0]);
  const shown = useMemo(
    () => (onQuery ? [...options] : filterPick(options, query)).slice(0, maxShown),
    [options, query, maxShown, onQuery],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    searchRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, shown]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) valueRef.current?.focus({ preventScroll: true });
  };
  const pick = (o: PickOption | undefined) => {
    if (!o) return;
    if (o.value !== value) onChange(o.value);
    close(true);
  };
  const onSearchKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      pick(shown[active]);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      close(true);
    }
  };

  return (
    <div className="g3d-pick">
      <div className="g3d-row">
        <Tooltip text={hint} className="g3d-row__label">
          <span>{label}</span>
        </Tooltip>
        <span className="g3d-row__ctl g3d-pick__ctl">
          <button
            ref={valueRef}
            type="button"
            className="g3d-row__val g3d-pick__value"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? `${id}-list` : undefined}
            aria-label={`${label}: ${current?.label ?? ""}`}
            title={current?.label}
            onClick={() => (open ? close(false) : setOpen(true))}
          >
            {current?.label ?? "—"}
          </button>
        </span>
      </div>
      {open ? (
        <div className="g3d-pick__panel">
          <input
            ref={searchRef}
            className="g3d-row__input g3d-pick__search"
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={shown[active] ? `${id}-${active}` : undefined}
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder={placeholder}
            value={query}
            onChange={(ev) => {
              setQuery(ev.target.value);
              setActive(0);
              onQuery?.(ev.target.value);
            }}
            onKeyDown={onSearchKey}
            onBlur={(ev) => {
              // Closing on a click elsewhere; a click in the list keeps it (it picks).
              if (!ev.currentTarget.parentElement?.contains(ev.relatedTarget as Node | null)) close(false);
            }}
          />
          <ul ref={listRef} id={`${id}-list`} className="g3d-pick__list" role="listbox" aria-label={label}>
            {shown.map((o, i) => (
              <li
                key={o.value}
                id={`${id}-${i}`}
                data-i={i}
                role="option"
                aria-selected={o.value === value}
                className={`g3d-pick__opt${i === active ? " is-active" : ""}${o.value === value ? " is-selected" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => pick(o)}
              >
                <span className="g3d-pick__label">{o.label}</span>
                {o.note ? <span className="g3d-pick__note">{o.note}</span> : null}
              </li>
            ))}
            {!shown.length ? (
              <li className="g3d-pick__none">{query ? `Nothing matches “${query}”` : "Type to search"}</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
