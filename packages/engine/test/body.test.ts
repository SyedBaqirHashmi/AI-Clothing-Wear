import { describe, expect, it } from 'vitest';
import { BodyModel } from '../src/body.ts';
import { JOINT_ORDER } from '../src/pose/backend.ts';
import { mannequin } from '../src/rig.ts';

const W = 1280;
const H = 720;

/** Mannequin pose scaled into a 1280×720 frame, as a backend would report it (normalised). */
function pose(dx = 0, hide: string[] = []): Float32Array {
  const m = mannequin();
  const k = 0.42; // mannequin px → frame px
  const out = new Float32Array(JOINT_ORDER.length * 3);
  JOINT_ORDER.forEach((name, j) => {
    const p = name === 'nose' ? m.nose : m.joints[name as keyof typeof m.joints];
    out[j * 3] = (p.x * k + 430 + dx) / W;
    out[j * 3 + 1] = (p.y * k + 20) / H;
    out[j * 3 + 2] = hide.includes(name) ? 0.05 : 0.98;
  });
  return out;
}

describe('BodyModel', () => {
  it('returns null until it sees shoulders', () => {
    const b = new BodyModel();
    expect(b.state(0, W, H)).toBeNull();
    b.update(pose(0, ['L.shoulder', 'R.shoulder']), 0, W, H);
    expect(b.state(0, W, H)).toBeNull();
  });

  it('reproduces a clean pose and reports visible regions', () => {
    const b = new BodyModel();
    b.update(pose(), 0, W, H);
    const s = b.state(0, W, H)!;
    expect(s.skeleton.joints['R.shoulder'].x).toBeCloseTo(0.42 * 350 + 430, 0);
    expect(s.skeleton.scale).toBeCloseTo(0.42 * 300, 0);
    expect(s.skeleton.down.y).toBeGreaterThan(0.99);
    expect(s.skeleton.right.x).toBeLessThan(-0.99); // wearer's right is image-left
    expect(s.regions).toEqual({ hips: true, knees: true, ankles: true });
  });

  it('estimates hidden knees and ankles below the hips', () => {
    const b = new BodyModel();
    b.update(pose(0, ['L.knee', 'R.knee', 'L.ankle', 'R.ankle']), 0, W, H);
    const s = b.state(0, W, H)!;
    expect(s.regions.knees).toBe(false);
    const hip = s.skeleton.joints['R.hip'];
    const knee = s.skeleton.joints['R.knee'];
    const ankle = s.skeleton.joints['R.ankle'];
    expect(knee.y).toBeGreaterThan(hip.y + 0.8 * s.skeleton.scale);
    expect(ankle.y).toBeGreaterThan(knee.y + 0.8 * s.skeleton.scale);
  });

  it('predicts forward along the motion', () => {
    const b = new BodyModel();
    for (let i = 0; i <= 15; i++) b.update(pose(i * 4), i * 33.3, W, H); // 120 px/s to the right
    const now = b.state(15 * 33.3, W, H)!.skeleton.joints['R.shoulder'].x;
    const ahead = b.state(15 * 33.3 + 60, W, H)!.skeleton.joints['R.shoulder'].x;
    expect(ahead).toBeGreaterThan(now + 2);
  });
});
