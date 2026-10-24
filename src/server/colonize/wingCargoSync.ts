import { pickWingColor } from "../../shared/colonize/wingManifest";
import type { WingMember } from "../../shared/colonize/wingManifest";
import { fetchEdsmCommanderCargo } from "./edsmCommanderCargo";

export type WingRosterEntry = {
  commanderName: string;
  lastSeenIso: string;
};

/** "CMDR Foo" and "foo" are one commander. */
const sameCommander = (a: string, b: string) => {
  const n = (s: string) => s.trim().replace(/^cmdr\s+/i, "").toLowerCase();
  return n(a) !== "" && n(a) === n(b);
};

export async function syncWingCargoFromEdsm(args: {
  roster: WingRosterEntry[];
  edsmApiKey?: string | null;
  /**
   * The commander the key belongs to. The key is sent only with that name (owner, 2026-10-24): it opens nobody
   * else's cargo, and sent with a wingmate's name it only told EDSM whose key asked.
   */
  edsmCommanderName?: string | null;
  existing?: WingMember[];
}): Promise<{ members: WingMember[]; notes: string[] }> {
  const notes: string[] = [];
  const byName = new Map<string, WingMember>();
  for (const m of args.existing ?? []) {
    if (m.name?.trim()) byName.set(m.name.trim().toLowerCase(), m);
  }

  let colorIdx = byName.size;
  for (const entry of args.roster) {
    const name = entry.commanderName.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    let member = byName.get(key);
    if (!member) {
      member = {
        id: `wing-${key.replace(/\s+/g, "-")}`,
        name,
        color: pickWingColor(colorIdx++),
        claims: [],
      };
      byName.set(key, member);
    }

    const own = args.edsmCommanderName ? sameCommander(name, args.edsmCommanderName) : false;
    const res = await fetchEdsmCommanderCargo(name, own ? args.edsmApiKey : null);
    if (!res.ok) {
      notes.push(`${name}: ${res.err}`);
      continue;
    }
    if (!res.lines.length) {
      // An empty hold now: the last sync's claims go, or the plan keeps subtracting cargo already delivered (review
      // 2026-10-24). A failed request (above) keeps them.
      member.claims = [];
      notes.push(`${name}: no cargo rows on EDSM`);
      continue;
    }
    member.claims = res.lines.map((l) => ({
      commodityId: l.commodityId,
      label: l.label,
      tons: l.tons,
    }));
    notes.push(`${name}: ${res.lines.length} cargo line(s) from EDSM`);
  }

  return { members: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), notes };
}
