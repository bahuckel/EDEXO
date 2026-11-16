/**
 * The header artwork (owner, 2026-10-01: the Vista Genomics picture went on 2026-09-29, "draw a new one,
 * make sure it fits well behind all of the things there, neutral or synced with app color"; 2026-11-16:
 * "improved substantially", then "make the background rotate with the planet with time").
 *
 * A view from the ground of a planet: far ranges, hills, and the plants the app is about standing on the
 * near ground with the sample rings round one of them, under a sky that turns once in thirty minutes
 * (headerArt/scene.ts). Drawn, not a picture, and laid out against what is actually in the header: it runs
 * from 350 × 476 on a phone to 1816 × 135 on a wide screen, and where its cards sit moves with the width and
 * the system. So the land stays a thin line under the content and climbs where the header is free, and the
 * sky is shaded behind every block and line of text. Every colour comes from the scheme (`--accent-rgb`),
 * so it follows the colour scheme like the rest of the app. `aria-hidden`, under the header's content.
 *
 * Built once per layout or scheme change; after that a step only moves the sky. Stands still while the
 * window is hidden and for anyone who asked their system for less motion.
 */
import { memo, useLayoutEffect, useRef } from "react";
import { APP_THEME_EVENT } from "./appTheme";
import { drawnRects, type Layout } from "./headerArt/layout";
import { ROTATION_S, turningScene, type TurningScene } from "./headerArt/scene";

/** Which skyline and plant line-up: the same on every start. */
const SEED = 7;
/** The sky moves under 3 px a second on a wide header: 10 steps a second is under a third of a pixel a step. */
const STEP_MS = 100;
/** One clock for the page, so a rebuilt picture carries on where the last one was. */
const STARTED = performance.now();
const turnNow = () => ((performance.now() - STARTED) / 1000 / ROTATION_S) % 1;

function measure(host: HTMLElement, art: Element): Layout {
  return { w: host.clientWidth, h: host.clientHeight, taken: drawnRects(host, art) };
}

export const HeaderArt = memo(function HeaderArt() {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    const host = box?.parentElement;
    if (!box || !host) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let scene: TurningScene | null = null;
    let key = "";
    let timer = 0;

    const build = () => {
      const L = measure(host, box);
      if (L.w < 2 || L.h < 2) return;
      const cs = getComputedStyle(host);
      const accent = cs.getPropertyValue("--accent-rgb").trim() || "255, 138, 31";
      const shade = cs.getPropertyValue("--shade-top-rgb").trim() || "12, 7, 4";
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      // A block that moved by a pixel or two (a counter gaining a digit) is the same layout.
      const next = JSON.stringify([L.w, L.h, dpr, accent, shade, L.taken.map((r) => r.map((v) => Math.round(v / 4)))]);
      if (next === key) return;
      key = next;
      // Built aside and swapped in whole, so the header never shows a half-drawn picture.
      const layers = document.createElement("div");
      scene = turningScene(layers, L, accent, shade, SEED, dpr);
      scene.step(still.matches ? 0 : turnNow());
      box.replaceChildren(layers);
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(build, scene ? 250 : 0);
    };
    schedule();

    // The header's size, each of its blocks, and blocks coming and going (a Notable card, a route card).
    const ro = new ResizeObserver(schedule);
    ro.observe(host);
    for (const child of host.children) if (child !== box) ro.observe(child);
    const mo = new MutationObserver((records) => {
      if (records.some((r) => !box.contains(r.target))) schedule();
    });
    mo.observe(host, { childList: true, subtree: true });
    window.addEventListener(APP_THEME_EVENT, schedule);
    still.addEventListener("change", schedule);

    const clock = window.setInterval(() => {
      if (document.hidden || still.matches) return;
      scene?.step(turnNow());
    }, STEP_MS);

    return () => {
      window.clearTimeout(timer);
      window.clearInterval(clock);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener(APP_THEME_EVENT, schedule);
      still.removeEventListener("change", schedule);
    };
  }, []);
  return <div ref={ref} className="header-art" aria-hidden="true" />;
});
