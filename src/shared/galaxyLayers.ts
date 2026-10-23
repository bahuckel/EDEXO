/**
 * The 3D galaxy map's extra layers (server/galaxyLayers.ts builds them; D10, guild tester report
 * 2026-09-30). Each is a list the commander already has on this PC.
 */
export type GalaxyLayerKind = "poi" | "nsp" | "carriers" | "bookmarks" | "ggg" | "helium" | "stations";

export const GALAXY_LAYER_KINDS: readonly GalaxyLayerKind[] = ["poi", "nsp", "carriers", "bookmarks", "ggg", "helium", "stations"];

/**
 * [x, y, z, label, detail, system]: label is the name; detail indexes {@link GalaxyLayerDTO.details},
 * one line for the hover card (the phenomena repeat the same few hundred lines across 97,000
 * systems); system is "" when it is the label.
 */
export type GalaxyLayerPoint = [number, number, number, string, number, string];

export interface GalaxyLayerDTO {
  kind: GalaxyLayerKind;
  /** False when the list has not been downloaded (or there are no bookmarks yet). */
  available: boolean;
  points: GalaxyLayerPoint[];
  details: string[];
  /**
   * Indexes into `points` of guesses nobody has confirmed in the game — the cloud ladder's green gas
   * giant candidates (owner, 2026-10-06: "it should be more obvious that they are not real GGGs").
   */
  unconfirmed?: number[];
}

/** How an unconfirmed point is drawn: grey, a little smaller than its layer's confirmed ones. */
export const UNCONFIRMED_COLOUR: [number, number, number] = [0.78, 0.78, 0.78];

/** A point's detail line and system name, expanded. */
export function layerPointText(d: GalaxyLayerDTO, p: GalaxyLayerPoint): { detail: string; system: string } {
  return { detail: d.details[p[4]] ?? "", system: p[5] || p[3] };
}

export const GALAXY_LAYERS: readonly {
  kind: GalaxyLayerKind;
  label: string;
  /** Where the data comes from, for a layer that has none yet. */
  needs: string;
  colour: [number, number, number];
  size: number;
}[] = [
  { kind: "poi", label: "Points of interest", needs: "Download them in Points of interest", colour: [0.3, 0.85, 1], size: 6 },
  /*
    Dimmer than the others (owner, 2026-09-30): 97,000 systems, so it lies under the other layers. Size
    3 was too small to see or hit (owner, 2026-10-04: "a bit dimmer and just a bit smaller than a normal
    system"); 5, at a fifth less light.
  */
  { kind: "nsp", label: "Phenomena (NSP)", needs: "Download them in Options → Notify me", colour: [0.42, 0.23, 0.48], size: 5 },
  { kind: "carriers", label: "Carriers", needs: "Download them in Carriers & Stations", colour: [1, 0.85, 0.3], size: 5 },
  { kind: "bookmarks", label: "Bookmarks", needs: "Bookmark a system with the ☆ beside its name", colour: [0.96, 0.72, 0.24], size: 9 },
  { kind: "ggg", label: "Green gas giants", needs: "", colour: [0.62, 1, 0.18], size: 11 },
  /*
    Helium gas giants (owner, 2026-10-12): rarer than green ones — a few dozen bodies in the galaxy, in a
    handful of systems. Not the common helium-rich gas giant. One point per system.
  */
  { kind: "helium", label: "Helium gas giants", needs: "", colour: [0.86, 0.72, 1], size: 12 },
  /*
    Stations (plan 7, 1.2.16): one point per system with a station, settlements included; carriers apart. A faded
    red, a little larger than a system (owner, 2026-10-13: lone stations were hard to spot in cyan, beside the
    blue-white systems and the POI cyan).
  */
  { kind: "stations", label: "Stations", needs: "Download them in Carriers & Stations → Stations", colour: [0.9, 0.42, 0.4], size: 6 },
];
