import { pickWingColor } from "../../shared/colonize/wingManifest";
import type { WingMember } from "../../shared/colonize/wingManifest";
import { fetchEdsmCommanderCargo } from "./edsmCommanderCargo";

export type WingRosterEntry = {
  commanderName: string;
  lastSeenIso: string;
};

export async function syncWingCargoFromEdsm(args: {
  roster: WingRosterEntry[];
  edsmApiKey?: string | null;
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

    const res = await fetchEdsmCommanderCargo(name, args.edsmApiKey);
    if (!res.ok) {
      notes.push(`${name}: ${res.err}`);
      continue;
    }
    if (!res.lines.length) {
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
