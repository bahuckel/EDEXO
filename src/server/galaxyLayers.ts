/**
 * Extra layers for the 3D galaxy map (guild tester report, 2026-09-30: "galaxy map showing not only
 * bios but also points of interest, NSPs, carriers"; D10). Each comes from a list the commander
 * already has on this PC — nothing here fetches anything — and is sent only when its layer is
 * switched on. Tritium sources are not a layer: nothing the app has says where tritium is.
 *
 * Compact on the wire: the phenomena are about 97,000 systems.
 */
import { poiRecords, readPoiStatus } from "./edastroPoi.js";
import { carrierRecords, readCarrierStatus } from "./edastroCarriers.js";
import { edastroGreenReports, nspBySystem, readNspStatus } from "./edastroNsp.js";
import type { BookmarksService } from "./bookmarks.js";
import { GGG_CATALOGUE } from "../shared/gggCatalogue.js";
import { GGG_CANDIDATES } from "../shared/gggCandidates.js";
import { HELIUM_GIANTS } from "../shared/heliumGiants.js";
import { loadStationsIndex } from "./stationsIndex.js";
import {
  classifyGreenGiant,
  greenCodexClassLabel,
  greenGiantScoreText,
  shortClass,
} from "../shared/greenGasGiant.js";
import type { GalaxyLayerDTO, GalaxyLayerKind } from "../shared/galaxyLayers.js";

export type { GalaxyLayerDTO, GalaxyLayerKind } from "../shared/galaxyLayers.js";

const round = (v: number) => Math.round(v * 10) / 10;

/** Builds the point list with its detail lines kept once each. */
function builder() {
  const details: string[] = [];
  const index = new Map<string, number>();
  const points: GalaxyLayerDTO["points"] = [];
  const unconfirmed: number[] = [];
  return {
    /** A point that is a guess, not a find: drawn grey and badged "unconfirmed" on the map. */
    addUnconfirmed(x: number, y: number, z: number, label: string, detail: string, system: string) {
      unconfirmed.push(points.length);
      this.add(x, y, z, label, detail, system);
    },
    add(x: number, y: number, z: number, label: string, detail: string, system: string) {
      let i = index.get(detail);
      if (i === undefined) {
        i = details.length;
        details.push(detail);
        index.set(detail, i);
      }
      points.push([round(x), round(y), round(z), label, i, system === label ? "" : system]);
    },
    done: (kind: GalaxyLayerKind, available = true): GalaxyLayerDTO => ({
      kind,
      available,
      points,
      details,
      ...(unconfirmed.length ? { unconfirmed } : {}),
    }),
  };
}

/** A green gas giant the commander confirmed that edGGG does not list yet, for the map. */
export interface OwnGreenGiant {
  x: number;
  y: number;
  z: number;
  body: string;
  system: string;
}

export function galaxyLayer(
  kind: GalaxyLayerKind,
  bookmarks: BookmarksService | undefined,
  nowMs = Date.now(),
  ownGreen?: () => readonly OwnGreenGiant[],
): GalaxyLayerDTO {
  const out = builder();
  if (kind === "ggg") {
    // The edGGG catalogue (shipped with the app), then the commander's own confirmed finds.
    const catalogued = new Set<string>();
    for (const [n, body, cls, t, x, y, z] of GGG_CATALOGUE) {
      const system = body.replace(/\s+(?:[A-Z]+\s+)?\d+(?:\s+[a-z])*$/, "");
      catalogued.add(system.toLowerCase());
      out.add(x, y, z, body, `GGG #${n} · ${shortClass(cls)} · ${Number(t.toFixed(3))} K`, system);
    }
    // EDAstro's codex reports (when the phenomena file is downloaded): systems, not bodies.
    for (const g of edastroGreenReports()) {
      if (catalogued.has(g.system.toLowerCase())) continue;
      out.add(
        g.x,
        g.y,
        g.z,
        g.system,
        `EDAstro codex report · ${g.codexIds.map(greenCodexClassLabel).join(", ")} · not in the edGGG catalogue`,
        g.system,
      );
    }
    const own = ownGreen?.() ?? [];
    for (const g of own) out.add(g.x, g.y, g.z, g.body, "Your find — not in the edGGG catalogue", g.system);
    // The cloud ladder's candidates from the Spansh dump, strongest first, scored as any scan is.
    const mine = new Set(own.map((g) => g.body.toLowerCase()));
    const ranked = GGG_CANDIDATES.flatMap(([body, system, cls, t, massEM, radiusM, x, y, z]) => {
      if (mine.has(body.toLowerCase())) return [];
      const v = classifyGreenGiant({
        planetClass: cls,
        surfaceTemperatureK: t,
        massEM,
        radiusM,
        bodyName: body,
      });
      return v?.score != null ? [{ body, system, cls, x, y, z, v, score: v.score }] : [];
    }).sort((a, b) => b.score - a.score);
    for (const c of ranked) {
      const detail = `Cloud ladder ${greenGiantScoreText(c.score)} · ${shortClass(c.cls)} · ${c.v.why}`;
      out.addUnconfirmed(c.x, c.y, c.z, c.body, detail, c.system);
    }
    return out.done(kind);
  }
  if (kind === "stations") {
    // The downloaded station index (plan 7): one point per system, its stations and largest pad on hover.
    let idx = null;
    try {
      idx = loadStationsIndex();
    } catch {
      idx = null;
    }
    if (!idx) return out.done(kind, false);
    const pads = ["no pad", "S pad", "M pad", "L pad"];
    // A system with installations only (no landing pad) has no dot; StationsIndex.pointOf counts the same way.
    idx.forEachSystem((x, y, z, pad, n, name) => {
      if (n > 0)
        out.add(x, y, z, name(), `${n} station${n === 1 ? "" : "s"} · largest ${pads[pad] ?? "no pad"}`, "");
    });
    return out.done(kind);
  }
  if (kind === "helium") {
    // Every helium gas giant known (shipped, shared/heliumGiants.ts): one point per system, its bodies listed.
    const bySystem = new Map<
      string,
      { x: number; y: number; z: number; bodies: string[]; sources: Set<string> }
    >();
    for (const [body, system, x, y, z, , , sources] of HELIUM_GIANTS) {
      const s = bySystem.get(system) ?? { x, y, z, bodies: [], sources: new Set<string>() };
      s.bodies.push(body.startsWith(system) ? body.slice(system.length).trim() || body : body);
      for (const src of sources) s.sources.add(src);
      bySystem.set(system, s);
    }
    const NAMES: Record<string, string> = { spansh: "Spansh", eddn: "EDDN", edastro: "EDAstro" };
    for (const [system, s] of bySystem) {
      const n = s.bodies.length;
      s.bodies.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
      const detail = `${n} helium gas giant${n === 1 ? "" : "s"}: ${s.bodies.join(", ")} · ${[...s.sources].map((x) => NAMES[x] ?? x).join(", ")}`;
      out.add(s.x, s.y, s.z, system, detail, system);
    }
    return out.done(kind);
  }
  if (kind === "poi") {
    if (!readPoiStatus(nowMs).haveData) return out.done(kind, false);
    for (const r of poiRecords())
      out.add(r.x, r.y, r.z, r.name, [r.typeLabel, r.system].filter(Boolean).join(" · "), r.system);
    return out.done(kind);
  }
  if (kind === "nsp") {
    if (!readNspStatus(nowMs).haveData) return out.done(kind, false);
    for (const s of nspBySystem()) out.add(s.x, s.y, s.z, s.system, s.names.join(", "), s.system);
    return out.done(kind);
  }
  if (kind === "carriers") {
    if (!readCarrierStatus(nowMs).haveData) return out.done(kind, false);
    const day = 86_400_000;
    for (const c of carrierRecords()) {
      const seen = c.lastUpdatedMs != null ? Math.max(0, Math.floor((nowMs - c.lastUpdatedMs) / day)) : null;
      out.add(
        c.x,
        c.y,
        c.z,
        c.name ? `${c.name} (${c.callsign})` : c.callsign,
        [c.system, seen != null ? `seen ${seen === 0 ? "today" : `${seen} d ago`}` : ""]
          .filter(Boolean)
          .join(" · "),
        c.system,
      );
    }
    return out.done(kind);
  }
  const items = (bookmarks?.all() ?? []).filter((b) => b.pos);
  for (const b of items) {
    out.add(
      b.pos!.x,
      b.pos!.y,
      b.pos!.z,
      b.body ? `${b.system} ${b.body}` : b.system,
      [b.tags.join(", "), b.note].filter(Boolean).join(" — "),
      b.system,
    );
  }
  return out.done(kind, items.length > 0);
}
