import { describe, expect, it } from 'vitest';
import { closeHoles, coverage, guidedFilter, inpaint, maskBounds, removePlainBackground, splitMask, type Rgba } from '../src/imaging.ts';

/** A white 100×120 "photo" with a coloured garment rectangle (and a white gap inside it). */
function photo(): Rgba {
  const w = 100;
  const h = 120;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const garment = x >= 20 && x < 80 && y >= 10 && y < 110;
      const gap = x >= 45 && x < 55 && y >= 60 && y < 100; // enclosed gap, e.g. between sleeve and body
      const [r, g, b] = garment && !gap ? [30, 140, 150] : [250, 250, 248];
      data[i] = r + ((x * 7 + y * 3) % 5); // a little noise
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

describe('removePlainBackground', () => {
  it('cuts out the garment and enclosed background gaps', () => {
    const img = photo();
    const a = removePlainBackground(img);
    const at = (x: number, y: number) => a[y * img.width + x];
    expect(at(5, 5)).toBe(0); // background
    expect(at(30, 50)).toBe(1); // garment
    expect(at(50, 80)).toBe(0); // enclosed white gap (between legs)
    expect(coverage(a)).toBeGreaterThan(0.4);
  });
});

describe('guidedFilter', () => {
  it('snaps a blurry mask to the image edge', () => {
    const img = photo();
    const w = img.width;
    const h = img.height;
    const hard = removePlainBackground(img);
    // Simulate a coarse segmentation: blur the hard mask.
    const blurry = new Float32Array(hard.length);
    for (let i = 0; i < hard.length; i++) {
      const x = i % w;
      blurry[i] = Math.min(1, Math.max(0, (x - 14) / 12)) * (x < 80 ? 1 : Math.max(0, 1 - (x - 80) / 12)) * (hard[i] > 0 || (i / w > 10 && i / w < 110) ? 1 : 0);
    }
    const lum = new Float32Array(w * h);
    for (let i = 0; i < lum.length; i++) lum[i] = img.data[i * 4 + 1] / 255;
    const refined = guidedFilter(lum, blurry, w, h, 4, 1e-4);
    const row = 50 * w;
    // Inside the edge the refined mask is higher than the blurry one; outside, lower.
    expect(refined[row + 22]).toBeGreaterThan(blurry[row + 22]);
    expect(refined[row + 17]).toBeLessThan(blurry[row + 17] + 1e-6);
  });
});

describe('closeHoles + inpaint', () => {
  it('fills a small hole and gives it the surrounding colour', () => {
    const img = photo();
    const w = img.width;
    const alpha = removePlainBackground(img);
    // Punch a 4×4 hole in the garment (e.g. hair over the shoulder).
    const unknownBefore: number[] = [];
    for (let y = 30; y < 34; y++)
      for (let x = 30; x < 34; x++) {
        alpha[y * w + x] = 0;
        unknownBefore.push(y * w + x);
        img.data[(y * w + x) * 4 + 1] = 0;
      }
    const { alpha: closed, added } = closeHoles(alpha, w, img.height, 3);
    expect(closed[31 * w + 31]).toBe(1);
    expect(added[31 * w + 31]).toBe(1);
    inpaint(img, added);
    expect(Math.abs(img.data[(31 * w + 31) * 4 + 1] - 140)).toBeLessThan(20);
  });
});

describe('splitMask and maskBounds', () => {
  it('keeps the requested part and finds its bounds', () => {
    const img = photo();
    const alpha = removePlainBackground(img);
    const top = splitMask(alpha, img.width, img.height, 60, 'above');
    const box = maskBounds(top, img.width, img.height, 0.05, 0)!;
    expect(box.y).toBe(10);
    expect(box.y + box.h).toBeLessThanOrEqual(61);
    expect(box.x).toBe(20);
    expect(box.w).toBe(60);
  });
});
