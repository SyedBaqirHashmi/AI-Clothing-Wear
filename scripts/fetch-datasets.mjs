/**
 * Download openly licensed photos of Pakistani clothing into datasets/ for testing.
 * Only sources with an explicit licence; the licence and author of every photo are saved
 * next to it (source.json). Photos stay git-ignored.
 *
 *   node scripts/fetch-datasets.mjs [--openverse] [--pexels] [--roboflow] [--limit 40]
 *
 * Sources
 *   --openverse  Openverse (CC-licensed images, no key). Commercial-use licences only.
 *   --pexels     Pexels (free licence, commercial use allowed). Needs PEXELS_API_KEY.
 *   --roboflow   Roboflow Universe datasets (CC BY 4.0) with kameez / shalwar / dupatta
 *                boxes, used to measure hem-detection accuracy. Needs ROBOFLOW_API_KEY.
 *   --hf-pk      Hugging Face "pakistani_fashion_dataset" (~10k Pakistani e-commerce photos).
 *                The photos belong to the brands, so they go to datasets/internal-*:
 *                accuracy testing only, never demos, catalogs or training a shipped model.
 *
 * Output: datasets/<source>/<item>/photo.jpg + product.json + source.json (+ labels.json)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATASETS = join(root, 'datasets');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || 40;
const all = !has('--openverse') && !has('--pexels') && !has('--roboflow') && !has('--hf-pk');

/** Searches, with the section each one represents. */
const QUERIES = [
  { q: 'shalwar kameez', gender: 'women' },
  { q: 'salwar kameez', gender: 'women' },
  { q: 'salwar suit', gender: 'women' },
  { q: 'pakistani dress', gender: 'women' },
  { q: 'churidar', gender: 'women' },
  { q: 'shalwar kameez man', gender: 'men' },
  { q: 'pathani suit', gender: 'men' },
  { q: 'kurta pajama', gender: 'men' },
  { q: 'kurta', gender: 'men' },
];

/** Roboflow Universe projects (workspace/project/version), CC BY 4.0 at time of writing. */
const ROBOFLOW = [
  { workspace: 'cooking-pot', project: 'pakistani-clothes', version: 1 },
  { workspace: 'cooking-pot', project: 'dupatta', version: 1 },
];

/** Identify ourselves (Wikimedia and others require a descriptive user agent). */
const UA = { 'User-Agent': 'AI-Clothing-Wear-dataset-fetcher/0.2 (https://github.com/SyedBaqirHashmi/AI-Clothing-Wear; test images for a virtual try-on)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polite fetch: one retry schedule for 429/503 (honours Retry-After). */
async function politeFetch(url, headers = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { ...UA, ...headers } });
    if ((res.status !== 429 && res.status !== 503) || attempt >= 4) return res;
    const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** attempt;
    await sleep(Math.min(wait, 30000));
  }
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

async function getJson(url, headers = {}) {
  const res = await politeFetch(url, headers);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function saveItem(source, id, imageUrl, meta, attribution, headers = {}) {
  const dir = join(DATASETS, source, slug(id));
  if (existsSync(join(dir, 'photo.jpg'))) return false;
  // Space out requests to the same host (Wikimedia rate-limits bursts).
  await sleep(new URL(imageUrl).host.endsWith('wikimedia.org') ? 1200 : 150);
  const res = await politeFetch(imageUrl, headers);
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 20_000) return false; // thumbnails / broken images
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'photo.jpg'), buf);
  writeFileSync(join(dir, 'product.json'), JSON.stringify(meta, null, 2));
  writeFileSync(join(dir, 'source.json'), JSON.stringify(attribution, null, 2));
  return true;
}

// ---------------------------------------------------------------------------------------------
async function openverse() {
  let n = 0;
  for (const { q, gender } of QUERIES) {
    // Licences that allow commercial use; tall photos (people standing). Anonymous requests
    // are limited to 20 results per page.
    const results = [];
    for (let page = 1; results.length < LIMIT && page <= Math.ceil(LIMIT / 20); page++) {
      const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license_type=commercial&aspect_ratio=tall&page_size=20&page=${page}`;
      const data = await getJson(url).catch(() => ({ results: [] }));
      if (!data.results?.length) break;
      results.push(...data.results);
    }
    for (const r of results.slice(0, LIMIT)) {
      const ok = await saveItem(
        'openverse',
        `${q}-${r.id}`,
        r.url,
        { name: { en: r.title?.slice(0, 60) || q }, gender },
        { source: 'Openverse', title: r.title, creator: r.creator, license: `${r.license} ${r.license_version ?? ''}`.trim(), license_url: r.license_url, page: r.foreign_landing_url },
      ).catch(() => false);
      if (ok) n++;
    }
    console.log(`openverse "${q}": ${n} photos so far`);
  }
  return n;
}

async function pexels() {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error('PEXELS_API_KEY is not set (free key: https://www.pexels.com/api/)');
  let n = 0;
  for (const { q, gender } of QUERIES) {
    const data = await getJson(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=portrait&per_page=${Math.min(80, LIMIT)}`, { Authorization: key });
    for (const p of data.photos ?? []) {
      const ok = await saveItem(
        'pexels',
        `${q}-${p.id}`,
        p.src.large2x ?? p.src.original,
        { name: { en: p.alt?.slice(0, 60) || q }, gender },
        { source: 'Pexels', creator: p.photographer, license: 'Pexels License', license_url: 'https://www.pexels.com/license/', page: p.url },
      ).catch(() => false);
      if (ok) n++;
    }
    console.log(`pexels "${q}": ${n} photos so far`);
  }
  return n;
}

/** COCO export → one folder per image, with kameez / shalwar / dupatta boxes in labels.json. */
async function roboflow() {
  const key = process.env.ROBOFLOW_API_KEY;
  if (!key) throw new Error('ROBOFLOW_API_KEY is not set (free account: https://app.roboflow.com/settings/api)');
  let n = 0;
  for (const { workspace, project, version } of ROBOFLOW) {
    const info = await getJson(`https://api.roboflow.com/${workspace}/${project}/${version}/coco?api_key=${key}`);
    const link = info.export?.link;
    if (!link) throw new Error(`no export link for ${workspace}/${project}`);
    const tmp = join(DATASETS, '.tmp', project);
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    const zip = join(tmp, 'export.zip');
    writeFileSync(zip, Buffer.from(await (await fetch(link)).arrayBuffer()));
    execFileSync('unzip', ['-q', '-o', zip, '-d', tmp]);
    for (const split of readdirSync(tmp).filter((d) => existsSync(join(tmp, d, '_annotations.coco.json')))) {
      const coco = JSON.parse(readFileSync(join(tmp, split, '_annotations.coco.json'), 'utf8'));
      const cats = Object.fromEntries(coco.categories.map((c) => [c.id, c.name.toLowerCase()]));
      for (const img of coco.images) {
        const boxes = coco.annotations
          .filter((a) => a.image_id === img.id)
          .map((a) => ({ label: cats[a.category_id], box: a.bbox.map((v, i) => +(v / (i % 2 ? img.height : img.width)).toFixed(4)) })); // [x, y, w, h] as fractions
        if (!boxes.some((b) => /kameez|kurta|shirt/.test(b.label))) continue;
        const dir = join(DATASETS, `roboflow-${project}`, slug(img.file_name.replace(/\.[^.]+$/, '')));
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'photo.jpg'), readFileSync(join(tmp, split, img.file_name)));
        writeFileSync(join(dir, 'labels.json'), JSON.stringify({ boxes }, null, 2));
        writeFileSync(join(dir, 'product.json'), JSON.stringify({ name: { en: `${project} ${img.id}` }, gender: 'women' }, null, 2));
        writeFileSync(
          join(dir, 'source.json'),
          JSON.stringify({ source: 'Roboflow Universe', dataset: `${workspace}/${project}/${version}`, license: 'CC BY 4.0', page: `https://universe.roboflow.com/${workspace}/${project}` }, null, 2),
        );
        n++;
      }
    }
    rmSync(join(DATASETS, '.tmp'), { recursive: true, force: true });
    console.log(`roboflow ${workspace}/${project}: ${n} labelled photos so far`);
  }
  return n;
}

/** Random sample (fixed seed) of the Hugging Face Pakistani fashion dataset. */
async function hfPakistani() {
  const repo = 'mohummadmahad/pakistani_fashion_dataset';
  const info = await getJson(`https://huggingface.co/api/datasets/${repo}`);
  const files = info.siblings.map((x) => x.rfilename).filter((f) => /^train\/\d+\.jpe?g$/i.test(f));
  let seed = 42;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const pick = [...files].sort(() => rand() - 0.5).slice(0, LIMIT);
  let n = 0;
  for (const f of pick) {
    const id = f.replace(/^train\//, '').replace(/\.\w+$/, '');
    const ok = await saveItem(
      'internal-hf-pk',
      `pk-${id}`,
      `https://huggingface.co/datasets/${repo}/resolve/main/${f}`,
      { name: { en: `Pakistani fashion ${id}` } },
      { source: `Hugging Face ${repo}`, file: f, license: 'Dataset card says OpenRAIL, but the photos come from Pakistani e-commerce sites and belong to the brands: INTERNAL TESTING ONLY' },
    ).catch(() => false);
    if (ok) n++;
  }
  return n;
}

const tasks = [
  ...(all || has('--openverse') ? [['openverse', openverse]] : []),
  ...(has('--pexels') ? [['pexels', pexels]] : []),
  ...(has('--roboflow') ? [['roboflow', roboflow]] : []),
  ...(has('--hf-pk') ? [['hf-pk', hfPakistani]] : []),
];
let failed = 0;
for (const [name, fn] of tasks) {
  try {
    console.log(`${name}: ${await fn()} new photos`);
  } catch (err) {
    failed++;
    console.error(`${name} failed: ${err.message}`);
    if (/403|ENOTFOUND|fetch failed/.test(String(err.message) + String(err.cause ?? ''))) {
      console.error('  → the host may be blocked by the network policy; see docs/testing-guide.md');
    }
  }
}
console.log('Next: npm run import  (then open datasets/report.html)');
process.exit(failed ? 1 : 0);
