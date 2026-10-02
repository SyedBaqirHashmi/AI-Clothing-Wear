import { makeGrid, type GridMesh } from './grid.ts';
import { resolveAnchor, type JointName, type Skeleton } from './rig.ts';
import { BOTTOM_BONES, DRAPE_BONES, SkinnedMesh, TOP_BONES, type BoneName, type GarmentJoints } from './skinning.ts';
import type { Fit, GarmentLayerSpec, Slot } from './types.ts';

/** Max texture size for garment images; plenty for a 720p frame and kind to low-end GPUs. */
const MAX_TEXTURE = 1024;
/** Mesh columns across the garment width; ~1–1.5k vertices bend smoothly at the joints. */
const MESH_COLS = 28;

const DEFAULT_BONES: Record<Slot, BoneName[]> = {
  top: TOP_BONES,
  outer: TOP_BONES,
  bottom: BOTTOM_BONES,
  drape: DRAPE_BONES,
};

export async function loadGarmentImage(spec: GarmentLayerSpec): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = spec.image;
  await img.decode();
  const [w, h] = spec.size;
  const k = Math.min(1, MAX_TEXTURE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Fill in joints a garment image doesn't specify (e.g. a store only marked shoulders and hips)
 * from standard body proportions, so every bone has a pose.
 */
export function completeJoints(spec: GarmentLayerSpec): GarmentJoints {
  const [w, h] = spec.size;
  const px = (j: JointName) => {
    const p = spec.joints[j];
    return p ? { x: p[0] * w, y: p[1] * h } : undefined;
  };
  const rs = px('R.shoulder');
  const ls = px('L.shoulder');
  const rh = px('R.hip');
  const lh = px('L.hip');
  if (!rs || !ls || !rh || !lh) throw new Error(`Garment ${spec.id}: shoulders and hips are required`);
  const sw = Math.hypot(rs.x - ls.x, rs.y - ls.y);
  const down = { x: 0, y: 1 };
  const out = (side: 'R' | 'L') => (side === 'R' ? -1 : 1); // wearer's right is image-left
  const j = { 'R.shoulder': rs, 'L.shoulder': ls, 'R.hip': rh, 'L.hip': lh } as GarmentJoints;
  for (const side of ['R', 'L'] as const) {
    const sh = j[`${side}.shoulder`];
    const hip = j[`${side}.hip`];
    j[`${side}.elbow`] = px(`${side}.elbow`) ?? { x: sh.x + out(side) * 0.27 * sw, y: sh.y + 0.94 * sw };
    const el = j[`${side}.elbow`];
    j[`${side}.wrist`] = px(`${side}.wrist`) ?? { x: el.x + out(side) * 0.18 * sw, y: el.y + 0.84 * sw };
    j[`${side}.knee`] = px(`${side}.knee`) ?? { x: hip.x + down.x, y: hip.y + 1.3 * sw };
    const kn = j[`${side}.knee`];
    j[`${side}.ankle`] = px(`${side}.ankle`) ?? { x: kn.x, y: kn.y + 1.25 * sw };
  }
  return j;
}

/**
 * A garment layer ready to be drawn: image + grid mesh + skinning weights.
 * `update()` poses the mesh on the current skeleton.
 */
export class Garment {
  readonly mesh: GridMesh;
  /** Deformed vertex positions in camera pixels (x,y pairs). */
  readonly positions: Float32Array;
  private readonly skin: SkinnedMesh;

  constructor(
    readonly spec: GarmentLayerSpec,
    readonly image: HTMLCanvasElement,
  ) {
    const [w, h] = spec.size;
    const rows = Math.min(64, Math.max(8, Math.round((MESH_COLS * h) / w)));
    this.mesh = makeGrid(MESH_COLS, rows);
    const verts = new Float32Array(this.mesh.uv.length);
    for (let i = 0; i < verts.length; i += 2) {
      verts[i] = this.mesh.uv[i] * w;
      verts[i + 1] = this.mesh.uv[i + 1] * h;
    }
    this.skin = new SkinnedMesh(completeJoints(spec), spec.bones ?? DEFAULT_BONES[spec.slot], verts);
    this.positions = new Float32Array(verts.length);
  }

  update(s: Skeleton, fit: Fit): void {
    this.skin.apply(s, this.positions);
    if (fit.width === 1 && fit.length === 1) return;
    // Size adjustment: scale across / down the body around the neck.
    const neck = resolveAnchor('neck', s);
    const p = this.positions;
    for (let i = 0; i < p.length; i += 2) {
      const dx = p[i] - neck.x;
      const dy = p[i + 1] - neck.y;
      const a = (dx * s.right.x + dy * s.right.y) * fit.width;
      const b = (dx * s.down.x + dy * s.down.y) * fit.length;
      p[i] = neck.x + s.right.x * a + s.down.x * b;
      p[i + 1] = neck.y + s.right.y * a + s.down.y * b;
    }
  }
}
