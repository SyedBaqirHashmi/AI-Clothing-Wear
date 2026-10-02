import { describe, expect, it } from 'vitest';
import { OneEuroFilter } from '../src/one-euro.ts';

const params = { minCutoff: 1.0, beta: 4.0, dCutoff: 1.0 };

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296 - 0.5;
  };
}

describe('OneEuroFilter', () => {
  // N-05: jitter < 1% of shoulder width. A person filling the frame has shoulders ≈ 0.17 frame
  // heights wide; the noise here (±0.5% of frame height) is worse than MediaPipe's typical jitter.
  it('keeps a still, noisy signal within the N-05 jitter budget', () => {
    const f = new OneEuroFilter(params);
    const noise = rng(1);
    const out: number[] = [];
    for (let i = 0; i < 300; i++) out.push(f.filter(0.5 + noise() * 0.01, i / 30));
    const tail = out.slice(100);
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    const std = Math.sqrt(tail.reduce((a, b) => a + (b - mean) ** 2, 0) / tail.length);
    const rawStd = 0.01 / Math.sqrt(12);
    expect(std).toBeLessThan(rawStd / 3);
    expect(std).toBeLessThan(0.01 * 0.17);
  });

  it('keeps lag small during fast movement and estimates velocity', () => {
    const f = new OneEuroFilter(params);
    let y = 0;
    for (let i = 0; i <= 30; i++) y = f.filter(i / 30, i / 30); // 1 unit per second
    expect(1 - y).toBeLessThan(0.08);
    expect(f.velocity).toBeGreaterThan(0.7);
  });
});
