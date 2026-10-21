import { promises as fs } from "node:fs";
import path from "node:path";

export type MarketJsonRead =
  | { ok: true; market: Record<string, unknown> }
  | { ok: false; reason: "unreadable" | "invalid" | "not-market" };

/**
 * The game's `Market.json` from the journal folder: the market screen last opened.
 *
 * Three readers each wrote read → parse → check `event` by hand. The failure reason is kept so the
 * one caller that tells the commander what went wrong still can. (`ColonizeStore` reads the file
 * itself: it checks the file's signature before reading, to skip a file it has already parsed.)
 */
export async function readMarketJson(journalDir: string): Promise<MarketJsonRead> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(journalDir.trim(), "Market.json"), "utf8");
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  let market: unknown;
  try {
    market = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!market || typeof market !== "object" || (market as { event?: unknown }).event !== "Market") {
    return { ok: false, reason: "not-market" };
  }
  return { ok: true, market: market as Record<string, unknown> };
}
