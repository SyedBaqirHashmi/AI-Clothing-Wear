import { describe, expect, it } from 'vitest';
import { mannequin, type Skeleton } from '../src/rig.ts';
import { BOTTOM_BONES, SkinnedMesh, TOP_BONES } from '../src/skinning.ts';

const rest = mannequin();
const j = rest.joints;
// Sample points in the garment image (mannequin pixels): chest, sleeve middle, forearm, kameez hem.
const chest = { x: 500, y: 330 };
const sleeve = { x: (j['R.shoulder'].x + j['R.elbow'].x) / 2, y: (j['R.shoulder'].y + j['R.elbow'].y) / 2 };
const forearm = { x: (j['R.elbow'].x + j['R.wrist'].x) / 2, y: (j['R.elbow'].y + j['R.wrist'].y) / 2 };
const hem = { x: 380, y: j['R.knee'].y };
// Kameez skirt pixel right next to the hanging wrist in the garment image.
const skirtByWrist = { x: 330, y: j['R.wrist'].y };
const pts = [chest, sleeve, forearm, hem, skirtByWrist];
const verts = new Float32Array(pts.flatMap((p) => [p.x, p.y]));

function pose(s: Skeleton, bones = TOP_BONES): { x: number; y: number }[] {
  const mesh = new SkinnedMesh(rest.joints, bones, verts);
  const out = new Float32Array(verts.length);
  mesh.apply(s, out);
  return pts.map((_, i) => ({ x: out[2 * i], y: out[2 * i + 1] }));
}

function clone(): Skeleton {
  return structuredClone(rest);
}

describe('SkinnedMesh', () => {
  it('leaves the garment unchanged in the rest pose', () => {
    const p = pose(rest);
    pts.forEach((q, i) => {
      expect(p[i].x).toBeCloseTo(q.x, 3);
      expect(p[i].y).toBeCloseTo(q.y, 3);
    });
  });

  it('follows a translated and scaled body exactly', () => {
    const s = clone();
    for (const k of Object.keys(s.joints) as (keyof typeof s.joints)[]) {
      s.joints[k] = { x: s.joints[k].x * 0.5 + 100, y: s.joints[k].y * 0.5 + 40 };
    }
    s.scale *= 0.5;
    const p = pose(s);
    pts.forEach((q, i) => {
      expect(p[i].x).toBeCloseTo(q.x * 0.5 + 100, 2);
      expect(p[i].y).toBeCloseTo(q.y * 0.5 + 40, 2);
    });
  });

  it('lifts the sleeve with a raised arm without dragging the chest', () => {
    const s = clone();
    const sh = s.joints['R.shoulder'];
    s.joints['R.elbow'] = { x: sh.x - 294, y: sh.y };
    s.joints['R.wrist'] = { x: sh.x - 552, y: sh.y };
    const p = pose(s);
    expect(p[1].y).toBeLessThan(sh.y + 30); // sleeve now level with the shoulder
    expect(p[2].y).toBeLessThan(sh.y + 30);
    expect(p[2].x).toBeLessThan(sh.x - 300);
    expect(Math.hypot(p[0].x - chest.x, p[0].y - chest.y)).toBeLessThan(3); // chest stays put
    expect(Math.hypot(p[4].x - skirtByWrist.x, p[4].y - skirtByWrist.y)).toBeLessThan(2); // skirt isn't dragged
  });

  it('keeps a kameez hem hanging when the legs spread, but moves trousers', () => {
    const s = clone();
    s.joints['R.knee'] = { x: j['R.knee'].x - 200, y: j['R.knee'].y - 60 };
    s.joints['R.ankle'] = { x: j['R.ankle'].x - 380, y: j['R.ankle'].y - 120 };
    const top = pose(s, TOP_BONES);
    expect(Math.hypot(top[3].x - hem.x, top[3].y - hem.y)).toBeLessThan(2);
    const bottom = pose(s, BOTTOM_BONES);
    expect(bottom[3].x).toBeLessThan(hem.x - 100);
  });
});

describe('SkinnedMesh with arms close to the body (model photo)', () => {
  it('still lets the sleeve follow a raised arm', () => {
    const photo = mannequin();
    const pj = photo.joints;
    // Arms hanging nearly straight down, close to the torso.
    pj['R.elbow'] = { x: pj['R.shoulder'].x - 15, y: pj['R.shoulder'].y + 290 };
    pj['R.wrist'] = { x: pj['R.elbow'].x - 5, y: pj['R.elbow'].y + 255 };
    const sleevePx = { x: (pj['R.shoulder'].x + pj['R.elbow'].x) / 2, y: (pj['R.shoulder'].y + pj['R.elbow'].y) / 2 };
    const mesh = new SkinnedMesh(pj, TOP_BONES, new Float32Array([sleevePx.x, sleevePx.y]));
    const s = structuredClone(photo);
    const sh = s.joints['R.shoulder'];
    s.joints['R.elbow'] = { x: sh.x - 290, y: sh.y };
    s.joints['R.wrist'] = { x: sh.x - 545, y: sh.y };
    const out = new Float32Array(2);
    mesh.apply(s, out);
    expect(out[1]).toBeLessThan(sh.y + 40); // lifted to shoulder height
    expect(out[0]).toBeLessThan(sh.x - 100);
  });
});
