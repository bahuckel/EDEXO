import path from "node:path";

/**
 * A network share or device path (`\\host\share`, `//host/share`, `\\?\…`, `\\.\…`), judged on the path as given
 * and as resolved: `\/host/share` and `/\host\share` fail a prefix test and still resolve to `\\host\share`
 * (review 2026-11-10 C1). Any fs call on one makes Windows open an SMB session to that host and offer the account's
 * NTLM response, and blocks the thread while it waits; a path from a request is refused before any is made.
 */
export function isNetworkOrDevicePath(p: string): boolean {
  const raw = p.trim();
  if (/^[\\/]{2}/.test(raw)) return true;
  return /^[\\/]{2}/.test(path.win32.resolve(raw));
}
