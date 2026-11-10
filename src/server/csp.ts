/**
 * The Content-Security-Policy every page the app serves carries (Phase 6; Fable review 9.5: "No CSP
 * anywhere"). Sent as a header on HTML, so the app, the launcher, the HUD overlays and the legal
 * pages share one policy and the built index.html needs no build step. The Vite dev server does not
 * send it: its React refresh runs inline.
 *
 * - Scripts: this origin only. The launcher's script moved to launcher.js (src/client/launcher since 1.3.1) and the
 *   overlays' to hud/boot (a module; src/client/hud/boot.ts since 1.2.17) for this; an inline script or an `on…=`
 *   attribute no longer runs.
 * - Styles: inline allowed — style attributes throughout (the launcher's <style> block is a file since 1.3.1).
 * - Connections: this origin, its WebSocket, the local API by address (the launcher builds
 *   `http://127.0.0.1:<port>` URLs), and api.ipify.org for the launcher's "show my public address". The WebSocket by
 *   its host, not `ws: wss:` (any host, review 2026-11-07 §7): every page opens it on its own `location.host`, and
 *   'self' covers ws: only in newer browsers (a phone's may be older). The desktop windows load the app from
 *   127.0.0.1 (the static shell sends {@link CONTENT_SECURITY_POLICY}); a page served to a LAN browser names the
 *   address it was asked for ({@link contentSecurityPolicyFor}).
 * - Images, media and workers: this origin, plus data: and blob: (snapshots, CSV and JSON exports,
 *   the hex-signals worker).
 */
function policy(sockets: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    `connect-src 'self' ${sockets} http://127.0.0.1:* https://api.ipify.org`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

/** The desktop windows' pages, all loaded from 127.0.0.1. */
export const CONTENT_SECURITY_POLICY = policy("ws://127.0.0.1:* wss://127.0.0.1:*");

/**
 * A page served for `host` (the request's Host header, which the origin guard has already checked): its WebSocket on
 * that host. Anything that is not a plain host[:port] gets the desktop policy.
 */
export function contentSecurityPolicyFor(host: string | undefined): string {
  if (!host || !/^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/.test(host)) return CONTENT_SECURITY_POLICY;
  return policy(`ws://${host} wss://${host} ws://127.0.0.1:* wss://127.0.0.1:*`);
}
