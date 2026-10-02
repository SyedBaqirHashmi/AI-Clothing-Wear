import type { JointName, Skeleton } from './rig.ts';
import type { Vec2 } from './types.ts';

/**
 * Skeletal skinning for 2D garments (the technique used for game characters).
 *
 * The garment image carries its own skeleton: where the wearer's shoulders, elbows, hips…
 * are in the image. Each mesh vertex is attached to a few bones with weights. Every frame,
 * each bone gets a 2D affine transform from its pose in the garment image to its pose on the
 * tracked body, and each vertex follows the weighted blend of its bones' transforms.
 *
 * Why not one global warp: a single warp lets distant parts pull on each other (raised arms
 * tear the torso, spread legs stretch a kameez hem). With bones, a kurta's body follows the
 * torso and pelvis only, sleeves follow the arms, and only trousers follow the legs.
 */
export type BoneName =
  | 'chest'
  | 'pelvis'
  | 'R.upperArm'
  | 'L.upperArm'
  | 'R.forearm'
  | 'L.forearm'
  | 'R.thigh'
  | 'L.thigh'
  | 'R.shin'
  | 'L.shin';

export const TOP_BONES: BoneName[] = ['chest', 'pelvis', 'R.upperArm', 'L.upperArm', 'R.forearm', 'L.forearm'];
export const BOTTOM_BONES: BoneName[] = ['pelvis', 'R.thigh', 'L.thigh', 'R.shin', 'L.shin'];
export const DRAPE_BONES: BoneName[] = ['chest', 'pelvis'];

/** Joints a garment skeleton may specify, in garment-image pixels. */
export type GarmentJoints = Record<JointName, Vec2>;

const LIMBS: Record<string, [JointName, JointName]> = {
  'R.upperArm': ['R.shoulder', 'R.elbow'],
  'L.upperArm': ['L.shoulder', 'L.elbow'],
  'R.forearm': ['R.elbow', 'R.wrist'],
  'L.forearm': ['L.elbow', 'L.wrist'],
  'R.thigh': ['R.hip', 'R.knee'],
  'L.thigh': ['L.hip', 'L.knee'],
  'R.shin': ['R.knee', 'R.ankle'],
  'L.shin': ['L.knee', 'L.ankle'],
};

/** Capsule radius per bone, in shoulder widths: how "thick" the body part is. */
const RADIUS: Record<BoneName, number> = {
  chest: 0.42,
  pelvis: 0.42,
  'R.upperArm': 0.12,
  'L.upperArm': 0.12,
  'R.forearm': 0.1,
  'L.forearm': 0.1,
  'R.thigh': 0.2,
  'L.thigh': 0.2,
  'R.shin': 0.14,
  'L.shin': 0.14,
};

/**
 * Garment images show the wearer front-on with the arms beside the body, so sleeves lie outside
 * a "torso column". Arm bones may only move pixels outside it; otherwise a raised arm would drag
 * the kameez skirt pixels that happen to sit next to the hanging sleeve.
 * The column is narrow at the shoulder cap and widens to full width at the armpit, but never
 * reaches into the arm itself: in model photos the arms often hang close to the body.
 * Values in shoulder widths.
 */
const COLUMN_AT_SHOULDER = 0.36;
const COLUMN_BELOW_ARMPIT = 0.62;
const ARMPIT_T = 0.3; // fraction of shoulder→hip
const ARM_CLEARANCE = 0.14; // keep the column this far inside the arm's centre line

/** x of a polyline at height y (null if y is outside its vertical range). */
function polylineXAt(points: Vec2[], y: number): number | null {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    if (y >= lo && y <= hi && hi > lo) return a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
  }
  return null;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Max bones per vertex and weight falloff. */
const MAX_INFLUENCES = 4;
const FALLOFF_POWER = 3;
const SOFTNESS = 0.06; // shoulder widths

/** 2×3 affine matrix [a, b, c, d, tx, ty]: x' = a x + c y + tx, y' = b x + d y + ty */
type Affine = Float64Array;

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2));
  return Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t));
}

/** Affine transform mapping triangle (s0,s1,s2) onto (t0,t1,t2). */
function triangleAffine(s: [Vec2, Vec2, Vec2], t: [Vec2, Vec2, Vec2], out: Affine): void {
  const s1 = sub(s[1], s[0]);
  const s2 = sub(s[2], s[0]);
  const t1 = sub(t[1], t[0]);
  const t2 = sub(t[2], t[0]);
  const det = s1.x * s2.y - s2.x * s1.y || 1e-9;
  // M = T · S⁻¹ with S = [s1 s2], T = [t1 t2] (columns)
  const i00 = s2.y / det;
  const i01 = -s2.x / det;
  const i10 = -s1.y / det;
  const i11 = s1.x / det;
  const a = t1.x * i00 + t2.x * i10;
  const c = t1.x * i01 + t2.x * i11;
  const b = t1.y * i00 + t2.y * i10;
  const d = t1.y * i01 + t2.y * i11;
  out[0] = a;
  out[1] = b;
  out[2] = c;
  out[3] = d;
  out[4] = t[0].x - (a * s[0].x + c * s[0].y);
  out[5] = t[0].y - (b * s[0].x + d * s[0].y);
}

/**
 * Limb transform: rotate the bone onto the target bone, scale along the bone by the length
 * ratio (handles foreshortening) and across it by the body-scale ratio (sleeve width follows
 * body size, not arm length).
 */
function limbAffine(sa: Vec2, sb: Vec2, ta: Vec2, tb: Vec2, widthScale: number, out: Affine): void {
  const sv = sub(sb, sa);
  const tv = sub(tb, ta);
  const sl = Math.hypot(sv.x, sv.y) || 1;
  const tl = Math.hypot(tv.x, tv.y) || 1;
  const along = Math.min(2, Math.max(0.25, tl / sl));
  const su = { x: sv.x / sl, y: sv.y / sl };
  const tu = { x: tv.x / tl, y: tv.y / tl };
  // Perpendiculars with the same handedness in both spaces.
  const sn = { x: -su.y, y: su.x };
  const tn = { x: -tu.y, y: tu.x };
  // x' = ta + tu·(along · su·(x−sa)) + tn·(widthScale · sn·(x−sa))
  const a = tu.x * along * su.x + tn.x * widthScale * sn.x;
  const c = tu.x * along * su.y + tn.x * widthScale * sn.y;
  const b = tu.y * along * su.x + tn.y * widthScale * sn.x;
  const d = tu.y * along * su.y + tn.y * widthScale * sn.y;
  out[0] = a;
  out[1] = b;
  out[2] = c;
  out[3] = d;
  out[4] = ta.x - (a * sa.x + c * sa.y);
  out[5] = ta.y - (b * sa.x + d * sa.y);
}

/**
 * Torso bone geometry used both for weights (capsule) and transforms (triangle).
 * The pelvis triangle uses the hip *width* measured across the body axis rather than the raw
 * hip line, so a tilted or twisted pelvis (lunge, 3/4 view) doesn't shear the kameez skirt.
 */
function torsoFrames(j: GarmentJoints | Skeleton['joints'], right: Vec2) {
  const sm = mid(j['R.shoulder'], j['L.shoulder']);
  const hm = mid(j['R.hip'], j['L.hip']);
  const hipHalf = Math.abs((j['R.hip'].x - j['L.hip'].x) * right.x + (j['R.hip'].y - j['L.hip'].y) * right.y) / 2;
  return {
    sm,
    hm,
    chestSeg: [sm, lerp(sm, hm, 0.6)] as [Vec2, Vec2],
    pelvisSeg: [lerp(sm, hm, 0.6), hm] as [Vec2, Vec2],
    chestTri: [j['R.shoulder'], j['L.shoulder'], hm] as [Vec2, Vec2, Vec2],
    pelvisTri: [
      { x: hm.x + right.x * hipHalf, y: hm.y + right.y * hipHalf },
      { x: hm.x - right.x * hipHalf, y: hm.y - right.y * hipHalf },
      sm,
    ] as [Vec2, Vec2, Vec2],
  };
}

/** In garment images the wearer faces the viewer: their right is image-left. */
const IMAGE_RIGHT: Vec2 = { x: -1, y: 0 };

export class SkinnedMesh {
  readonly vertexCount: number;
  private readonly rest: Float32Array;
  private readonly boneIdx: Uint8Array;
  private readonly boneW: Float32Array;
  private readonly mats: Affine[];
  private readonly sourceScale: number;

  constructor(
    private readonly joints: GarmentJoints,
    private readonly bones: readonly BoneName[],
    vertices: Float32Array,
  ) {
    this.vertexCount = vertices.length / 2;
    this.rest = vertices;
    this.sourceScale = Math.hypot(joints['R.shoulder'].x - joints['L.shoulder'].x, joints['R.shoulder'].y - joints['L.shoulder'].y);
    this.mats = bones.map(() => new Float64Array(6));
    this.boneIdx = new Uint8Array(this.vertexCount * MAX_INFLUENCES);
    this.boneW = new Float32Array(this.vertexCount * MAX_INFLUENCES);

    const tf = torsoFrames(joints, IMAGE_RIGHT);
    const segs = bones.map((b): [Vec2, Vec2] =>
      b === 'chest' ? tf.chestSeg : b === 'pelvis' ? tf.pelvisSeg : [joints[LIMBS[b][0]], joints[LIMBS[b][1]]],
    );
    // The pelvis also carries everything below the hips (kameez skirt) when no leg bones exist.
    const hasLegs = bones.some((b) => b.endsWith('thigh'));
    const sw = this.sourceScale;
    const d = new Float64Array(bones.length);
    const isArm = bones.map((b) => b.endsWith('Arm') || b.endsWith('forearm'));
    const arms = (['R', 'L'] as const).map((side) => [joints[`${side}.shoulder`], joints[`${side}.elbow`], joints[`${side}.wrist`]]);
    const armMask = (p: Vec2): number => {
      const t = (p.y - tf.sm.y) / (tf.hm.y - tf.sm.y || 1);
      const cx = tf.sm.x + (tf.hm.x - tf.sm.x) * Math.min(1, Math.max(0, t));
      let half = (COLUMN_AT_SHOULDER + (COLUMN_BELOW_ARMPIT - COLUMN_AT_SHOULDER) * Math.min(1, Math.max(0, t / ARMPIT_T))) * sw;
      // Arm on this pixel's side of the body (image-left = wearer's right).
      const armX = polylineXAt(arms[p.x < cx ? 0 : 1], p.y);
      if (armX !== null) half = Math.min(half, Math.max(COLUMN_AT_SHOULDER * sw, Math.abs(armX - cx) - ARM_CLEARANCE * sw));
      return smoothstep(half - 0.03 * sw, half + 0.05 * sw, Math.abs(p.x - cx));
    };
    for (let v = 0; v < this.vertexCount; v++) {
      const p = { x: vertices[2 * v], y: vertices[2 * v + 1] };
      for (let i = 0; i < bones.length; i++) {
        let seg = segs[i];
        if (bones[i] === 'pelvis' && !hasLegs) seg = [seg[0], { x: seg[1].x + (seg[1].x - seg[0].x) * 4, y: seg[1].y + (seg[1].y - seg[0].y) * 4 }];
        d[i] = Math.max(0, segmentDistance(p, seg[0], seg[1]) / sw - RADIUS[bones[i]]);
      }
      const mask = armMask(p);
      const raw = [...d].map((di, i) => (isArm[i] ? mask : 1) / Math.pow(di + SOFTNESS, FALLOFF_POWER));
      // Keep the strongest bones.
      const order = [...raw.keys()].sort((a, b) => raw[b] - raw[a]).slice(0, MAX_INFLUENCES);
      let total = 0;
      const w = order.map((i) => {
        total += raw[i];
        return raw[i];
      });
      for (let k = 0; k < MAX_INFLUENCES; k++) {
        this.boneIdx[v * MAX_INFLUENCES + k] = order[k] ?? 0;
        this.boneW[v * MAX_INFLUENCES + k] = order[k] === undefined ? 0 : w[k] / total;
      }
    }
  }

  /** Pose the mesh on a tracked skeleton; writes x,y pairs into `out`. */
  apply(s: Skeleton, out: Float32Array): void {
    const widthScale = s.scale / this.sourceScale;
    const src = torsoFrames(this.joints, IMAGE_RIGHT);
    const dst = torsoFrames(s.joints, s.right);
    this.bones.forEach((b, i) => {
      if (b === 'chest') triangleAffine(src.chestTri, dst.chestTri, this.mats[i]);
      else if (b === 'pelvis') triangleAffine(src.pelvisTri, dst.pelvisTri, this.mats[i]);
      else {
        const [ja, jb] = LIMBS[b];
        limbAffine(this.joints[ja], this.joints[jb], s.joints[ja], s.joints[jb], widthScale, this.mats[i]);
      }
    });
    const rest = this.rest;
    for (let v = 0; v < this.vertexCount; v++) {
      const x = rest[2 * v];
      const y = rest[2 * v + 1];
      let ox = 0;
      let oy = 0;
      for (let k = 0; k < MAX_INFLUENCES; k++) {
        const w = this.boneW[v * MAX_INFLUENCES + k];
        if (w === 0) continue;
        const m = this.mats[this.boneIdx[v * MAX_INFLUENCES + k]];
        ox += w * (m[0] * x + m[2] * y + m[4]);
        oy += w * (m[1] * x + m[3] * y + m[5]);
      }
      out[2 * v] = ox;
      out[2 * v + 1] = oy;
    }
  }
}
