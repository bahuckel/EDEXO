/**
 * The four per-system attributes of an overview or tile geometry, on the very arrays the binary
 * decoded (code review, 2026-10-14). three's `Int16BufferAttribute` / `Uint8BufferAttribute` /
 * `Uint16BufferAttribute` copy what they are given (`super(new Int16Array(array))`), and the decoded
 * views stay referenced (the value filter reads them, and a view keeps its whole response buffer), so
 * every system was held twice: 10 bytes each, about 53 MB on a 5.3 M-point overview, plus the loaded
 * tiles. A plain `BufferAttribute` keeps the array, and WebGL reads the same type from it.
 */
import * as THREE from "three";

export interface PointArrays {
  positions: Int16Array;
  tiers: Uint8Array;
  species: Uint8Array;
  values: Uint16Array;
}

export function setPointAttributes(geo: THREE.BufferGeometry, a: PointArrays): void {
  geo.setAttribute("position", new THREE.BufferAttribute(a.positions, 3));
  geo.setAttribute("aTiers", new THREE.BufferAttribute(a.tiers, 1));
  geo.setAttribute("aSpecies", new THREE.BufferAttribute(a.species, 1));
  geo.setAttribute("aValue", new THREE.BufferAttribute(a.values, 1));
}
