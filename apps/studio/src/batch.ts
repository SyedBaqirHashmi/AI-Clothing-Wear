/**
 * Batch importer (dev only): datasets/<store>/<product>/ → widget garments + catalog + report.
 *
 * Per product folder:
 *   - the main photo (photo.* or the first image): the garment worn by a model
 *   - dupatta.* (optional): a dupatta on a plain background → drape layer
 *   - product.json (optional): { name: {en, ur}, price, gender, type, kind, splitAt }
 *       type: 'suit' (top + bottom split at the kameez hem) | 'top' | 'bottom'  (default: auto)
 *       kind: 'model' | 'plain'   (default: 'model')
 *       splitAt: hem position as a fraction of the photo height (overrides detection)
 */
import { cutOut, defaultSplitY, detectHem, exportLayer, layerAlpha, loadPhoto, slug, swatch, type CutoutResult, type ExportedLayer, type PhotoKind } from './pipeline.ts';
import { Vision } from './vision.ts';

interface Entry {
  store: string;
  product: string;
  files: string[];
  meta: {
    name?: { en?: string; ur?: string };
    price?: number;
    gender?: 'women' | 'men';
    type?: 'suit' | 'top' | 'bottom';
    kind?: PhotoKind;
    splitAt?: number;
  };
}

interface ReportRow {
  store: string;
  product: string;
  ok: boolean;
  notes: string[];
  preview: string;
  layers: { slot: string; coverage: string; kb: number; thumb: string }[];
}

const logEl = document.getElementById('log')!;
const log = (msg: string) => {
  logEl.textContent += `${msg}\n`;
  console.log(msg);
};

let vision: Promise<Vision> | null = null;
const getVision = () => (vision ??= Vision.create(`${import.meta.env.BASE_URL}mediapipe/`));

async function fetchImage(store: string, product: string, file: string): Promise<Blob> {
  const res = await fetch(`/__datasets/file/${store}/${product}/${encodeURIComponent(file)}`);
  if (!res.ok) throw new Error(`cannot read ${file}`);
  return res.blob();
}

async function save(path: string, blob: Blob): Promise<void> {
  const res = await fetch(`/__datasets/save?path=${encodeURIComponent(path)}`, { method: 'POST', body: blob });
  if (!res.ok) throw new Error(`save failed: ${path}`);
}

/** Small JPEG of the cut-out with the split line and joints, for the review report. */
function previewImage(c: CutoutResult, splitY: number | null): string {
  const { width: w, height: h } = c.pixels;
  const k = 360 / h;
  const full = document.createElement('canvas');
  full.width = w;
  full.height = h;
  const fx = full.getContext('2d')!;
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const a = c.alpha[i];
    // Garment over a grey checker so holes and halos are visible.
    const bg = ((Math.floor(i / w / 12) + Math.floor((i % w) / 12)) & 1) ? 70 : 50;
    for (let ch = 0; ch < 3; ch++) img.data[i * 4 + ch] = c.pixels.data[i * 4 + ch] * a + bg * (1 - a);
    img.data[i * 4 + 3] = 255;
  }
  fx.putImageData(img, 0, 0);
  if (splitY !== null) {
    fx.strokeStyle = '#d9b25a';
    fx.lineWidth = Math.max(2, w / 300);
    fx.setLineDash([w / 60, w / 90]);
    fx.beginPath();
    fx.moveTo(0, splitY);
    fx.lineTo(w, splitY);
    fx.stroke();
  }
  fx.setLineDash([]);
  for (const [name, p] of Object.entries(c.joints)) {
    fx.fillStyle = name.startsWith('R') ? '#d9b25a' : '#7fd1c4';
    fx.beginPath();
    fx.arc(p.x, p.y, Math.max(4, w / 120), 0, Math.PI * 2);
    fx.fill();
  }
  const out = document.createElement('canvas');
  out.width = Math.round(w * k);
  out.height = 360;
  out.getContext('2d')!.drawImage(full, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.8);
}

async function thumb(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const k = 160 / bmp.height;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = 160;
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/png');
}

function coverageOf(alpha: Float32Array): number {
  let s = 0;
  for (let i = 0; i < alpha.length; i++) s += alpha[i];
  return s / alpha.length;
}

async function importProduct(e: Entry): Promise<{ product: object | null; row: ReportRow }> {
  const notes: string[] = [];
  const row: ReportRow = { store: e.store, product: e.product, ok: false, notes, preview: '', layers: [] };
  const main = e.files.find((f) => /^photo\./i.test(f)) ?? e.files.find((f) => !/^dupatta\./i.test(f));
  if (!main) {
    notes.push('No photo found in the folder.');
    return { product: null, row };
  }
  const kind: PhotoKind = e.meta.kind ?? 'model';
  const photo = await loadPhoto(await fetchImage(e.store, e.product, main));
  const c = await cutOut(photo, getVision, { kind, fillGaps: true, accessories: false });
  if (kind === 'model' && !c.personFound) notes.push('No person detected: joints are a template, check this product in the Studio.');
  const cov = coverageOf(c.alpha);
  if (cov < 0.03) notes.push(`Very little clothing found (${(cov * 100).toFixed(1)}% of the photo).`);

  const hem = e.meta.splitAt !== undefined ? e.meta.splitAt * photo.height : detectHem(c);
  const type = e.meta.type ?? (hem !== null ? 'suit' : 'top');
  if (type === 'suit' && hem === null) notes.push('Kameez hem not detected: used the default (just above the knee).');
  const splitY = type === 'suit' ? (hem ?? defaultSplitY(c.joints)) : null;
  row.preview = previewImage(c, splitY);

  const pid = slug(e.product);
  const layers: ExportedLayer[] = [];
  const add = async (l: ExportedLayer | null, what: string) => {
    if (!l) {
      notes.push(`${what}: empty after cut-out.`);
      return;
    }
    layers.push(l);
  };
  if (type === 'suit') {
    await add(await exportLayer(c, { id: `${pid}-top`, slot: 'top', alpha: layerAlpha(c, 'above', splitY!) }), 'Top');
    await add(await exportLayer(c, { id: `${pid}-bottom`, slot: 'bottom', alpha: layerAlpha(c, 'below', splitY!) }), 'Bottom');
  } else {
    await add(await exportLayer(c, { id: `${pid}-${type}`, slot: type, alpha: c.alpha }), type);
  }
  const dupattaFile = e.files.find((f) => /^dupatta\./i.test(f));
  if (dupattaFile) {
    const dp = await loadPhoto(await fetchImage(e.store, e.product, dupattaFile));
    const dc = await cutOut(dp, getVision, { kind: 'plain', fillGaps: false, accessories: false });
    await add(await exportLayer(dc, { id: `${pid}-drape`, slot: 'drape', alpha: dc.alpha, opacity: 0.85 }), 'Dupatta');
  }
  if (!layers.length) return { product: null, row };

  for (const l of layers) {
    await save(`garments/${e.store}/${l.spec.id}.${l.ext}`, l.blob);
    row.layers.push({ slot: l.spec.slot, coverage: l.spec.coverage, kb: Math.round(l.blob.size / 1024), thumb: await thumb(l.blob) });
  }
  const top = layers.find((l) => l.spec.slot === 'top') ?? layers[0];
  const name = e.meta.name?.en ?? e.product.replace(/-/g, ' ');
  row.ok = true;
  return {
    row,
    product: {
      id: pid,
      gender: e.meta.gender ?? 'women',
      name: { en: name, ur: e.meta.name?.ur ?? name },
      price: e.meta.price ?? 0,
      swatch: await swatch(top.blob),
      layers: layers.map((l) => ({ ...l.spec, image: `garments/${e.store}/${l.spec.id}.${l.ext}` })),
    },
  };
}

function reportHtml(rows: ReportRow[]): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
  const cards = rows
    .map(
      (r) => `<section class="${r.ok ? (r.notes.length ? 'warn' : 'ok') : 'bad'}">
  <h2>${esc(r.store)} / ${esc(r.product)} <small>${r.ok ? (r.notes.length ? 'check' : 'ready') : 'failed'}</small></h2>
  <div class="row">${r.preview ? `<img src="${r.preview}" alt="cut-out">` : ''}${r.layers
    .map((l) => `<figure><img src="${l.thumb}" alt=""><figcaption>${l.slot} · ${l.coverage} · ${l.kb} KB</figcaption></figure>`)
    .join('')}</div>
  ${r.notes.length ? `<ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
  ${r.ok ? `<p><a href="http://localhost:5173/?store=${esc(r.store)}&outfit=${esc(slug(r.product))}">Try it on (widget dev server)</a></p>` : ''}
</section>`,
    )
    .join('\n');
  const ready = rows.filter((r) => r.ok && !r.notes.length).length;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Import report</title><style>
body{margin:0;padding:24px;font:14px system-ui,sans-serif;background:#121214;color:#f1efe9}
section{border:1px solid #2c2c33;border-left:6px solid #3c9;border-radius:10px;padding:12px 16px;margin:0 0 16px;background:#1b1b1f}
section.warn{border-left-color:#d9b25a}section.bad{border-left-color:#e66}
h2{font-size:16px;margin:0 0 10px}small{color:#9d9a92;font-weight:400;margin-left:8px}
.row{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap}.row>img{height:360px;border-radius:6px}
figure{margin:0;text-align:center}figure img{height:160px;background:repeating-conic-gradient(#3a3a40 0 25%,#2c2c31 0 50%) 0 0/12px 12px;border-radius:6px}
figcaption{font-size:12px;color:#9d9a92}a{color:#d9b25a}li{color:#e8c77d}
</style></head><body><h1>Import report</h1><p>${rows.length} products · ${ready} ready · ${rows.filter((r) => r.ok && r.notes.length).length} to check · ${rows.filter((r) => !r.ok).length} failed</p>${cards}</body></html>`;
}

async function run(): Promise<{ products: number; ready: number; failed: number }> {
  logEl.textContent = '';
  const entries = (await (await fetch('/__datasets/manifest.json')).json()) as Entry[];
  if (!entries.length) {
    log('No products found. Put photos in datasets/<store>/<product>/ (see datasets/README.md).');
    return { products: 0, ready: 0, failed: 0 };
  }
  const rows: ReportRow[] = [];
  const byStore = new Map<string, object[]>();
  for (const e of entries) {
    log(`→ ${e.store}/${e.product}`);
    try {
      const { product, row } = await importProduct(e);
      rows.push(row);
      if (product) byStore.set(e.store, [...(byStore.get(e.store) ?? []), product]);
      for (const n of row.notes) log(`   ! ${n}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      rows.push({ store: e.store, product: e.product, ok: false, notes: [msg], preview: '', layers: [] });
      log(`   ✗ ${msg}`);
    }
  }
  for (const [store, products] of byStore) {
    const res = await fetch(`/__datasets/catalog?store=${encodeURIComponent(store)}`, { method: 'POST', body: JSON.stringify(products) });
    log(`Catalog ${store}: ${res.ok ? 'saved' : 'FAILED'} (apps/widget/public/catalog/${store}.json)`);
  }
  await fetch('/__datasets/report', { method: 'POST', body: reportHtml(rows) });
  const summary = { products: rows.length, ready: rows.filter((r) => r.ok && !r.notes.length).length, failed: rows.filter((r) => !r.ok).length };
  log(`Done: ${JSON.stringify(summary)}. Report: datasets/report.html`);
  return summary;
}

document.getElementById('run')!.addEventListener('click', () => void run());
(window as unknown as { __runImport: typeof run }).__runImport = run;
