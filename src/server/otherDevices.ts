import os from "node:os";

/*
  What another device (a paired phone, an OBS PC) is sent carries no home folder (review 2026-11-10 C5): a path under
  it holds the Windows account name, and it turned up in more fields than one could name (journalDir, journalPath,
  Colonize's liveJournalPath, the shared-exomastery folder, nested error texts). So the decision is by the peer's
  address, over the whole serialised answer, at the two places answers leave: `res.json` / sendJson for HTTP and
  sendFrame for the sockets. A field added later is covered without a list. This PC's own windows keep the paths.
*/

let cached: { home: string; re: RegExp | null } | null = null;

function homePattern(home: string): RegExp | null {
  if (cached?.home === home) return cached.re;
  // Either slash, and JSON's doubled backslash: the text is usually JSON.
  const sep = "(?:\\\\{1,2}|/)";
  const parts = home.split(/[\\/]+/).filter(Boolean);
  const re =
    home.length > 3 && parts.length > 1
      ? new RegExp(
          (/^[\\/]/.test(home) ? sep : "") + parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(sep),
          "gi",
        )
      : null;
  cached = { home, re };
  return re;
}

/** `text` (JSON or plain) with this PC's home folder as `~`. */
export function forOtherDevices(text: string, home: string = os.homedir()): string {
  const re = homePattern(home);
  return re ? text.replace(re, "~") : text;
}
