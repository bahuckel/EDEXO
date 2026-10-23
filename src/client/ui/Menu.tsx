/**
 * A button that opens a menu (plan 3.3, 2026-10-12): the WAI-ARIA menu-button keys for the cockpit
 * menu and the tab strip's "+". The button says it has a menu and whether it is open; Enter, Space or
 * Arrow Down open it on the first entry, Arrow Up on the last; inside, the arrows move and wrap, Home
 * and End go to the ends, a letter jumps to the next entry starting with it, Escape closes it and gives
 * focus back to the button, Tab closes it and moves on. Entries are `role="menuitem"`, out of the Tab
 * order (`tabIndex={-1}`): the menu is one stop, the arrows do the rest.
 *
 * Not Radix DropdownMenu: on a wide app bar the cockpit menu's entries are the bar itself, always
 * shown, and only below 1,700 px a dropdown; Radix mounts the content only while open, and its items
 * do not take the tooltips the entries sit in.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { withTransition } from "../motion";

/** Spread on an entry inside a menu (`{...MENU_ITEM}`). */
export const MENU_ITEM = { role: "menuitem", tabIndex: -1 } as const;

/** The entries of this menu, not of a menu nested inside it. */
function itemsOf(menu: HTMLElement | null): HTMLElement[] {
  if (!menu) return [];
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(
    (t) =>
      t.closest('[role="menu"]') === menu &&
      !t.hasAttribute("disabled") &&
      t.getAttribute("aria-disabled") !== "true",
  );
}

/** The text a letter jumps by: the label, or the accessible name of an icon-only entry. */
const labelOf = (el: HTMLElement) =>
  (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().toLowerCase();

export function useMenuButton<B extends HTMLElement = HTMLButtonElement, M extends HTMLElement = HTMLElement>(
  open: boolean,
  setOpen: (open: boolean) => void,
) {
  const menuId = useId();
  const buttonRef = useRef<B | null>(null);
  const menuRef = useRef<M | null>(null);
  const focusOnOpen = useRef<"first" | "last" | null>(null);

  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    const items = itemsOf(menuRef.current);
    (focusOnOpen.current === "first" ? items[0] : items[items.length - 1])?.focus({ preventScroll: true });
    focusOnOpen.current = null;
  }, [open]);

  const close = useCallback(
    (refocus: boolean) => {
      withTransition(() => setOpen(false)); // fades out (motion.ts)
      if (refocus) buttonRef.current?.focus({ preventScroll: true });
    },
    [setOpen],
  );

  const onButtonKeyDown = (ev: KeyboardEvent<B>) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ((ev.key === "Enter" || ev.key === " ") && !open)) {
      ev.preventDefault();
      focusOnOpen.current = ev.key === "ArrowUp" ? "last" : "first";
      if (open) {
        const items = itemsOf(menuRef.current);
        (ev.key === "ArrowUp" ? items[items.length - 1] : items[0])?.focus({ preventScroll: true });
        focusOnOpen.current = null;
      } else setOpen(true);
    }
  };

  const onMenuKeyDown = (ev: KeyboardEvent<M>) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const items = itemsOf(menuRef.current);
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (ev.key === "ArrowDown") next = (i + 1) % items.length;
    else if (ev.key === "ArrowUp") next = (i - 1 + items.length) % items.length;
    else if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = items.length - 1;
    else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      close(true);
      return;
    } else if (ev.key === "Tab") {
      close(false);
      return;
    } else if (ev.key.length === 1 && ev.key !== " ") {
      const k = ev.key.toLowerCase();
      for (let n = 1; n <= items.length; n++) {
        const j = (i + n) % items.length;
        if (labelOf(items[j]!).startsWith(k)) {
          next = j;
          break;
        }
      }
      if (next < 0) return;
    } else return;
    ev.preventDefault();
    items[next]?.focus({ preventScroll: true });
  };

  return {
    buttonProps: {
      ref: buttonRef,
      "aria-haspopup": "menu" as const,
      "aria-expanded": open,
      "aria-controls": menuId,
      onKeyDown: onButtonKeyDown,
    },
    /** For the button's onClick: opens on the first entry, or closes. */
    toggle: () => {
      if (!open) {
        focusOnOpen.current = "first";
        setOpen(true);
      } else withTransition(() => setOpen(false));
    },
    menuProps: {
      ref: menuRef,
      id: menuId,
      role: "menu" as const,
      onKeyDown: onMenuKeyDown,
    },
    close,
  };
}

/** True while the media query matches (the cockpit menu is the bar itself from 1,700 px). */
export function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const f = () => setOn(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [query]);
  return on;
}
