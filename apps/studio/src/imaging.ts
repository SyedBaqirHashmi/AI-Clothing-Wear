/**
 * Image processing for garment cut-outs. Pure functions on typed arrays (unit-tested).
 *
 * Images are RGBA Uint8ClampedArray (like ImageData.data); masks are Float32Array in 0..1,
 * one value per pixel, row-major.
 */

export interface Rgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Sum-of-box filter via integral image: mean over a (2r+1)² window, clamped at the borders. */
export function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum =
        integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      out[y * w + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

export function luminance(img: Rgba): Float32Array {
  const n = img.width * img.height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = (0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2]) / 255;
  }
  return out;
}

/**
 * Guided filter (He, Sun & Tang): snaps a coarse mask to the edges of the guide image.
 * Used to sharpen the low-resolution segmentation mask along the real garment outline.
 */
export function guidedFilter(guide: Float32Array, mask: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h;
  const ip = new Float32Array(n);
  const ii = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    ip[i] = guide[i] * mask[i];
    ii[i] = guide[i] * guide[i];
  }
  const mI = boxMean(guide, w, h, r);
  const mP = boxMean(mask, w, h, r);
  const mIP = boxMean(ip, w, h, r);
  const mII = boxMean(ii, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = mII[i] - mI[i] * mI[i];
    const cov = mIP[i] - mI[i] * mP[i];
    a[i] = cov / (varI + eps);
    b[i] = mP[i] - a[i] * mI[i];
  }
  const mA = boxMean(a, w, h, r);
  const mB = boxMean(b, w, h, r);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(1, Math.max(0, mA[i] * guide[i] + mB[i]));
  return out;
}

/** Contrast curve: values below lo → 0, above hi → 1, smooth in between. */
export function levels(mask: Float32Array, lo: number, hi: number): Float32Array {
  const out = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    const t = Math.min(1, Math.max(0, (mask[i] - lo) / (hi - lo)));
    out[i] = t * t * (3 - 2 * t);
  }
  return out;
}

/**
 * Plain-background removal (flat-lay, ghost mannequin, studio backdrop).
 * The background colour is the median of the border pixels; background = pixels close to it
 * that are connected to the border, plus large enclosed patches of the same colour
 * (e.g. the gap between a sleeve and the body). Returns a soft alpha mask.
 */
export function removePlainBackground(img: Rgba, tolerance?: number): Float32Array {
  const { data, width: w, height: h } = img;
  const border: number[][] = [[], [], []];
  const pushBorder = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) border[c].push(data[i + c]);
  };
  for (let x = 0; x < w; x++) {
    pushBorder(x, 0);
    pushBorder(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    pushBorder(0, y);
    pushBorder(w - 1, y);
  }
  const median = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];
  const bg = border.map(median);
  const dist = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const dr = data[i * 4] - bg[0];
    const dg = data[i * 4 + 1] - bg[1];
    const db = data[i * 4 + 2] - bg[2];
    dist[i] = Math.sqrt(dr * dr + dg * dg + db * db);
  }
  // Tolerance from border noise (robust spread), at least 18.
  const borderDist = border[0].map((_, k) => Math.hypot(border[0][k] - bg[0], border[1][k] - bg[1], border[2][k] - bg[2]));
  const tol = tolerance ?? Math.max(18, median(borderDist) * 3 + 10);

  // Flood fill from the border.
  const isBg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const seed = (i: number) => {
    if (!isBg[i] && dist[i] < tol) {
      isBg[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < w * (h - 1)) seed(i + w);
  }
  // Enclosed background patches: same colour, not tiny.
  const minArea = Math.max(64, Math.round(w * h * 0.002));
  const seen = new Uint8Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (isBg[start] || seen[start] || dist[start] >= tol * 0.6) continue;
    head = 0;
    tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1]) {
        if (j >= 0 && !seen[j] && !isBg[j] && dist[j] < tol * 0.6) {
          seen[j] = 1;
          queue[tail++] = j;
        }
      }
    }
    if (tail >= minArea) for (let k = 0; k < tail; k++) isBg[queue[k]] = 1;
  }
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = isBg[i] ? 0 : 1;
  return alpha;
}

/** Binary morphology on a thresholded mask. */
function dilate(bin: Uint8Array, w: number, h: number, r: number): Uint8Array {
  // Separable square dilation.
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -Infinity;
    for (let x = 0; x < w; x++) {
      if (bin[y * w + x]) last = x;
      tmp[y * w + x] = x - last <= r ? 1 : 0;
    }
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (bin[y * w + x]) last = x;
      if (last - x <= r) tmp[y * w + x] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) last = y;
      out[y * w + x] = y - last <= r ? 1 : 0;
    }
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) last = y;
      if (last - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}

function erode(bin: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = bin[i] ? 0 : 1;
  const d = dilate(inv, w, h, r);
  for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1;
  return d;
}

/**
 * Close small holes and notches (hair over the shoulder, fingers on the kameez) and return
 * the pixels that were added, so their colour can be filled in.
 */
export function closeHoles(alpha: Float32Array, w: number, h: number, r: number): { alpha: Float32Array; added: Uint8Array } {
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < bin.length; i++) bin[i] = alpha[i] > 0.5 ? 1 : 0;
  const closed = erode(dilate(bin, w, h, r), w, h, r);
  const out = Float32Array.from(alpha);
  const added = new Uint8Array(w * h);
  for (let i = 0; i < bin.length; i++) {
    if (closed[i] && !bin[i]) {
      added[i] = 1;
      out[i] = 1;
    }
  }
  return { alpha: out, added };
}

/**
 * Fill colours of `unknown` pixels from nearby `known` pixels (push-pull pyramid).
 * Pass the garment as `known`, so holes get fabric colour, not skin or background.
 * Good enough for small occluded patches of fabric.
 */
export function inpaint(img: Rgba, unknown: Uint8Array, known?: Uint8Array): void {
  const { width: w, height: h, data } = img;
  type Level = { w: number; h: number; c: Float32Array; wt: Float32Array };
  const base: Level = { w, h, c: new Float32Array(w * h * 3), wt: new Float32Array(w * h) };
  for (let i = 0; i < w * h; i++) {
    if (unknown[i] || (known && !known[i])) continue;
    base.wt[i] = 1;
    for (let k = 0; k < 3; k++) base.c[i * 3 + k] = data[i * 4 + k];
  }
  const levels: Level[] = [base];
  while (levels.at(-1)!.w > 1 || levels.at(-1)!.h > 1) {
    const p = levels.at(-1)!;
    const nw = Math.max(1, Math.ceil(p.w / 2));
    const nh = Math.max(1, Math.ceil(p.h / 2));
    const n: Level = { w: nw, h: nh, c: new Float32Array(nw * nh * 3), wt: new Float32Array(nw * nh) };
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const s = y * p.w + x;
        const d = (y >> 1) * nw + (x >> 1);
        n.wt[d] += p.wt[s];
        for (let k = 0; k < 3; k++) n.c[d * 3 + k] += p.c[s * 3 + k];
      }
    }
    levels.push(n);
  }
  // Pull back down: a pixel without data takes its parent's average colour.
  for (let l = levels.length - 2; l >= 0; l--) {
    const p = levels[l];
    const parent = levels[l + 1];
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const s = y * p.w + x;
        if (p.wt[s] > 0) continue;
        const d = (y >> 1) * parent.w + (x >> 1);
        const pw = parent.wt[d] || 1;
        for (let k = 0; k < 3; k++) p.c[s * 3 + k] = parent.c[d * 3 + k] / pw;
        p.wt[s] = 1;
      }
    }
  }
  const holes: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!unknown[i]) continue;
    holes.push(i);
    // base.c holds the pulled-down average for pixels that had no data (wt set to 1 above).
    const wt = base.wt[i] || 1;
    for (let k = 0; k < 3; k++) data[i * 4 + k] = base.c[i * 3 + k] / wt;
  }
  // The pyramid gives blocky colours; relax them so each patch blends in from its border
  // (harmonic infill: every filled pixel becomes the average of its fabric / filled
  // neighbours; background or skin next to the garment never contributes).
  const usable = (j: number) => unknown[j] === 1 || !known || known[j] === 1;
  for (let iter = 0; iter < 80; iter++) {
    for (const i of holes) {
      const x = i % w;
      const n = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1].filter(
        (j) => j >= 0 && usable(j),
      );
      if (!n.length) continue;
      for (let k = 0; k < 3; k++) {
        let sum = 0;
        for (const j of n) sum += data[j * 4 + k];
        data[i * 4 + k] = sum / n.length;
      }
    }
  }
}

/** Keep only the part of the mask above or below a horizontal line (soft 1% edge). */
export function splitMask(alpha: Float32Array, w: number, h: number, lineY: number, keep: 'above' | 'below'): Float32Array {
  const soft = Math.max(1, h * 0.005);
  const out = new Float32Array(alpha.length);
  for (let y = 0; y < h; y++) {
    const t = Math.min(1, Math.max(0, (lineY - y) / soft + 0.5));
    const k = keep === 'above' ? t : 1 - t;
    for (let x = 0; x < w; x++) out[y * w + x] = alpha[y * w + x] * k;
  }
  return out;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding box of pixels with alpha above `threshold`, padded and clamped. */
export function maskBounds(alpha: Float32Array, w: number, h: number, threshold = 0.05, padFrac = 0.02): Box | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * padFrac);
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Fraction of the image covered by the mask. */
export function coverage(alpha: Float32Array): number {
  let s = 0;
  for (let i = 0; i < alpha.length; i++) s += alpha[i];
  return s / alpha.length;
}

/**
 * Keep the garment and drop stray fragments: other outfits shown beside the model, specks of
 * background. Keeps connected regions at least `minFraction` of the largest one (8-connected,
 * alpha > 0.5); everything else becomes transparent.
 */
export function keepMainRegions(alpha: Float32Array, w: number, h: number, minFraction = 0.08): Float32Array {
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || alpha[start] <= 0.5) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const j = ny * w + nx;
          if (label[j] === -1 && alpha[j] > 0.5) {
            label[j] = id;
            queue[tail++] = j;
          }
        }
      }
    }
    sizes.push(tail);
  }
  if (!sizes.length) return alpha;
  const keepMin = Math.max(...sizes) * minFraction;
  const keep = sizes.map((n) => n >= keepMin);
  // Soft edge pixels (alpha ≤ 0.5) follow their nearest labelled neighbour in the row.
  const out = new Float32Array(alpha.length);
  for (let y = 0; y < h; y++) {
    let lastKeep = false;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (label[i] >= 0) lastKeep = keep[label[i]];
      else if (alpha[i] > 0) {
        const right = x + 1 < w && label[i + 1] >= 0 ? keep[label[i + 1]] : false;
        const below = y + 1 < h && label[i + w] >= 0 ? keep[label[i + w]] : false;
        const above = y > 0 && label[i - w] >= 0 ? keep[label[i - w]] : false;
        if (!(lastKeep || right || below || above)) continue;
      }
      if (label[i] < 0 || keep[label[i]]) out[i] = alpha[i];
    }
  }
  return out;
}

/**
 * Fill holes completely enclosed by the garment (a hand resting on the kameez, a strand of
 * hair), whatever their size, up to `maxFraction` of the garment area so real see-through
 * gaps stay open. Returns the filled mask and the pixels that were added.
 */
export function fillEnclosedHoles(alpha: Float32Array, w: number, h: number, maxFraction = 0.04): { alpha: Float32Array; added: Uint8Array } {
  const outside = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const seed = (i: number) => {
    if (!outside[i] && alpha[i] <= 0.5) {
      outside[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < w * (h - 1)) seed(i + w);
  }
  let garment = 0;
  for (let i = 0; i < w * h; i++) if (alpha[i] > 0.5) garment++;
  const maxHole = garment * maxFraction;
  const out = Float32Array.from(alpha);
  const added = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (outside[start] || seen[start] || alpha[start] > 0.5) continue;
    head = 0;
    tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1]) {
        if (j >= 0 && !seen[j] && !outside[j] && alpha[j] <= 0.5) {
          seen[j] = 1;
          queue[tail++] = j;
        }
      }
    }
    if (tail > maxHole) continue;
    for (let k = 0; k < tail; k++) {
      out[queue[k]] = 1;
      added[queue[k]] = 1;
    }
  }
  return { alpha: out, added };
}
