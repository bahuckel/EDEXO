/**
 * WebSocket compression (load-time and RAM audits, 2026-10-22).
 *
 * Deflate exists for the phones and browsers on the LAN, where a snapshot push of ~0.8 MB (~10 MB in a rich system)
 * shrinks by ~85 %. Every window of the desktop app — Compare, Colonize, the launcher, each HUD — connects over
 * loopback, where deflating on the server and inflating in the window is pure cost, and each socket kept a zlib
 * context on both ends. And `perMessageDeflate.threshold` never kept the small frames raw as intended: ws applies
 * it only with server_no_context_takeover, which is not negotiated here, so every frame to every socket was deflated,
 * the radar's frames on each Status.json poll included.
 */
import type http from "node:http";
import { isLoopbackAddress } from "./lanAuth.js";
import { GZIP_MIN_BYTES } from "./routes/httpHelpers.js";

/**
 * A handshake from this PC loses its permessage-deflate offer, so its socket never deflates (neither end makes a
 * zlib context). Must run before the WebSocketServer's own `upgrade` listener, which reads the offer: Node calls
 * the listeners in the order they were added.
 */
export function dropDeflateOfferFromThisPc(req: http.IncomingMessage): void {
  if (isLoopbackAddress(req.socket?.remoteAddress)) delete req.headers["sec-websocket-extensions"];
}

/** A frame under GZIP_MIN_BYTES goes raw; a bigger one is deflated where the socket negotiated it (the LAN). */
export function frameSendOptions(msg: string): { compress: boolean } {
  return { compress: msg.length >= GZIP_MIN_BYTES };
}
