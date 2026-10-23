/**
 * The galaxy engine's types: what it reports (stats, labels, hover, selection), what it is given (marker
 * items, options), and what it keeps per tile, marker layer and drawn group. Moved out of GalaxyEngine.ts
 * (audit 2026-10-22), which re-exports the public ones, so a panel can name them without the engine.
 */
import type * as THREE from "three";
import type { CellCoord } from "../../shared/galaxyGrid";
import type { Cluster, ClusterLevel } from "./clusters";
import type { GraphicsTier } from "./capabilities";

export interface EngineStats {
  phase: "loading" | "ready" | "failed";
  error?: string;
  overviewPoints: number;
  stride: number;
  tilesLoaded: number;
  tilesWanted: number;
  tilePoints: number;
  frames: number;
  lastFrameMs: number;
  distanceLy: number;
  tiltDeg: number;
  level: ClusterLevel;
  groups: number;
}

export type LabelKind = "region" | "sector" | "count" | "system" | "plan" | "badge";
export interface EngineLabel {
  id: string;
  kind: LabelKind;
  text: string;
  x: number;
  y: number;
  priority: number;
}

export type HoverInfo =
  | {
      kind: "system";
      ordinal: number;
      name: string | null;
      species: number;
      value: number;
      x: number;
      y: number;
    }
  | {
      kind: "group";
      level: ClusterLevel;
      count: number;
      top: number;
      name: string | null;
      x: number;
      y: number;
    }
  | { kind: "marker"; layer: string; id: string; x: number; y: number };

/** What was clicked: a galaxy-index system (by ordinal) or a marker of one of the layers. */
export type Selection =
  | { kind: "index"; ordinal: number; x: number; y: number; z: number }
  | { kind: "sector"; key: string; x: number; y: number; z: number }
  | { kind: "marker"; layer: string; id: string; x: number; y: number; z: number };

/** One dot of a marker layer; game coordinates, ly; size in CSS px. */
export interface MarkerItem {
  id: string;
  x: number;
  y: number;
  z: number;
  color: [number, number, number];
  size: number;
}

export interface MarkerLayer {
  items: MarkerItem[];
  points: THREE.Points;
  /** Screen positions, refreshed when the mouse asks. */
  sx: Float32Array;
  sy: Float32Array;
  /** Higher answers the mouse first where layers overlap. */
  priority: number;
}

export interface EngineOptions {
  tier: Exclude<GraphicsTier, "none">;
  /** Where the API lives; "" for the same origin. */
  apiBase?: string;
  onStats?: (s: EngineStats) => void;
  onLabels?: (labels: EngineLabel[]) => void;
  onHover?: (h: HoverInfo | null) => void;
  onSelect?: (s: Selection | null) => void;
  /** Clicked empty space while plane-click mode is on (the Codex mode picks a region with it). */
  onPlaneClick?: (g: { x: number; z: number }) => void;
}

export interface TileEntry {
  key: string;
  cell: CellCoord;
  slot: number;
  points: THREE.Points;
  pick: THREE.Points;
  count: number;
  lastUsed: number;
  positions: Int16Array;
  species: Uint8Array;
  values: Uint16Array;
  ordinals: Uint32Array;
  /** 1 where the system passes the Filter drawer's filter. */
  match: Uint8Array;
  groups320: Cluster[];
  groups80: Cluster[];
  /** The tile's room in three's space (z flipped), for the picking pass to skip tiles off the cursor. */
  box: THREE.Box3;
}

export interface ShownGroup extends Cluster {
  name: string | null;
  sx: number;
  sy: number;
  radius: number;
}
