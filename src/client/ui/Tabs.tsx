/**
 * The keyboard for a `role="tablist"` (plan 3.3, client review F10: the screen tab strip could not be
 * worked from the keyboard). The WAI-ARIA tabs pattern: the list is one stop in the Tab order (only
 * the selected tab has tabIndex 0), Arrow Left / Right (and Up / Down) move between its tabs and wrap,
 * Home / End go to the first and last.
 *
 * Two ways to choose:
 * - `follow` (the small option strips): moving to a tab selects it, as there is nothing to wait for.
 * - otherwise (the screen strip): moving only focuses; Enter or Space opens it, since opening a screen
 *   may start its data. Delete calls `onDelete` with the focused tab (closing a screen tab).
 *
 * Not Radix Tabs: the screen strip's tabs are dragged between windows, closed by a button inside
 * them, and their panels are portal targets that stay mounted; Radix's Trigger is a button (so no
 * close button inside) and its Content mounts and unmounts.
 */
import type { KeyboardEvent } from "react";

export interface TabListKeyOptions {
  /** Moving to a tab selects it (clicks it). */
  follow?: boolean;
  /** Delete on a focused tab. */
  onDelete?: (tab: HTMLElement) => void;
}

/** The tabs of this list, not of a list nested inside it. */
function tabsOf(list: HTMLElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>('[role="tab"]')].filter(
    (t) =>
      t.closest('[role="tablist"]') === list &&
      !t.hasAttribute("disabled") &&
      t.getAttribute("aria-disabled") !== "true",
  );
}

export function tabListKeyDown(ev: KeyboardEvent<HTMLElement>, opts: TabListKeyOptions = {}): void {
  if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
  const list = ev.currentTarget;
  const tabs = tabsOf(list);
  const here = (ev.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
  const i = here ? tabs.indexOf(here) : -1;
  if (i < 0 || !here) return;
  // Keys typed on something inside a tab (its close button) other than the tab itself stay with it.
  const onTab = ev.target === here;
  let next = -1;
  switch (ev.key) {
    case "ArrowRight":
    case "ArrowDown":
      next = (i + 1) % tabs.length;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      next = (i - 1 + tabs.length) % tabs.length;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = tabs.length - 1;
      break;
    case "Enter":
    case " ":
      if (!onTab || here instanceof HTMLButtonElement) return; // a button clicks itself
      ev.preventDefault();
      here.click();
      return;
    case "Delete":
      if (!opts.onDelete) return;
      ev.preventDefault();
      opts.onDelete(here);
      return;
    default:
      return;
  }
  ev.preventDefault();
  const t = tabs[next]!;
  t.focus();
  if (opts.follow) t.click();
}
