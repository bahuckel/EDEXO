/**
 * Rows that move slide to their new place instead of jumping (R3b, owner 2026-10-23: "no jumping around"; a delivered
 * material going to the bottom, trips renumbered after a delivery). FLIP: each child with `data-flip-key` is measured
 * after every render; one that moved since the last render starts where it was and animates to where it is. A new
 * row fades in. Full motion slides; Reduced only fades the new rows; Off does nothing (motion.ts).
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { motionLevel } from "../motion";

export function useFlip(container: RefObject<HTMLElement | null>): void {
  const last = useRef<Map<string, DOMRect>>(new Map());
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    // A list in a hidden tab (Colonize keeps its Plan tab mounted) has no places: forget them, so showing it again
    // does not slide every row in from the corner.
    if (!root.getClientRects().length) {
      last.current = new Map();
      return;
    }
    const level = motionLevel();
    const next = new Map<string, DOMRect>();
    const rows = root.querySelectorAll<HTMLElement>("[data-flip-key]");
    for (const el of rows) next.set(el.dataset.flipKey!, el.getBoundingClientRect());
    const prev = last.current;
    last.current = next;
    // The first render, a hidden list, or motion off: just remember where everything is.
    if (!prev.size || level === "off" || typeof rows[0]?.animate !== "function") return;
    for (const el of rows) {
      const now = next.get(el.dataset.flipKey!)!;
      const was = prev.get(el.dataset.flipKey!);
      if (!was) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
        continue;
      }
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (level === "full" && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) {
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
          duration: 200,
          easing: "cubic-bezier(0.2, 0.8, 0.3, 1)",
        });
      }
    }
  });
}
