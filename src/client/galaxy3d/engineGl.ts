/**
 * The galaxy engine's constants, and the WebGL objects it builds without needing the engine's state: the
 * half-float render target, the overview's cell mask and the Elite controls' cross-hair. Moved out of
 * GalaxyEngine.ts (audit 2026-10-22).
 */
import * as THREE from "three";
import type { CellBounds } from "../../shared/galaxyGrid";

/** The colour scheme's accent (`--accent` on the page), for lines drawn in WebGL. */
export function accentColour(): THREE.Color {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    if (v) return new THREE.Color(v);
  } catch {
    /* no page style (a test): the default below */
  }
  return new THREE.Color(0xff9a3c);
}

/** Sagittarius A* in three's space (the game's z flipped): what "core" frames. */
export const CORE = new THREE.Vector3(25.2, 0, -25_900);
export const SOL = new THREE.Vector3(0, 0, 0);
export const TOP_HEIGHT = 110_000;
/** A ring's radius on screen, px: the same log scale as its shader (ringVertex). */
export const ringRadius = (count: number) => Math.min(34, Math.max(10, 10 + 5 * Math.log10(Math.max(1, count)))) / 2;
/** Inside this, system names are shown and systems are picked one by one. */
export const SYSTEM_DISTANCE = 1_600;

/** System names kept for labels and the hover card; past this the oldest are asked for again. */
export const NAMES_MAX = 20_000;
/** How long a failed names request waits before the next (review 2026-11-10 F2). */
export const NAMES_RETRY_MS = 5_000;

/**
 * The Milky Way's two layers (owner, 2026-10-04): the drawing laid faintly on the plane, and the 3D
 * clouds over it. The plane carries the detail and most of the light, the clouds — wide, soft and
 * fainter since "still blotchy" — the depth seen from the side; together a little brighter than the
 * drawing alone used to be (0.5), since the clouds spread theirs above and below the plane.
 */
export const PLANE_UNDER_CLOUDS = 0.4;
export const CLOUDS_OVER_PLANE = 0.24;

/** The galaxy picture on the plane, already placed in ly; `loaded` runs once the image is in. */
export function makePicturePlane(
  photo: { url: string; x0: number; x1: number; zBottom: number; zTop: number },
  loaded: () => void,
): { plane: THREE.Mesh; tex: THREE.Texture } {
  const tex = new THREE.TextureLoader().load(photo.url, loaded);
  tex.colorSpace = THREE.SRGBColorSpace;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(photo.x1 - photo.x0, photo.zTop - photo.zBottom),
    // Both sides: the Elite controls look at the map from under it too (owner, 2026-10-06).
    // Added, not blended: the drawing's black margin is darker than the background, and blended it
    // showed as a darker rectangle with a hard edge (owner, 2026-10-06). Black adds nothing, so the
    // margin vanishes; the picture itself is brighter by a fraction of the near-black background.
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      opacity: 0.7,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    }),
  );
  plane.rotation.x = -Math.PI / 2; // into the plane; the image's top toward the game's +z
  plane.position.set((photo.x0 + photo.x1) / 2, -1, -(photo.zTop + photo.zBottom) / 2);
  // Under the clouds.
  plane.renderOrder = -3;
  return { plane, tex };
}

/**
 * A copy of the loaded galaxy picture `px` wide (Layers › Picture detail, owner 2026-11-23): the sharp 4096 px picture
 * reads as a flat image under the soft clouds, a smaller one is soft like the 1212 px picture the clouds were first
 * tuned over. Null where there is no 2D canvas; the plane then keeps the picture as loaded.
 */
export function pictureCopy(img: HTMLImageElement, px: number): THREE.CanvasTexture | null {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(px));
  canvas.height = Math.max(1, Math.round((img.height * canvas.width) / img.width));
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeRenderTarget(w: number, h: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
}

export function makeCellMask(b: CellBounds): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    new Uint8Array(b.dims.x * b.dims.y * b.dims.z),
    b.dims.x,
    b.dims.y * b.dims.z,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** The cross-hair: a cross at the target, its ring on the galactic plane, and the line between. */
export function buildCrosshair(colour: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({
    color: colour,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  });
  const faint = new THREE.LineBasicMaterial({
    color: colour,
    transparent: true,
    opacity: 0.45,
    depthTest: false,
  });
  const cross = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(-0.25, 0, 0),
      new THREE.Vector3(0.25, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0, -0.25),
      new THREE.Vector3(0, 0, 0.25),
      new THREE.Vector3(0, 0, 1),
    ]),
    mat,
  );
  cross.name = "cross";
  const ringPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    ringPts.push(new THREE.Vector3(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6));
  }
  const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), faint);
  ring.name = "ring";
  const stem = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]),
    faint,
  );
  stem.name = "stem";
  for (const o of [cross, ring, stem]) o.renderOrder = 10;
  g.add(cross, ring, stem);
  g.visible = false;
  return g;
}
