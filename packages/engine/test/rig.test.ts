import { describe, expect, it } from 'vitest';
import { mannequin, resolveAnchor } from '../src/rig.ts';

const s = mannequin();
const at = (e: string) => resolveAnchor(e, s);

describe('resolveAnchor', () => {
  it('resolves joints and interpolations', () => {
    expect(at('R.shoulder')).toEqual(s.joints['R.shoulder']);
    const m = at('R.shoulder>R.elbow@0.5');
    expect(m.x).toBeCloseTo((s.joints['R.shoulder'].x + s.joints['R.elbow'].x) / 2);
    expect(m.y).toBeCloseTo((s.joints['R.shoulder'].y + s.joints['R.elbow'].y) / 2);
  });

  it('pushes "out" away from the body centre on each side', () => {
    // Wearer's right is image-left on the mannequin.
    expect(at('R.hip out:0.2').x).toBeLessThan(s.joints['R.hip'].x);
    expect(at('L.hip out:0.2').x).toBeGreaterThan(s.joints['L.hip'].x);
  });

  it('is mirror-symmetric on the symmetric mannequin', () => {
    const cx = 500;
    for (const [r, l] of [
      ['R.elbow>R.wrist@0.5 n:0.1', 'L.elbow>L.wrist@0.5 n:0.1'],
      ['chest x:0.4', 'chest x:-0.4'],
      ['R.knee>L.knee@0.2 y:0.1', 'L.knee>R.knee@0.2 y:0.1'],
    ]) {
      const a = at(r);
      const b = at(l);
      expect(a.x - cx).toBeCloseTo(cx - b.x, 3);
      expect(a.y).toBeCloseTo(b.y, 3);
    }
  });

  it('orients limb normals outward and follows a raised arm', () => {
    expect(at('R.shoulder>R.elbow@0.5 n:0.1').x).toBeLessThan(at('R.shoulder>R.elbow@0.5').x);
    const raised = mannequin();
    raised.joints['R.elbow'] = { x: raised.joints['R.shoulder'].x - 300, y: raised.joints['R.shoulder'].y };
    const p = resolveAnchor('R.shoulder>R.elbow@0.5 n:0.1', raised);
    expect(p.y).toBeLessThan(raised.joints['R.shoulder'].y); // outer edge is now on top
  });

  it('rejects unknown anchors and modifiers', () => {
    expect(() => at('R.toe')).toThrow();
    expect(() => at('neck out:0.1')).toThrow();
    expect(() => at('neck z:1')).toThrow();
  });
});
