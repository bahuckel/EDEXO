/**
 * M2 Pull to refresh (owner 2026-11-05): on a list already at its top, pulling down moves the list at 35 % of the
 * finger; let go past the mark and the list is fetched again. A desktop has no finger, so a touch or pen drag, or the
 * mouse wheel turned up past the top (a gesture that starts at the top: scrolling up to the top never pulls).
 *
 * Returns a ref for the list's scroll box. The box gets `data-pull-refresh` (an attribute React does not manage, so a
 * re-render keeps it); while pulled, `data-pull` ("pull" / "ready" / "busy") and `--pull` (px) move its children down
 * and show the mark (motion.css). Only for lists that do not update
 * themselves. Options › Look › Motion › Pull to refresh (level Full).
 */
import { useCallback, useEffect, useRef } from "react";
import { fxOn } from "../motion";

const FOLLOW = 0.35;
/** List movement (px) that refreshes on release. */
const MARK = 56;
const MAX = 84;
/** The wheel's gesture ends this long after its last turn. */
const WHEEL_IDLE_MS = 180;
/** Scrolled within this long before reaching the top: still the same scroll, not a pull. */
const WHEEL_GRACE_MS = 350;
const MIN_BUSY_MS = 450;

export function usePullToRefresh<T extends HTMLElement>(onRefresh: () => unknown): (el: T | null) => void {
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);
  const cleanup = useRef<(() => void) | null>(null);

  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    el.dataset.pullRefresh = "";
    let pull = 0;
    let busy = false;
    let lastScrolledAt = 0;
    let wheelTimer = 0;

    const show = (px: number) => {
      pull = Math.max(0, Math.min(MAX, px));
      el.style.setProperty("--pull", `${pull}px`);
      if (pull > 0) el.dataset.pull = pull >= MARK ? "ready" : "pull";
      else delete el.dataset.pull;
    };
    const release = () => {
      if (busy) return;
      if (pull < MARK) {
        show(0);
        return;
      }
      busy = true;
      show(MARK);
      el.dataset.pull = "busy";
      const started = Date.now();
      void Promise.resolve()
        .then(() => refresh.current())
        .catch(() => undefined)
        .then(() => new Promise((r) => setTimeout(r, Math.max(0, MIN_BUSY_MS - (Date.now() - started)))))
        .then(() => {
          busy = false;
          show(0);
        });
    };

    const onScroll = () => {
      if (el.scrollTop > 0) lastScrolledAt = Date.now();
    };
    const onWheel = (ev: WheelEvent) => {
      if (busy || !fxOn("pull") || ev.deltaY >= 0 || el.scrollTop > 0) {
        if (pull > 0 && ev.deltaY > 0) show(0);
        return;
      }
      if (pull === 0 && Date.now() - lastScrolledAt < WHEEL_GRACE_MS) {
        lastScrolledAt = Date.now();
        return;
      }
      ev.preventDefault();
      show(pull + -ev.deltaY * FOLLOW * (ev.deltaMode === 1 ? 16 : 1));
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(release, WHEEL_IDLE_MS);
    };

    let startY: number | null = null;
    const onDown = (ev: PointerEvent) => {
      if (busy || ev.pointerType === "mouse" || el.scrollTop > 0 || !fxOn("pull")) return;
      startY = ev.clientY;
    };
    const onMove = (ev: PointerEvent) => {
      if (startY == null) return;
      const dy = ev.clientY - startY;
      if (dy <= 0 || el.scrollTop > 0) {
        if (pull) show(0);
        return;
      }
      show(dy * FOLLOW);
    };
    const onUp = () => {
      if (startY == null) return;
      startY = null;
      release();
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    cleanup.current = () => {
      window.clearTimeout(wheelTimer);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      delete el.dataset.pullRefresh;
      el.style.removeProperty("--pull");
      delete el.dataset.pull;
    };
  }, []);
}
