import { OneEuroFilter, type OneEuroParams } from './one-euro.ts';
import { JOINT_COUNT, JOINT_ORDER, type PoseJoint } from './pose/backend.ts';
import type { JointName, Skeleton } from './rig.ts';
import type { Vec2 } from './types.ts';

/**
 * Filters are tuned in units of "frame heights" so they behave the same at any resolution.
 * Torso joints move slowly and must be rock-steady; hands and feet need less lag.
 */
const TORSO_FILTER: OneEuroParams = { minCutoff: 1.0, beta: 4.0, dCutoff: 1.0 };
const LIMB_FILTER: OneEuroParams = { minCutoff: 1.5, beta: 6.0, dCutoff: 1.0 };
const LIMB_ENDS = new Set<PoseJoint>(['L.wrist', 'R.wrist', 'L.ankle', 'R.ankle', 'L.elbow', 'R.elbow']);

/** Max time we extrapolate a pose forward (s), and how much of the velocity we trust. */
const MAX_PREDICT_S = 0.1;
const PREDICT_GAIN = 0.75;
/** Forget the person after this long without a detection (ms). */
const LOST_AFTER_MS = 600;

export interface BodyRegions {
  hips: boolean;
  knees: boolean;
  ankles: boolean;
}

export interface BodyState {
  skeleton: Skeleton;
  regions: BodyRegions;
  /** Shoulder width as a fraction of frame width. */
  shoulderFrac: number;
  /** Estimated top of head is above the frame. */
  headCut: boolean;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2, k = 1): Vec2 => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const len = (a: Vec2): number => Math.hypot(a.x, a.y);
const norm = (a: Vec2): Vec2 => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
const mix = (a: Vec2, b: Vec2, w: number): Vec2 => ({ x: b.x + (a.x - b.x) * w, y: b.y + (a.y - b.y) * w });

/**
 * Turns noisy per-frame joints into a stable, complete skeleton:
 *  1. One-Euro filtering per coordinate (removes jitter without adding lag when moving)
 *  2. Velocity-based prediction to the render time (hides tracker latency on slow phones)
 *  3. Hidden or off-screen joints are estimated from body proportions and blended in by visibility
 */
export class BodyModel {
  private fx: OneEuroFilter[] = [];
  private fy: OneEuroFilter[] = [];
  private vis = new Float32Array(JOINT_COUNT);
  private lastTime = -Infinity;
  private has = false;

  constructor() {
    for (const j of JOINT_ORDER) {
      const p = LIMB_ENDS.has(j) ? LIMB_FILTER : TORSO_FILTER;
      this.fx.push(new OneEuroFilter(p));
      this.fy.push(new OneEuroFilter(p));
    }
  }

  reset(): void {
    this.fx.forEach((f) => f.reset());
    this.fy.forEach((f) => f.reset());
    this.vis.fill(0);
    this.has = false;
  }

  /**
   * Feed a tracker sample. Points are normalised (0..1) to a frame of width w and height h.
   * @param timeMs capture time of the frame (performance.now())
   */
  update(points: Float32Array | null, timeMs: number, w: number, h: number): void {
    if (!points) {
      if (timeMs - this.lastTime > LOST_AFTER_MS) this.reset();
      return;
    }
    const t = timeMs / 1000;
    const aspect = w / h;
    for (let j = 0; j < JOINT_COUNT; j++) {
      // Work in frame-height units so x and y share a scale.
      this.fx[j].filter(points[j * 3] * aspect, t);
      this.fy[j].filter(points[j * 3 + 1], t);
      const v = points[j * 3 + 2];
      this.vis[j] = this.has ? this.vis[j] * 0.5 + v * 0.5 : v;
    }
    this.lastTime = timeMs;
    this.has = true;
  }

  get tracking(): boolean {
    return this.has;
  }

  get lastSampleTime(): number {
    return this.lastTime;
  }

  /** Build the skeleton (camera pixels) predicted to `timeMs`. Null if no usable person. */
  state(timeMs: number, w: number, h: number): BodyState | null {
    if (!this.has) return null;
    const dt = Math.min(Math.max((timeMs - this.lastTime) / 1000, 0), MAX_PREDICT_S) * PREDICT_GAIN;
    const raw: Vec2[] = [];
    const weight: number[] = [];
    for (let j = 0; j < JOINT_COUNT; j++) {
      const x = (this.fx[j].value! + this.fx[j].velocity * dt) * h;
      const y = (this.fy[j].value! + this.fy[j].velocity * dt) * h;
      raw.push({ x, y });
      const inside = x > -0.02 * w && x < 1.02 * w && y > -0.02 * h && y < 1.02 * h;
      weight.push(inside ? smoothstep(0.35, 0.75, this.vis[j]) : 0);
    }
    const J = (name: PoseJoint): number => JOINT_ORDER.indexOf(name);
    const iRS = J('R.shoulder');
    const iLS = J('L.shoulder');
    if (weight[iRS] < 0.2 || weight[iLS] < 0.2) return null;

    const rs = raw[iRS];
    const ls = raw[iLS];
    const sm = { x: (rs.x + ls.x) / 2, y: (rs.y + ls.y) / 2 };
    let sw = len(sub(rs, ls));

    // Body axes. Prefer the shoulder→hip direction; otherwise perpendicular to the shoulders.
    const iRH = J('R.hip');
    const iLH = J('L.hip');
    const hipW = Math.min(weight[iRH], weight[iLH]);
    const shoulderLine = norm(sub(rs, ls)); // points towards wearer's right
    let perp = { x: -shoulderLine.y, y: shoulderLine.x };
    if (perp.y < 0) perp = { x: -perp.x, y: -perp.y }; // "down" in the image
    const hmRaw = { x: (raw[iRH].x + raw[iLH].x) / 2, y: (raw[iRH].y + raw[iLH].y) / 2 };
    const torsoDir = norm(sub(hmRaw, sm));
    const down = norm(mix(torsoDir, perp, hipW));
    let right = { x: -down.y, y: down.x };
    if (right.x * shoulderLine.x + right.y * shoulderLine.y < 0) right = { x: -right.x, y: -right.y };

    const torsoRaw = len(sub(hmRaw, sm));
    // Side-on poses shrink the shoulder width; keep a sensible minimum relative to the torso.
    if (hipW > 0.5) sw = Math.max(sw, 0.5 * torsoRaw);
    const torso = hipW > 0.5 ? torsoRaw : 1.32 * sw;

    const out = (side: 'R' | 'L', k: number): Vec2 => ({
      x: right.x * k * sw * (side === 'R' ? 1 : -1),
      y: right.y * k * sw * (side === 'R' ? 1 : -1),
    });

    const joints = {} as Record<JointName, Vec2>;
    joints['R.shoulder'] = rs;
    joints['L.shoulder'] = ls;
    for (const side of ['R', 'L'] as const) {
      const sh = joints[`${side}.shoulder`];
      const pick = (name: JointName, estimate: Vec2): Vec2 => {
        const i = J(name);
        return mix(raw[i], estimate, weight[i]);
      };
      // Each estimate is relative to the already-resolved parent joint.
      const hip = pick(`${side}.hip`, add(add(sm, down, torso), out(side, 0.31)));
      const knee = pick(`${side}.knee`, add(hip, down, 0.98 * torso));
      const ankle = pick(`${side}.ankle`, add(knee, down, 0.95 * torso));
      const elbow = pick(`${side}.elbow`, add(add(sh, down, 0.95 * sw), out(side, 0.12)));
      const forearm = norm(sub(elbow, sh));
      const wrist = pick(`${side}.wrist`, add(elbow, forearm, 0.86 * sw));
      joints[`${side}.hip`] = hip;
      joints[`${side}.knee`] = knee;
      joints[`${side}.ankle`] = ankle;
      joints[`${side}.elbow`] = elbow;
      joints[`${side}.wrist`] = wrist;
    }

    const seen = (a: PoseJoint, b: PoseJoint): boolean => weight[J(a)] > 0.6 && weight[J(b)] > 0.6;
    const nose = raw[J('nose')];
    return {
      skeleton: { joints, nose, scale: sw, down, right },
      regions: {
        hips: seen('R.hip', 'L.hip'),
        knees: seen('R.knee', 'L.knee'),
        ankles: seen('R.ankle', 'L.ankle'),
      },
      shoulderFrac: sw / w,
      headCut: sm.y - 1.0 * sw < 0,
    };
  }
}
