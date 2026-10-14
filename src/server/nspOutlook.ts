/**
 * The NSP card for one system (shared/nspOutlook.ts has the what and why): what the journals and
 * EDAstro know, else a prediction from the region, the main star and — with the EDAstro phenomena
 * download — how many phenomena lie within 100 ly.
 *
 * Cost: the phenomena are ~97,000 systems, walked once per call (well under a millisecond). The answer
 * is kept per system until the phenomena file or the journals change.
 */
import { nspFamilyLabel, nspSystemsView, readNspStatus } from "./edastroNsp.js";
import { NSP_NEARBY_RADIUS_LY, nspPredict, type NspOutlookDTO } from "../shared/nspOutlook.js";

const memo = new Map<string, NspOutlookDTO>();

export function nspOutlook(o: {
  systemAddress: number;
  position: { x: number; y: number; z: number } | null;
  seen: readonly string[];
  region: string | null;
  /** The system's main star, journal `StarType` (null when not scanned). */
  starType: string | null;
}): NspOutlookDTO {
  const st = readNspStatus();
  const key = `${o.systemAddress}|${st.haveData ? st.fetchedAtMs : 0}|${o.seen.join(",")}|${o.region}|${o.starType}`;
  const hit = memo.get(key);
  if (hit) return hit;

  const v = st.haveData ? nspSystemsView() : null;
  let here = -1;
  if (v) {
    for (let i = 0; i < v.count; i++) {
      if (v.address(i) === o.systemAddress) {
        here = i;
        break;
      }
    }
  }
  let nearest: NspOutlookDTO["nearest"] = [];
  let nearby: number | null = null;
  if (v && o.position) {
    const p = o.position;
    nearby = 0;
    const byName = new Map<string, { name: string; system: string; distanceLy: number }>();
    for (let i = 0; i < v.count; i++) {
      if (i === here) continue;
      const d = Math.hypot(v.x(i) - p.x, v.y(i) - p.y, v.z(i) - p.z);
      if (d <= NSP_NEARBY_RADIUS_LY) nearby++;
      if (d > 1500) continue;
      // One entry per family: four colours of metallic crystals in one system are one kind.
      for (const id of v.ids(i)) {
        const name = nspFamilyLabel(id);
        const cur = byName.get(name);
        if (!cur || d < cur.distanceLy)
          byName.set(name, { name, system: v.name(i), distanceLy: Math.round(d) });
      }
    }
    nearest = [...byName.values()].sort((a, b) => a.distanceLy - b.distanceLy).slice(0, 4);
  }
  const guess =
    o.region || o.starType ? nspPredict({ region: o.region, starType: o.starType, nearby }) : null;
  const dto: NspOutlookDTO = {
    systemAddress: o.systemAddress,
    seen: [...o.seen],
    logged: v && here >= 0 ? [...new Set(v.ids(here).map(nspFamilyLabel))] : [],
    loggedDetail: v && here >= 0 ? v.names(here) : [],
    guess,
    nearest,
    region: o.region,
  };
  if (memo.size > 200) memo.clear();
  memo.set(key, dto);
  return dto;
}
