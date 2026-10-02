/**
 * Garment preparation pipeline shared by the interactive Studio and the batch importer:
 * photo → cut-out + joints → (optional) suit split → exported layer (WebP + spec).
 */
import { completeJoints, type Coverage, type GarmentLayerSpec, type JointName, type Slot, type Vec2 } from '@tryon/engine';
import { closeHoles, fillEnclosedHoles, guidedFilter, inpaint, keepMainRegions, levels, luminance, maskBounds, removePlainBackground, splitMask, type Rgba } from './imaging.ts';
import type { Vision } from './vision.ts';

/** Working resolution: enough detail for a 1024 px garment texture, fast to process. */
export const WORK_MAX = 1600;
export const EXPORT_MAX = 1024;
export const JOINT_NAMES: JointName[] = [
  'R.shoulder', 'L.shoulder', 'R.elbow', 'L.elbow', 'R.wrist', 'L.wrist',
  'R.hip', 'L.hip', 'R.knee', 'L.knee', 'R.ankle', 'L.ankle',
];

export type PhotoKind = 'model' | 'plain';
export type Keep = 'all' | 'above' | 'below';

export interface CutoutResult {
  pixels: Rgba;
  alpha: Float32Array;
  joints: Record<JointName, Vec2>;
  /** A person was detected (joints are measured, not a template). */
  personFound: boolean;
}

export interface ExportedLayer {
  spec: GarmentLayerSpec;
  blob: Blob;
  ext: 'webp' | 'png';
}

export const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'product';

/** Decode an image file into a canvas no larger than WORK_MAX. */
export async function loadPhoto(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, WORK_MAX / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

/** Default joint positions for a front-on garment filling `box` (for flat-lays). */
export function templateJoints(w: number, h: number, box = { x: 0, y: 0, w, h }): Record<JointName, Vec2> {
  const cx = box.x + box.w / 2;
  const sw = box.w * 0.42;
  const at = (dx: number, fy: number): Vec2 => ({ x: cx + dx * sw, y: box.y + fy * box.h });
  return {
    'R.shoulder': at(-0.5, 0.08), 'L.shoulder': at(0.5, 0.08),
    'R.elbow': at(-0.75, 0.32), 'L.elbow': at(0.75, 0.32),
    'R.wrist': at(-0.9, 0.55), 'L.wrist': at(0.9, 0.55),
    'R.hip': at(-0.31, 0.45), 'L.hip': at(0.31, 0.45),
    'R.knee': at(-0.33, 0.8), 'L.knee': at(0.33, 0.8),
    'R.ankle': at(-0.33, 1.0), 'L.ankle': at(0.33, 1.0),
  };
}

export interface CutoutOptions {
  kind: PhotoKind;
  fillGaps: boolean;
  accessories: boolean;
}

export async function cutOut(photo: HTMLCanvasElement, vision: () => Promise<Vision>, opts: CutoutOptions): Promise<CutoutResult> {
  const w = photo.width;
  const h = photo.height;
  const pixels: Rgba = { data: photo.getContext('2d')!.getImageData(0, 0, w, h).data, width: w, height: h };
  let alpha: Float32Array;
  let skin: Float32Array | null = null;
  let joints = templateJoints(w, h);
  let personFound = false;
  if (opts.kind === 'model') {
    const v = await vision();
    const seg = v.segmentClothes(photo, opts.accessories);
    const clothes = seg.clothes;
    skin = seg.skin;
    // Snap the low-resolution mask to the real garment edges.
    const r = Math.max(4, Math.round(Math.max(w, h) * 0.006));
    alpha = levels(guidedFilter(luminance(pixels), clothes, w, h, r, 1e-3), 0.3, 0.7);
    // Edge refinement can creep over hands resting on the garment: carve skin back out, so
    // those areas become holes that are filled with fabric below.
    for (let i = 0; i < alpha.length; i++) if (skin[i] > 0.5) alpha[i] *= Math.max(0, 1 - (skin[i] - 0.5) * 4);
    // Soft ring around skin: dilate the skin mask a little (blur radius) for the steps below.
    skin = skin.map((v2) => Math.min(1, v2 * 3));
    const pose = v.detectPose(photo);
    if (pose) {
      personFound = true;
      for (const j of JOINT_NAMES) joints[j] = pose.joints[j] ?? joints[j];
    }
  } else {
    alpha = removePlainBackground(pixels);
    const box = maskBounds(alpha, w, h, 0.5, 0);
    if (box) joints = templateJoints(w, h, box);
  }
  alpha = keepMainRegions(alpha, w, h);
  if (opts.fillGaps) {
    // Clean fabric only: pixels near skin carry skin colour in their soft edges.
    const fabric = new Uint8Array(w * h);
    for (let i = 0; i < fabric.length; i++) fabric[i] = alpha[i] > 0.5 && (!skin || skin[i] < 0.3) ? 1 : 0;
    // Small notches at the edges, then enclosed holes of any size (hands resting on the garment).
    const closed = closeHoles(alpha, w, h, Math.max(3, Math.round(Math.max(w, h) * 0.012)));
    const filled = fillEnclosedHoles(closed.alpha, w, h);
    const added = new Uint8Array(w * h);
    for (let i = 0; i < added.length; i++) {
      added[i] = closed.added[i] | filled.added[i];
      // Garment pixels tinted by a neighbouring hand are recoloured too.
      if (filled.alpha[i] > 0.5 && !fabric[i]) added[i] = 1;
    }
    inpaint(pixels, added, fabric);
    alpha = filled.alpha;
  }
  return { pixels, alpha, joints, personFound };
}

const avg = (j: Record<JointName, Vec2>, a: JointName, b: JointName): Vec2 => ({ x: (j[a].x + j[b].x) / 2, y: (j[a].y + j[b].y) / 2 });

/** A typical kameez hem: a little above the knees. */
export function defaultSplitY(joints: Record<JointName, Vec2>): number {
  const hip = avg(joints, 'R.hip', 'L.hip').y;
  const knee = avg(joints, 'R.knee', 'L.knee').y;
  return hip + (knee - hip) * 0.9;
}

/**
 * Find the kameez hem in a suit photo. Below a real hem three things happen together:
 * the clothing gets clearly narrower (kameez → trouser legs), it splits into two legs, and
 * the fabric often changes colour. Each signal alone is fooled by something common in
 * Pakistani catalogues (side slits, hanging dupattas, prints, lehengas), so a split is only
 * suggested when the width drop is strong and at least one other signal agrees.
 * Returns null when there's no confident hem: the outfit then stays a single layer.
 */
export function detectHem(c: CutoutResult): number | null {
  const { pixels, alpha, joints } = c;
  const w = pixels.width;
  const h = pixels.height;
  const hip = avg(joints, 'R.hip', 'L.hip');
  const knee = avg(joints, 'R.knee', 'L.knee').y;
  const ankle = Math.min(h - 1, avg(joints, 'R.ankle', 'L.ankle').y);
  const sw = Math.hypot(joints['R.shoulder'].x - joints['L.shoulder'].x, joints['R.shoulder'].y - joints['L.shoulder'].y);
  // Plausible kameez hems: from mid-thigh to mid-shin.
  const y0 = Math.round(hip.y + (knee - hip.y) * 0.45);
  const y1 = Math.round(Math.min(h - 2, knee + (ankle - knee) * 0.55));
  if (y1 - y0 < 20 || sw < 10) return null;
  const x0 = Math.max(0, Math.round(hip.x - sw * 1.6));
  const x1 = Math.min(w - 1, Math.round(hip.x + sw * 1.6));
  const minRun = Math.max(3, Math.round(sw * 0.08));

  const rows = y1 - y0 + 1;
  const color = new Float32Array(rows * 3);
  const count = new Float32Array(rows);
  const width = new Float32Array(rows); // outer extent of clothing in the row
  const legs = new Float32Array(rows); // 1 when the row has two or more separate clothing runs
  for (let y = y0; y <= y1; y++) {
    const r = y - y0;
    let runs = 0;
    let run = 0;
    let left = -1;
    let right = -1;
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (alpha[i] > 0.6) {
        run++;
        if (left < 0) left = x;
        right = x;
        color[r * 3] += pixels.data[i * 4];
        color[r * 3 + 1] += pixels.data[i * 4 + 1];
        color[r * 3 + 2] += pixels.data[i * 4 + 2];
        count[r]++;
      } else {
        if (run >= minRun) runs++;
        run = 0;
      }
    }
    if (run >= minRun) runs++;
    legs[r] = runs >= 2 ? 1 : 0;
    width[r] = left >= 0 ? (right - left) / sw : 0;
  }
  const k = Math.max(4, Math.round(h * 0.025));
  let best = -Infinity;
  let bestY: number | null = null;
  for (let r = k; r < rows - k; r++) {
    const win = (from: number, to: number) => {
      const s = [0, 0, 0];
      let n = 0;
      let l = 0;
      let wd = 0;
      for (let q = from; q < to; q++) {
        s[0] += color[q * 3];
        s[1] += color[q * 3 + 1];
        s[2] += color[q * 3 + 2];
        n += count[q];
        l += legs[q];
        wd += width[q];
      }
      return { c: s.map((v) => v / Math.max(1, n)), legs: l / (to - from), width: wd / (to - from), n };
    };
    const above = win(r - k, r);
    const below = win(r, r + k);
    if (above.n < k * minRun || below.n < k * minRun) continue;
    // Width drop relative to the kameez width (0.25 = a quarter narrower).
    const widthDrop = (above.width - below.width) / Math.max(0.5, above.width);
    const colorJump = Math.hypot(above.c[0] - below.c[0], above.c[1] - below.c[1], above.c[2] - below.c[2]) / 80;
    const legSplit = below.legs - above.legs;
    if (widthDrop < 0.2) continue; // no real narrowing: not a kameez hem
    if (colorJump < 0.35 && legSplit < 0.4) continue; // nothing else agrees
    const score = widthDrop * 2 + Math.min(colorJump, 1) + legSplit;
    if (score > best) {
      best = score;
      bestY = y0 + r;
    }
  }
  return best >= 1.2 ? bestY : null;
}

export function layerAlpha(c: CutoutResult, keep: Keep, splitY: number): Float32Array {
  return keep === 'all' ? c.alpha : splitMask(c.alpha, c.pixels.width, c.pixels.height, splitY, keep);
}

export function coverageFor(joints: Record<JointName, Vec2>, bottomY: number): Coverage {
  const hip = avg(joints, 'R.hip', 'L.hip').y;
  const knee = avg(joints, 'R.knee', 'L.knee').y;
  const ankle = avg(joints, 'R.ankle', 'L.ankle').y;
  if (bottomY > ankle - (ankle - knee) * 0.3) return 'ankles';
  if (bottomY > hip + (knee - hip) * 0.5) return 'knees';
  return 'torso';
}

export interface ExportOptions {
  id: string;
  slot: Slot;
  alpha: Float32Array;
  opacity?: number;
}

/** Crop to the garment, scale to ≤ EXPORT_MAX, encode WebP (PNG fallback), build the layer spec. */
export async function exportLayer(c: CutoutResult, opts: ExportOptions): Promise<ExportedLayer | null> {
  const { pixels, joints } = c;
  const { alpha } = opts;
  const W = pixels.width;
  const box = maskBounds(alpha, W, pixels.height);
  if (!box) return null;
  const k = Math.min(1, EXPORT_MAX / Math.max(box.w, box.h));
  const full = new ImageData(box.w, box.h);
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      const s = (box.y + y) * W + box.x + x;
      const d = (y * box.w + x) * 4;
      full.data[d] = pixels.data[s * 4];
      full.data[d + 1] = pixels.data[s * 4 + 1];
      full.data[d + 2] = pixels.data[s * 4 + 2];
      full.data[d + 3] = alpha[s] * 255;
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = box.w;
  tmp.height = box.h;
  tmp.getContext('2d')!.putImageData(full, 0, 0);
  const out = document.createElement('canvas');
  out.width = Math.round(box.w * k);
  out.height = Math.round(box.h * k);
  const octx = out.getContext('2d')!;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(tmp, 0, 0, out.width, out.height);
  let blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/webp', 0.9));
  let ext: 'webp' | 'png' = 'webp';
  if (!blob || blob.type !== 'image/webp') {
    blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'));
    ext = 'png';
  }
  if (!blob) return null;

  const specJoints: GarmentLayerSpec['joints'] = {};
  for (const name of JOINT_NAMES) {
    const p = joints[name];
    specJoints[name] = [+((p.x - box.x) / box.w).toFixed(4), +((p.y - box.y) / box.h).toFixed(4)];
  }
  const spec: GarmentLayerSpec = {
    id: opts.id,
    slot: opts.slot,
    image: URL.createObjectURL(blob),
    size: [out.width, out.height],
    joints: specJoints,
    coverage: coverageFor(joints, box.y + box.h),
    ...(opts.opacity !== undefined && opts.opacity < 1 ? { opacity: opts.opacity } : {}),
  };
  completeJoints(spec); // validates shoulders + hips
  return { spec, blob, ext };
}

/** Average colour of a layer image, for the product swatch. */
export async function swatch(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const cx = c.getContext('2d')!;
  cx.drawImage(bmp, 0, 0, 32, 32);
  bmp.close();
  const d = cx.getImageData(0, 0, 32, 32).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
    n++;
  }
  const hex = (v: number) => Math.round(v / Math.max(1, n)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
