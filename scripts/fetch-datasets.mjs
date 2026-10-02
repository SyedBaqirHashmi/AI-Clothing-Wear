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
const all = !has('--openverse') && !has('--pexels') && !has('--roboflow');

/** Searches, with the section each one represents. */
const QUERIES = [
  { q: 'shalwar kameez', gender: 'women' },
  { q: 'salwar kameez woman', gender: 'women' },
  { q: 'pakistani dress woman', gender: 'women' },
  { q: 'shalwar kameez man', gender: 'men' },
  { q: 'kurta pajama man', gender: 'men' },
  { q: 'pakistani kurta', gender: 'men' },
];

/** Roboflow Universe projects (workspace/project/version), CC BY 4.0 at time of writing. */
const ROBOFLOW = [
  { workspace: 'cooking-pot', project: 'pakistani-clothes', version: 1 },
  { workspace: 'cooking-pot', project: 'dupatta', version: 1 },
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function saveItem(source, id, imageUrl, meta, attribution, headers = {}) {
  const dir = join(DATASETS, source, slug(id));
  if (existsSync(join(dir, 'photo.jpg'))) return false;
  const res = await fetch(imageUrl, { headers });
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
    // Licences that allow commercial use; tall photos (people standing).
    const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license_type=commercial&aspect_ratio=tall&size=large&page_size=${LIMIT}`;
    const data = await getJson(url);
    for (const r of data.results ?? []) {
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

const tasks = [
  ...(all || has('--openverse') ? [['openverse', openverse]] : []),
  ...(has('--pexels') ? [['pexels', pexels]] : []),
  ...(has('--roboflow') ? [['roboflow', roboflow]] : []),
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
