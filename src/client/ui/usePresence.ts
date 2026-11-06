/**
 * Close as it opened (owner, 2026-11-06: "not all buttons and menus are animated both ways, opens with an animation but
 * closes instantly"). A panel React renders only while open vanished at once on close: this keeps it for its exit
 * animation, marked `closing` (rendered as `data-closing`, which the CSS animates), then lets it go. Instant with
 * Motion "off".
 */
import { useEffect, useState } from "react";
import { motionLevel } from "../motionCore";

/** The exit animations' length (motion.css `--motion-exit`); a little over, so the last frame is drawn. */
export const PRESENCE_EXIT_MS = 220;

export function usePresence(open: boolean, exitMs = PRESENCE_EXIT_MS): { mounted: boolean; closing: boolean } {
  const [leaving, setLeaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  // Closing starts in the render that sees `open` turn false, so the panel never drops out for a frame.
  if (wasOpen !== open) {
    setWasOpen(open);
    setLeaving(!open && motionLevel() !== "off");
  }
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => setLeaving(false), exitMs);
    return () => window.clearTimeout(t);
  }, [leaving, exitMs]);
  return { mounted: open || leaving, closing: !open && leaving };
}

/** `data-closing` while the panel leaves (spread it onto the panel's root). */
export const closingAttr = (closing: boolean) => (closing ? { "data-closing": "" } : {});
