/**
 * Rows that move slide to their new place instead of jumping (R3b, owner 2026-10-23: "no jumping around"; a delivered
 * material going to the bottom, trips renumbered after a delivery). FLIP: each child with `data-flip-key` is measured
 * after every render; one that moved since the last render starts where it was and animates to where it is. A new
 * row fades in. Full motion slides; Reduced only fades the new rows; Off does nothing (motion.ts).
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { motionLevel } from "../motion";

/** A row's place inside the list, so scrolling the page or the list does not count as moving (review 2026-10-24). */
type Place = { x: number; y: number };

export function useFlip(container: RefObject<HTMLElement | null>): void {
  const last = useRef<Map<string, Place>>(new Map());
  // The slide each row is in, so a render during it continues from where the row is instead of jumping.
  const running = useRef(new WeakMap<Element, Animation>());
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
    const box = root.getBoundingClientRect();
    const place = (el: Element): Place => {
      const r = el.getBoundingClientRect();
      return { x: r.left - box.left, y: r.top - box.top };
    };
    const next = new Map<string, Place>();
    const midway = new Map<string, Place>();
    const rows = root.querySelectorAll<HTMLElement>("[data-flip-key]");
    for (const el of rows) {
      const key = el.dataset.flipKey!;
      const anim = running.current.get(el);
      if (anim) {
        if (anim.playState === "running") midway.set(key, place(el));
        anim.cancel?.();
        running.current.delete(el);
      }
      next.set(key, place(el));
    }
    const prev = last.current;
    last.current = next;
    // The first render, a hidden list, or motion off: just remember where everything is.
    if (!prev.size || level === "off" || typeof rows[0]?.animate !== "function") return;
    for (const el of rows) {
      const key = el.dataset.flipKey!;
      const now = next.get(key)!;
      const was = midway.get(key) ?? prev.get(key);
      if (!was) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
        continue;
      }
      const dx = was.x - now.x;
      const dy = was.y - now.y;
      if (level === "full" && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) {
        const anim = el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
          duration: 200,
          easing: "cubic-bezier(0.2, 0.8, 0.3, 1)",
        });
        running.current.set(el, anim);
      }
    }
  });
}
