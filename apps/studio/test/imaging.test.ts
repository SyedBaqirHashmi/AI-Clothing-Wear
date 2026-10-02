import { describe, expect, it } from 'vitest';
import { closeHoles, coverage, fillEnclosedHoles, guidedFilter, inpaint, keepMainRegions, maskBounds, removePlainBackground, splitMask, type Rgba } from '../src/imaging.ts';

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
    // Only garment pixels may lend colour (not the white background next to the garment).
    const fabric = new Uint8Array(alpha.length);
    for (let i = 0; i < fabric.length; i++) fabric[i] = alpha[i] > 0.5 ? 1 : 0;
    inpaint(img, added, fabric);
    expect(Math.abs(img.data[(31 * w + 31) * 4 + 1] - 140)).toBeLessThan(20);
  });

  it('never fills a hole at the garment edge with background colour', () => {
    const img = photo();
    const w = img.width;
    const alpha = removePlainBackground(img);
    // Notch at the left edge of the garment (x 20..24), as a hand would leave.
    for (let y = 40; y < 46; y++) for (let x = 20; x < 25; x++) alpha[y * w + x] = 0;
    const { added } = closeHoles(alpha, w, img.height, 4);
    const fabric = new Uint8Array(alpha.length);
    for (let i = 0; i < fabric.length; i++) fabric[i] = alpha[i] > 0.5 ? 1 : 0;
    inpaint(img, added, fabric);
    for (let i = 0; i < added.length; i++) if (added[i]) expect(img.data[i * 4 + 1]).toBeLessThan(200); // not white
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

describe('keepMainRegions', () => {
  it('drops small separate fragments and keeps the garment', () => {
    const w = 60;
    const h = 60;
    const a = new Float32Array(w * h);
    for (let y = 10; y < 50; y++) for (let x = 10; x < 40; x++) a[y * w + x] = 1; // garment
    for (let y = 5; y < 8; y++) for (let x = 50; x < 53; x++) a[y * w + x] = 1; // speck
    const out = keepMainRegions(a, w, h);
    expect(out[30 * w + 20]).toBe(1);
    expect(out[6 * w + 51]).toBe(0);
  });
});

describe('fillEnclosedHoles', () => {
  it('fills a large enclosed hole (a hand) but not a big see-through gap', () => {
    const w = 100;
    const h = 100;
    const a = new Float32Array(w * h);
    for (let y = 5; y < 95; y++) for (let x = 5; x < 95; x++) a[y * w + x] = 1;
    for (let y = 20; y < 30; y++) for (let x = 20; x < 30; x++) a[y * w + x] = 0; // hand: 100 px
    for (let y = 40; y < 90; y++) for (let x = 40; x < 90; x++) a[y * w + x] = 0; // gap: 2500 px
    const { alpha, added } = fillEnclosedHoles(a, w, h, 0.04);
    expect(alpha[25 * w + 25]).toBe(1);
    expect(added[25 * w + 25]).toBe(1);
    expect(alpha[60 * w + 60]).toBe(0);
  });
});
