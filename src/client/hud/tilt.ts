/*
  The Elite Style's turn at the same angle on every panel (owner, 2026-10-26: separate panels "do not have the same
  angle"; his choice of the two offered: the same angle, short panels a little more squeezed at the far end). Under
  perspective(d) rotateY(t) a panel's top and bottom edges slope by about (height / 2d) · tan t, so with one fixed
  depth (60rem) for all, a tall panel slanted more than a short one and the separate windows did not line up. The
  depth follows the panel's own layout height instead, which the transform does not change, so there is no feedback
  through the window's size. A floor keeps a one-line panel from being squeezed to a sliver.
*/
export const TILT_DEPTH_PER_HEIGHT = 2;
export const TILT_DEPTH_MIN_PX = 240;

export function tiltDepthPx(height: number): number {
  return Math.round(Math.max(TILT_DEPTH_MIN_PX, TILT_DEPTH_PER_HEIGHT * Math.max(0, Number.isFinite(height) ? height : 0)));
}

/*
  One door for every panel (owner, 2026-11-01: separate panels "fan out", "it should keep the same angle/swing to all of
  them"). Each panel converged on its own middle, so a stack splayed like blinds. Now every panel on a screen shares
  one vanishing point, the middle of that screen, and one depth (as for a panel half the screen's height): each is a
  slice of the same turned plane, at the same angle wherever it sits.
*/
export function sharedTiltDepthPx(screenHeight: number): number {
  return tiltDepthPx((Number.isFinite(screenHeight) ? screenHeight : 0) / 2);
}

/** Where the screen's middle is, from the panel's own top (px): the shared vanishing point's height. */
export function tiltOriginYPx(screenTop: number, screenHeight: number, panelScreenTop: number): number {
  return Math.round(screenTop + screenHeight / 2 - panelScreenTop);
}
