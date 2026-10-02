import type { Vec2 } from './types.ts';

export type Side = 'R' | 'L';
export type Joint = 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle';
export type JointName = `${Side}.${Joint}`;

/**
 * Backend-independent body pose, in camera space (not mirrored), pixels.
 * "R" is the wearer's right side, which appears on the image left when facing the camera —
 * the same convention as a front-facing product photo, so no reflection is ever needed.
 */
export interface Skeleton {
  joints: Record<JointName, Vec2>;
  nose: Vec2;
  /** Shoulder width (distance between shoulder joints), px. All anchor offsets use this unit. */
  scale: number;
  /** Unit vector from shoulder centre towards hip centre. */
  down: Vec2;
  /** Unit vector pointing towards the wearer's right side. */
  right: Vec2;
}

const add = (a: Vec2, b: Vec2, k = 1): Vec2 => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const mid = (a: Vec2, b: Vec2): Vec2 => lerp(a, b, 0.5);

/** Centre-line anchors, expressed via joints. */
function centreAnchor(name: string, s: Skeleton): Vec2 | null {
  const sm = mid(s.joints['R.shoulder'], s.joints['L.shoulder']);
  const hm = mid(s.joints['R.hip'], s.joints['L.hip']);
  switch (name) {
    case 'neck': // base of the neck at collar height
      return add(sm, s.down, -0.12 * s.scale);
    case 'shoulderMid':
      return sm;
    case 'chest':
      return lerp(sm, hm, 0.3);
    case 'navel':
      return lerp(sm, hm, 0.78);
    case 'hipMid':
      return hm;
    case 'crotch':
      return add(hm, s.down, 0.2 * s.scale);
    default:
      return null;
  }
}

interface Term {
  point: Vec2;
  side: Side | null;
  /** Segment direction, when the base was an A>B@t interpolation. */
  segment: Vec2 | null;
}

function resolveTerm(token: string, s: Skeleton): Term {
  const at = token.indexOf('>');
  if (at >= 0) {
    const [a, rest] = [token.slice(0, at), token.slice(at + 1)];
    const [b, tStr] = rest.split('@');
    const pa = resolveTerm(a, s).point;
    const pb = resolveTerm(b, s).point;
    const t = tStr === undefined ? 0.5 : Number(tStr);
    if (!Number.isFinite(t)) throw new Error(`Bad interpolation in anchor "${token}"`);
    const side = (a[1] === '.' ? a[0] : null) as Side | null;
    return { point: lerp(pa, pb, t), side, segment: { x: pb.x - pa.x, y: pb.y - pa.y } };
  }
  if (token in s.joints) {
    return { point: s.joints[token as JointName], side: token[0] as Side, segment: null };
  }
  const c = centreAnchor(token, s);
  if (c) return { point: c, side: null, segment: null };
  throw new Error(`Unknown anchor "${token}"`);
}

/**
 * Resolve an anchor expression on a skeleton.
 *
 * Grammar (space separated):  BASE [MODIFIER ...]
 *   BASE      joint ("R.elbow"), centre anchor ("neck", "chest", "navel", "hipMid", "crotch",
 *             "shoulderMid") or interpolation "A>B@t" (t may be < 0 or > 1 to extrapolate)
 *   out:k     move k shoulder-widths away from the body centre (towards the base's side)
 *   n:k       move k shoulder-widths along the segment normal, outward side positive
 *             (for A>B@t bases; follows a limb when it rotates, e.g. sleeve edges)
 *   x:k       move k shoulder-widths towards the wearer's right
 *   y:k       move k shoulder-widths down the body
 */
export function resolveAnchor(expr: string, s: Skeleton): Vec2 {
  const tokens = expr.trim().split(/\s+/);
  const term = resolveTerm(tokens[0], s);
  let p = term.point;
  const sideSign = term.side === 'L' ? -1 : 1;
  for (const mod of tokens.slice(1)) {
    const [key, val] = mod.split(':');
    const k = Number(val) * s.scale;
    if (!Number.isFinite(k)) throw new Error(`Bad modifier "${mod}" in anchor "${expr}"`);
    switch (key) {
      case 'out':
        if (!term.side) throw new Error(`"out:" needs a sided anchor in "${expr}"`);
        p = add(p, s.right, k * sideSign);
        break;
      case 'n': {
        if (!term.segment || !term.side) {
          p = add(p, s.right, k * sideSign);
          break;
        }
        const len = Math.hypot(term.segment.x, term.segment.y) || 1;
        const d = { x: term.segment.x / len, y: term.segment.y / len };
        // Perpendicular, oriented so that a limb hanging straight down points outward.
        let n = { x: -d.y, y: d.x };
        const restOut = { x: s.right.x * sideSign, y: s.right.y * sideSign };
        const restN = { x: -s.down.y, y: s.down.x };
        if (restN.x * restOut.x + restN.y * restOut.y < 0) n = { x: -n.x, y: -n.y };
        p = add(p, n, k);
        break;
      }
      case 'x':
        p = add(p, s.right, k);
        break;
      case 'y':
        p = add(p, s.down, k);
        break;
      default:
        throw new Error(`Unknown modifier "${mod}" in anchor "${expr}"`);
    }
  }
  return p;
}

/**
 * The reference body used to author garment images ("mannequin"), in garment-image pixels.
 * Arms slightly out (A-pose), as in most product photos. Image is 1000 px wide.
 */
export function mannequin(): Skeleton {
  const sw = 300;
  const cx = 500;
  const shY = 230;
  const torso = 1.32 * sw; // shoulder → hip
  const hipHalf = 0.31 * sw; // hip joints are inside the body
  const deg = Math.PI / 180;
  const arm = (side: Side, from: Vec2, len: number, angleDeg: number): Vec2 => {
    const sign = side === 'R' ? -1 : 1; // R is image-left
    return { x: from.x + sign * Math.sin(angleDeg * deg) * len, y: from.y + Math.cos(angleDeg * deg) * len };
  };
  const R_sh = { x: cx - sw / 2, y: shY };
  const L_sh = { x: cx + sw / 2, y: shY };
  const R_el = arm('R', R_sh, 0.98 * sw, 16);
  const L_el = arm('L', L_sh, 0.98 * sw, 16);
  const R_hip = { x: cx - hipHalf, y: shY + torso };
  const L_hip = { x: cx + hipHalf, y: shY + torso };
  const leg = 1.3 * sw;
  const R_kn = { x: R_hip.x - 0.04 * sw, y: R_hip.y + leg };
  const L_kn = { x: L_hip.x + 0.04 * sw, y: L_hip.y + leg };
  return {
    joints: {
      'R.shoulder': R_sh,
      'L.shoulder': L_sh,
      'R.elbow': R_el,
      'L.elbow': L_el,
      'R.wrist': arm('R', R_el, 0.86 * sw, 12),
      'L.wrist': arm('L', L_el, 0.86 * sw, 12),
      'R.hip': R_hip,
      'L.hip': L_hip,
      'R.knee': R_kn,
      'L.knee': L_kn,
      'R.ankle': { x: R_kn.x - 0.02 * sw, y: R_kn.y + 1.25 * sw },
      'L.ankle': { x: L_kn.x + 0.02 * sw, y: L_kn.y + 1.25 * sw },
    },
    nose: { x: cx, y: shY - 0.75 * sw },
    scale: sw,
    down: { x: 0, y: 1 },
    right: { x: -1, y: 0 },
  };
}
