/**
 * Which port the server listens on when the commander did not choose one (owner, 2026-11-22: "permission denied"
 * when starting the app).
 *
 * Windows hands out blocks of ports to Hyper-V, WSL and Docker when it starts (WinNAT's excluded port ranges), and a
 * different block each time. One day 7098–7197 was taken, 7111 with it, and `listen` failed with EACCES — the app
 * showed "permission denied" and nothing else. So: 7111 when it can, else the first of a few fixed ports that is
 * free, and the port it lands on is remembered (launcherPrefs.ts), so the phone's links and the windows' saved
 * settings (kept per address) stay put on the next start. Fixed ports, not one the system picks, so a move is rare
 * and predictable.
 *
 * A port in use (EADDRINUSE) is not moved from: that is another copy of the app or its CLI holding the same profile,
 * and a second server beside it would be worse than the error. A port typed after `--port` is never moved from
 * either; it fails with the reason and the fix.
 */
import net from "node:net";

export const DEFAULT_PORT = 7111;
/** Tried in order after the wanted port. Out of 49152+ (the system's own short-lived ports). */
export const FALLBACK_PORTS: readonly number[] = [17111, 27111, 37111, 47111];

/** Null when the port can be listened on, else the error code (`EACCES`, `EADDRINUSE`, …). */
export type PortProbe = (port: number, host: string) => Promise<string | null>;

export const probePort: PortProbe = (port, host) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? "ERROR"));
    s.once("listening", () => s.close(() => resolve(null)));
    s.listen(port, host);
  });

/** The fix for a reserved port, as the commander would type it. */
export function freePortSteps(port: number): string {
  return [
    "To free it, run these in PowerShell as administrator, then start EDEXO again:",
    "  net stop winnat",
    `  netsh int ipv4 add excludedportrange protocol=tcp startport=${port} numberofports=1`,
    "  net start winnat",
  ].join("\n");
}

export function reservedPortMessage(port: number, opts: { explicit: boolean; tried?: readonly number[] }): string {
  const why =
    `Windows has reserved port ${port}, so EDEXO cannot listen on it ("permission denied"). ` +
    "Hyper-V, WSL and Docker take blocks of ports when Windows starts, a different block each time.";
  const what = opts.explicit
    ? `Port ${port} was chosen with --port: start with a different number, or free it.`
    : `The other ports EDEXO tries (${(opts.tried ?? []).join(", ")}) are reserved too: start with --port <number>, or free ${port}.`;
  return `${why}\n\n${what}\n\n${freePortSteps(port)}`;
}

/**
 * The port to listen on. `movedFrom` is the port that was wanted, when it was reserved and another one is used.
 * Only EACCES moves; any other failure is left to the real `listen`, which reports it as before.
 */
export async function choosePort(o: {
  wanted: number;
  /** The commander typed it (`--port`): never moved from. */
  explicit: boolean;
  host: string;
  probe?: PortProbe;
}): Promise<{ port: number; movedFrom: number | null }> {
  const probe = o.probe ?? probePort;
  const code = await probe(o.wanted, o.host);
  if (code !== "EACCES") return { port: o.wanted, movedFrom: null };
  if (o.explicit) throw new Error(reservedPortMessage(o.wanted, { explicit: true }));
  // A remembered port that became reserved goes back to 7111 first.
  const tried = [DEFAULT_PORT, ...FALLBACK_PORTS].filter((p) => p !== o.wanted);
  for (const p of tried) {
    if ((await probe(p, o.host)) === null) return { port: p, movedFrom: o.wanted };
  }
  throw new Error(reservedPortMessage(o.wanted, { explicit: false, tried }));
}

/** The launcher's line about a move, or null when there was none. */
export function portMovedNote(movedFrom: number | null, port: number): string | null {
  if (movedFrom == null) return null;
  return (
    `Port ${movedFrom} is reserved by Windows, so EDEXO moved to ${port} and stays there. ` +
    "Links and bookmarks on your phone or other devices need the new address (Network settings shows it)."
  );
}
