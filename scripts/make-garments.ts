/**
 * Generates the Phase 1 sample garments (SVG artwork + rig) and the demo catalog.
 *
 * Every outline point is an anchor expression evaluated on the reference mannequin, and the
 * mannequin's joints become the garment's skeleton, so artwork and skeleton match by
 * construction. Real store garments (photos) get their joints marked in the Phase 2 rig editor.
 *
 *   npm run garments
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mannequin, resolveAnchor, type JointName } from '../packages/engine/src/rig.ts';
import type { Coverage, GarmentLayerSpec, Slot, Vec2 } from '../packages/engine/src/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'apps/widget/public/garments');
const catalogPath = join(root, 'apps/widget/public/catalog/demo.json');
const S = mannequin();
const SW = S.scale;
const at = (e: string): Vec2 => resolveAnchor(e, S);

// ---------------------------------------------------------------------------------------------
// Anchor helpers

/** Mirror an anchor expression to the other side of the body. */
function mirror(expr: string): string {
  return expr
    .replace(/\b([RL])\./g, (_, s) => (s === 'R' ? 'L.' : 'R.'))
    .replace(/\bx:(-?[\d.]+)/g, (_, k) => `x:${-Number(k)}`);
}

/** Outline point; prefix "!" marks a sharp corner. */
type P = string;
const isCorner = (p: P) => p.startsWith('!');
const expr = (p: P) => (isCorner(p) ? p.slice(1) : p);

/** Build a closed outline from the wearer's-right half (centre → … → centre). */
function symmetric(half: P[]): P[] {
  const other = half.map((p) => (isCorner(p) ? '!' : '') + mirror(expr(p))).reverse();
  const out = [...half];
  const same = (a: P, b: P) => {
    const pa = at(expr(a));
    const pb = at(expr(b));
    return Math.hypot(pa.x - pb.x, pa.y - pb.y) < 0.5;
  };
  for (const p of other) if (!out.some((q) => same(q, p))) out.push(p);
  return out;
}

// ---------------------------------------------------------------------------------------------
// SVG helpers

function smoothPath(points: Vec2[], corners: boolean[], closed = true): string {
  const n = points.length;
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(points[0].x)},${f(points[0].y)}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const t = 1 / 6;
    const c1 = corners[i] || (!closed && i === 0) ? p1 : { x: p1.x + (p2.x - p0.x) * t, y: p1.y + (p2.y - p0.y) * t };
    const c2 = corners[(i + 1) % n] || (!closed && i === n - 2) ? p2 : { x: p2.x - (p3.x - p1.x) * t, y: p2.y - (p3.y - p1.y) * t };
    d += ` C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(p2.x)},${f(p2.y)}`;
  }
  return closed ? d + 'Z' : d;
}

function polyline(exprs: string[]): string {
  const pts = exprs.map(at);
  return smoothPath(pts, pts.map(() => false), false);
}

interface Trim {
  path: string[];
  /** Also draw the mirrored polyline. */
  sym?: boolean;
  color: string;
  /** Stroke width in shoulder widths. */
  width: number;
  dash?: string;
  opacity?: number;
}

interface Print {
  kind: 'floral' | 'motif' | 'none';
  colors: string[];
  scale?: number;
  opacity?: number;
}

interface LayerDef {
  id: string;
  slot: Slot;
  coverage: Coverage;
  half: P[];
  fill: string;
  print?: Print;
  trims?: Trim[];
  /** Fold lines (anchor polylines), drawn soft and dark. */
  folds?: string[][];
  opacity?: number;
}

function printPattern(p: Print, id: string): string {
  const s = (p.scale ?? 1) * 70;
  const [a, b, c] = p.colors;
  if (p.kind === 'floral') {
    const petals = (cx: number, cy: number, r: number, col: string) =>
      [0, 72, 144, 216, 288]
        .map((deg) => `<ellipse cx="${cx}" cy="${cy - r}" rx="${r * 0.45}" ry="${r * 0.8}" fill="${col}" transform="rotate(${deg} ${cx} ${cy})"/>`)
        .join('');
    return `<pattern id="${id}" width="${s}" height="${s}" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
      <g opacity="${p.opacity ?? 0.85}">
      ${petals(s * 0.25, s * 0.3, s * 0.11, a)}<circle cx="${s * 0.25}" cy="${s * 0.3}" r="${s * 0.05}" fill="${c}"/>
      ${petals(s * 0.75, s * 0.78, s * 0.08, b)}<circle cx="${s * 0.75}" cy="${s * 0.78}" r="${s * 0.035}" fill="${c}"/>
      <path d="M${s * 0.32},${s * 0.42} q${s * 0.12},${s * 0.12} ${s * 0.3},${s * 0.18}" stroke="${b}" stroke-width="${s * 0.025}" fill="none"/>
      <ellipse cx="${s * 0.58}" cy="${s * 0.5}" rx="${s * 0.05}" ry="${s * 0.02}" fill="${b}" transform="rotate(30 ${s * 0.58} ${s * 0.5})"/>
      </g></pattern>`;
  }
  if (p.kind === 'motif') {
    return `<pattern id="${id}" width="${s}" height="${s}" patternUnits="userSpaceOnUse">
      <g opacity="${p.opacity ?? 0.6}" fill="${a}">
      <circle cx="${s / 2}" cy="${s / 2}" r="${s * 0.05}"/><circle cx="0" cy="0" r="${s * 0.035}"/><circle cx="${s}" cy="0" r="${s * 0.035}"/>
      <circle cx="0" cy="${s}" r="${s * 0.035}"/><circle cx="${s}" cy="${s}" r="${s * 0.035}"/>
      </g></pattern>`;
  }
  return '';
}

function darker(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

function buildLayer(def: LayerDef): GarmentLayerSpec {
  const outline = symmetric(def.half);
  const pts = outline.map((p) => at(expr(p)));
  const corners = outline.map(isCorner);

  // Tight bounds (+ margin for stroke and folds).
  const margin = 0.06 * SW;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.floor(Math.min(...xs) - margin);
  const y0 = Math.floor(Math.min(...ys) - margin);
  const w = Math.ceil(Math.max(...xs) + margin) - x0;
  const h = Math.ceil(Math.max(...ys) + margin) - y0;

  const outlineD = smoothPath(pts, corners);
  const pid = `${def.id}-print`;
  const torsoL = at('chest x:0.6').x;
  const torsoR = at('chest x:-0.6').x;
  const trimSvg = (def.trims ?? [])
    .flatMap((t) => (t.sym ? [t.path, t.path.map(mirror)] : [t.path]).map((path) => ({ ...t, path })))
    .map(
      (t) =>
        `<path d="${polyline(t.path)}" fill="none" stroke="${t.color}" stroke-width="${(t.width * SW).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"${t.dash ? ` stroke-dasharray="${t.dash}"` : ''} opacity="${t.opacity ?? 1}"/>`,
    )
    .join('\n    ');
  const foldSvg = (def.folds ?? [])
    .flatMap((f) => [f, f.map(mirror)])
    .map((f) => `<path d="${polyline(f)}" fill="none" stroke="#000" stroke-width="${(0.05 * SW).toFixed(1)}" opacity="0.13" filter="url(#${def.id}-blur)"/>`)
    .join('\n    ');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x0} ${y0} ${w} ${h}">
  <defs>
    <clipPath id="${def.id}-clip"><path d="${outlineD}"/></clipPath>
    ${def.print && def.print.kind !== 'none' ? printPattern(def.print, pid) : ''}
    <linearGradient id="${def.id}-shade" gradientUnits="userSpaceOnUse" x1="${torsoL}" y1="0" x2="${torsoR}" y2="0">
      <stop offset="0" stop-color="#000" stop-opacity="0.28"/>
      <stop offset="0.22" stop-color="#000" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#fff" stop-opacity="0.06"/>
      <stop offset="0.78" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.28"/>
    </linearGradient>
    <filter id="${def.id}-blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${(0.03 * SW).toFixed(1)}"/></filter>
  </defs>
  <path d="${outlineD}" fill="${def.fill}"/>
  <g clip-path="url(#${def.id}-clip)">
    ${def.print && def.print.kind !== 'none' ? `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="url(#${pid})"/>` : ''}
    ${foldSvg}
    ${trimSvg}
    <rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="url(#${def.id}-shade)"/>
  </g>
  <path d="${outlineD}" fill="none" stroke="${darker(def.fill, 0.7)}" stroke-width="${(0.012 * SW).toFixed(1)}" opacity="0.7"/>
</svg>
`;
  writeFileSync(join(outDir, `${def.id}.svg`), svg);

  const joints: GarmentLayerSpec['joints'] = {};
  for (const [name, p] of Object.entries(S.joints)) {
    joints[name as JointName] = [+((p.x - x0) / w).toFixed(4), +((p.y - y0) / h).toFixed(4)];
  }
  return {
    id: def.id,
    slot: def.slot,
    image: `garments/${def.id}.svg`,
    size: [w, h],
    joints,
    coverage: def.coverage,
    ...(def.opacity !== undefined ? { opacity: def.opacity } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Garment shapes (wearer's right half, from centre to centre)

/** Sleeve outline from shoulder top, down the outside of the arm to `end`, back up the inside. */
function sleeve(end: { seg: 'upper' | 'fore'; t: number }, halfWidthEnd: number): P[] {
  const segExpr = (t: number, n: number) =>
    end.seg === 'upper' ? `R.shoulder>R.elbow@${t} n:${n}` : `R.elbow>R.wrist@${t} n:${n}`;
  const outer: P[] = ['R.shoulder>R.elbow@0.45 n:0.15'];
  const inner: P[] = [];
  if (end.seg === 'fore') {
    outer.push('R.shoulder>R.elbow@1 n:0.13');
    if (end.t > 0.5) outer.push('R.elbow>R.wrist@0.5 n:0.12');
  }
  outer.push(`!${segExpr(end.t, halfWidthEnd)}`);
  inner.push(`!${segExpr(end.t, -halfWidthEnd)}`);
  if (end.seg === 'fore') {
    if (end.t > 0.5) inner.push('R.elbow>R.wrist@0.5 n:-0.11');
    inner.push('R.shoulder>R.elbow@1 n:-0.11');
  }
  inner.push('R.shoulder>R.elbow@0.42 n:-0.13');
  return [...outer, ...inner];
}

interface TopOpts {
  neck: 'round' | 'v' | 'mandarin' | 'collar';
  sleeve: { seg: 'upper' | 'fore'; t: number };
  /** Body half-widths (shoulder widths) at chest / waist; hem flare outward from knee line. */
  chest: number;
  waist: number;
  hipOut: number;
  hemT: number;
  hemOut: number;
  /** Curved (shirt-tail) hem: sides shorter than centre by this much. */
  hemCurve: number;
}

function topHalf(o: TopOpts): P[] {
  const neckFront: Record<TopOpts['neck'], P[]> = {
    round: ['neck y:0.2', 'neck x:0.12 y:0.15', 'neck x:0.18 y:0.02'],
    v: ['!neck y:0.42', 'neck x:0.1 y:0.2', 'neck x:0.17 y:0.0'],
    mandarin: ['neck y:0.05', 'neck x:0.1 y:0.02', '!neck x:0.13 y:-0.07'],
    collar: ['!neck y:0.1', '!neck x:0.14 y:0.04', '!neck x:0.17 y:-0.08'],
  };
  const hemSide = `R.hip>R.knee@${o.hemT - o.hemCurve} out:${o.hemOut}`;
  return [
    ...neckFront[o.neck],
    'R.shoulder out:0.04 y:-0.07',
    ...sleeve(o.sleeve, o.sleeve.seg === 'upper' ? 0.14 : o.sleeve.t > 0.8 ? 0.085 : 0.11),
    `chest x:${o.chest}`,
    `navel x:${o.waist}`,
    `R.hip out:${o.hipOut}`,
    `!${hemSide}`,
    `R.knee>L.knee@0.2 y:${(o.hemT - 1) * 1.3 + 0.04}`,
    `R.knee>L.knee@0.5 y:${(o.hemT - 1) * 1.3 + 0.06}`,
  ];
}


function shalwarHalf(width: number): P[] {
  return [
    'navel y:0.02',
    `!R.shoulder>R.hip@0.78 out:${0.15 + width * 0.3}`,
    `R.hip out:${0.2 + width * 0.2}`,
    `R.hip>R.knee@0.5 out:${0.18 + width * 0.35}`,
    `R.knee out:${0.15 + width * 0.35}`,
    `R.knee>R.ankle@0.7 out:${0.12 + width * 0.25}`,
    '!R.ankle out:0.1 y:0.06',
    '!R.ankle out:-0.1 y:0.06',
    `R.knee>R.ankle@0.6 out:${-0.12 - width * 0.15}`,
    `R.knee out:${-0.13 - width * 0.15}`,
    `!crotch y:${0.1 + width * 0.35}`,
  ];
}

function dupattaHalf(): P[] {
  return [
    'neck y:-0.1',
    'R.shoulder x:0.02 y:-0.08',
    'R.shoulder out:0.09 y:0.06',
    'R.shoulder>R.hip@0.5 out:0.06',
    'R.hip out:0.04',
    '!R.hip>R.knee@0.75 out:0.03',
    '!R.hip>R.knee@0.75 out:-0.3',
    'R.hip out:-0.28',
    'R.shoulder>R.hip@0.4 out:-0.28',
    'neck x:0.15 y:0.08',
    'neck y:0.0',
  ];
}

// Trims ----------------------------------------------------------------------------------------
const neckTrim = (neck: TopOpts['neck'], color: string, width: number, dash?: string): Trim => ({
  path:
    neck === 'v'
      ? ['neck x:0.17 y:0.03', 'neck x:0.1 y:0.22', 'neck y:0.44']
      : ['neck x:0.18 y:0.05', 'neck x:0.12 y:0.18', 'neck y:0.23'],
  sym: true,
  color,
  width,
  dash,
});
const hemTrim = (hemT: number, out: number, curve: number, color: string, width: number, rise = 0.07, dash?: string): Trim => ({
  path: [
    `R.hip>R.knee@${hemT - curve} out:${out} y:${-rise}`,
    `R.knee>L.knee@0.2 y:${(hemT - 1) * 1.3 + 0.04 - rise}`,
    `R.knee>L.knee@0.5 y:${(hemT - 1) * 1.3 + 0.06 - rise}`,
  ],
  sym: true,
  color,
  width,
  dash,
});
const cuffTrim = (seg: 'upper' | 'fore', t: number, hw: number, color: string, width: number, dash?: string): Trim => {
  const base = seg === 'upper' ? 'R.shoulder>R.elbow' : 'R.elbow>R.wrist';
  return { path: [`${base}@${t - 0.06} n:${hw}`, `${base}@${t - 0.06} n:${-hw}`], sym: true, color, width, dash };
};
const placket = (color: string, buttons: string): Trim[] => [
  { path: ['neck x:0.035 y:0.02', 'chest x:0.035 y:0.12'], sym: true, color, width: 0.008 },
  { path: ['neck y:0.12', 'chest y:0.12'], color: buttons, width: 0.03, dash: `0.1 ${(0.12 * SW).toFixed(0)}` },
];
const armhole = (color: string): Trim => ({
  path: ['R.shoulder out:0.04 y:-0.06', 'R.shoulder>R.hip@0.16 out:0.02', `chest x:0.47`],
  sym: true,
  color,
  width: 0.006,
  opacity: 0.5,
});
const sideFolds: string[][] = [
  ['R.shoulder>R.hip@0.45 out:-0.12', 'R.hip out:0.02', 'R.hip>R.knee@0.8 out:0.1'],
  ['R.shoulder>R.elbow@0.7 n:0.02', 'R.shoulder>R.elbow@0.95 n:-0.03'],
];
const legFolds: string[][] = [
  ['R.hip>R.knee@0.6 out:0.05', 'R.knee out:0.02', 'R.knee>R.ankle@0.6 out:0.04'],
  ['R.knee>R.ankle@0.8 out:0.06', 'R.ankle out:0.0 y:0.03'],
];

// ---------------------------------------------------------------------------------------------
// The five Phase 1 outfits

const womenKameez = (sleeveT: TopOpts['sleeve']): TopOpts => ({
  neck: 'round',
  sleeve: sleeveT,
  chest: 0.45,
  waist: 0.38,
  hipOut: 0.2,
  hemT: 1.05,
  hemOut: 0.27,
  hemCurve: 0,
});
const menKurta: TopOpts = {
  neck: 'mandarin',
  sleeve: { seg: 'fore', t: 1.0 },
  chest: 0.5,
  waist: 0.48,
  hipOut: 0.24,
  hemT: 0.98,
  hemOut: 0.27,
  hemCurve: 0,
};

const GOLD = '#d9b25a';
const layers: Record<string, LayerDef> = {
  'firozi-kameez': {
    id: 'firozi-kameez',
    slot: 'top',
    coverage: 'knees',
    half: topHalf(womenKameez({ seg: 'fore', t: 0.55 })),
    fill: '#1e9e9a',
    print: { kind: 'floral', colors: ['#fdf6ec', '#f7a8b8', '#f5c84c'], scale: 1.1 },
    trims: [
      neckTrim('round', '#fdf6ec', 0.035),
      neckTrim('round', '#f5c84c', 0.012, '2 10'),
      hemTrim(1.05, 0.27, 0, '#fdf6ec', 0.09),
      hemTrim(1.05, 0.27, 0, '#1e9e9a', 0.02, 0.07, '14 10'),
      cuffTrim('fore', 0.55, 0.11, '#fdf6ec', 0.05),
      armhole('#0f5e5b'),
    ],
    folds: sideFolds,
  },
  'white-shalwar-w': {
    id: 'white-shalwar-w',
    slot: 'bottom',
    coverage: 'ankles',
    half: shalwarHalf(0.5),
    fill: '#f4f1ea',
    trims: [{ path: ['R.ankle out:0.1 y:-0.02', 'R.ankle out:-0.1 y:-0.02'], sym: true, color: '#1e9e9a', width: 0.025 }],
    folds: legFolds,
  },
  'firozi-dupatta': {
    id: 'firozi-dupatta',
    slot: 'drape',
    coverage: 'knees',
    half: dupattaHalf(),
    fill: '#f6b3c0',
    print: { kind: 'floral', colors: ['#ffffff', '#1e9e9a', '#f5c84c'], scale: 0.7, opacity: 0.7 },
    trims: [
      { path: ['R.hip>R.knee@0.71 out:0.03', 'R.hip>R.knee@0.71 out:-0.3'], sym: true, color: GOLD, width: 0.04 },
    ],
    opacity: 0.88,
  },
  'maroon-kameez': {
    id: 'maroon-kameez',
    slot: 'top',
    coverage: 'knees',
    half: topHalf({ ...womenKameez({ seg: 'fore', t: 0.95 }), neck: 'v', hemT: 1.12, hemOut: 0.3 }),
    fill: '#6b1430',
    print: { kind: 'motif', colors: [GOLD], scale: 0.6, opacity: 0.45 },
    trims: [
      neckTrim('v', GOLD, 0.05),
      neckTrim('v', '#f3dfa6', 0.012, '1 9'),
      { path: ['neck y:0.44', 'chest y:0.35'], color: GOLD, width: 0.03, dash: '2 12' },
      hemTrim(1.12, 0.3, 0, GOLD, 0.1),
      hemTrim(1.12, 0.3, 0, '#f3dfa6', 0.014, 0.12, '1 10'),
      cuffTrim('fore', 0.95, 0.085, GOLD, 0.07),
      armhole('#3d0a1b'),
    ],
    folds: sideFolds,
  },
  'maroon-trouser': {
    id: 'maroon-trouser',
    slot: 'bottom',
    coverage: 'ankles',
    half: shalwarHalf(0.05),
    fill: '#5e1029',
    trims: [{ path: ['R.ankle out:0.1 y:-0.01', 'R.ankle out:-0.1 y:-0.01'], sym: true, color: GOLD, width: 0.05 }],
    folds: legFolds,
  },
  'gold-dupatta': {
    id: 'gold-dupatta',
    slot: 'drape',
    coverage: 'knees',
    half: dupattaHalf(),
    fill: '#dcb867',
    print: { kind: 'motif', colors: ['#6b1430'], scale: 0.45, opacity: 0.5 },
    trims: [
      { path: ['R.hip>R.knee@0.7 out:0.03', 'R.hip>R.knee@0.7 out:-0.3'], sym: true, color: '#6b1430', width: 0.05 },
      { path: ['R.shoulder out:0.08 y:0.08', 'R.hip out:0.03', 'R.hip>R.knee@0.73 out:0.02'], sym: true, color: '#6b1430', width: 0.018 },
    ],
    opacity: 0.72,
  },
  'white-kurta': {
    id: 'white-kurta',
    slot: 'top',
    coverage: 'knees',
    half: topHalf(menKurta),
    fill: '#f3f1eb',
    trims: [...placket('#d9d4c6', '#bdb6a3'), cuffTrim('fore', 1.0, 0.085, '#e2ddd0', 0.012), armhole('#b9b2a0')],
    folds: sideFolds,
  },
  'white-shalwar-m': {
    id: 'white-shalwar-m',
    slot: 'bottom',
    coverage: 'ankles',
    half: shalwarHalf(0.7),
    fill: '#f1eee6',
    folds: legFolds,
  },
  'black-kurta': {
    id: 'black-kurta',
    slot: 'top',
    coverage: 'knees',
    half: topHalf(menKurta),
    fill: '#1c1e23',
    trims: [
      ...placket('#9aa0aa', '#c9ced6'),
      { path: ['neck x:0.07 y:0.02', 'chest x:0.07 y:0.14'], sym: true, color: '#8d939c', width: 0.012, dash: '3 7' },
      cuffTrim('fore', 1.0, 0.085, '#8d939c', 0.012, '3 7'),
      armhole('#000000'),
    ],
    folds: sideFolds,
  },
  'beige-kameez': {
    id: 'beige-kameez',
    slot: 'top',
    coverage: 'knees',
    half: topHalf({ ...menKurta, neck: 'collar', hemT: 0.98, hemCurve: 0.12, chest: 0.52, waist: 0.5 }),
    fill: '#c9b38b',
    trims: [
      ...placket('#a8936c', '#8a7550'),
      { path: ['neck x:0.17 y:-0.07', 'neck x:0.13 y:0.06', 'neck x:0.02 y:0.1'], sym: true, color: '#a8936c', width: 0.01 },
      cuffTrim('fore', 1.0, 0.085, '#a8936c', 0.012),
      cuffTrim('fore', 0.9, 0.085, '#a8936c', 0.012),
      armhole('#8a7550'),
    ],
    folds: sideFolds,
  },
  'beige-shalwar': {
    id: 'beige-shalwar',
    slot: 'bottom',
    coverage: 'ankles',
    half: shalwarHalf(0.7),
    fill: '#c4ad85',
    folds: legFolds,
  },
};

interface CatalogItem {
  id: string;
  gender: 'women' | 'men';
  name: { en: string; ur: string };
  price: number;
  swatch: string;
  layers: GarmentLayerSpec[];
}

mkdirSync(outDir, { recursive: true });
const built = Object.fromEntries(Object.entries(layers).map(([k, def]) => [k, buildLayer(def)]));
const catalog: CatalogItem[] = [
  {
    id: 'firozi-lawn-3pc',
    gender: 'women',
    name: { en: 'Firozi Lawn 3-Piece', ur: 'فیروزی لان تھری پیس' },
    price: 4990,
    swatch: '#1e9e9a',
    layers: [built['white-shalwar-w'], built['firozi-kameez'], built['firozi-dupatta']],
  },
  {
    id: 'maroon-embroidered-3pc',
    gender: 'women',
    name: { en: 'Maroon Embroidered 3-Piece', ur: 'مرون کڑھائی والا تھری پیس' },
    price: 8450,
    swatch: '#6b1430',
    layers: [built['maroon-trouser'], built['maroon-kameez'], built['gold-dupatta']],
  },
  {
    id: 'white-cotton-kurta',
    gender: 'men',
    name: { en: 'White Cotton Kurta Shalwar', ur: 'سفید کاٹن کرتا شلوار' },
    price: 3990,
    swatch: '#f3f1eb',
    layers: [built['white-shalwar-m'], built['white-kurta']],
  },
  {
    id: 'black-embroidered-kurta',
    gender: 'men',
    name: { en: 'Black Embroidered Kurta', ur: 'سیاہ کڑھائی والا کرتا' },
    price: 5490,
    swatch: '#1c1e23',
    layers: [built['white-shalwar-m'], built['black-kurta']],
  },
  {
    id: 'beige-shalwar-kameez',
    gender: 'men',
    name: { en: 'Beige Shalwar Kameez', ur: 'بیج شلوار قمیض' },
    price: 4250,
    swatch: '#c9b38b',
    layers: [built['beige-shalwar'], built['beige-kameez']],
  },
];
writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Wrote ${Object.keys(built).length} garment layers and ${catalog.length} outfits.`);
