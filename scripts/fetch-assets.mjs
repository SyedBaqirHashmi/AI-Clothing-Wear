/**
 * Self-host the tracking runtime and models (never depend on a third-party CDN at runtime).
 *   node scripts/fetch-assets.mjs <dest-dir>
 * Copies MediaPipe's wasm files from node_modules and downloads the pose models once.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const dest = resolve(process.argv[2] ?? 'public/mediapipe');
const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('@mediapipe/tasks-vision', { paths: [process.cwd()] }));

const MODELS = {
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  'pose_landmarker_full.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
};

mkdirSync(join(dest, 'wasm'), { recursive: true });
mkdirSync(join(dest, 'models'), { recursive: true });
for (const f of readdirSync(join(pkgDir, 'wasm'))) {
  const src = join(pkgDir, 'wasm', f);
  const dst = join(dest, 'wasm', f);
  if (!existsSync(dst) || statSync(dst).size !== statSync(src).size) copyFileSync(src, dst);
}
for (const [name, url] of Object.entries(MODELS)) {
  const dst = join(dest, 'models', name);
  if (existsSync(dst) && statSync(dst).size > 0) continue;
  process.stdout.write(`Downloading ${name}… `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
  console.log('done');
}
console.log(`MediaPipe assets ready in ${dest}`);
