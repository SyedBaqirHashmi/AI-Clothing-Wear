/**
 * Self-host the tracking runtime and models (never depend on a third-party CDN at runtime).
 *
 *   node scripts/fetch-assets.mjs <dest-dir> [--segmenter]
 *
 * Files go to <dest-dir>/<mediapipe-version>/{wasm,models}/ so URLs change when MediaPipe is
 * upgraded; that lets browsers and the service worker cache them forever.
 * --segmenter also downloads the clothes-segmentation model used by the Garment Studio.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const withSegmenter = args.includes('--segmenter');
const destRoot = resolve(args.find((a) => !a.startsWith('--')) ?? 'public/mediapipe');
const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('@mediapipe/tasks-vision', { paths: [process.cwd()] }));
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
const dest = join(destRoot, version);

const POSE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
const MODELS = {
  'pose_landmarker_lite.task': `${POSE}/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
  'pose_landmarker_full.task': `${POSE}/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
  ...(withSegmenter
    ? {
        'selfie_multiclass_256x256.tflite':
          'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite',
      }
    : {}),
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
console.log(`MediaPipe ${version} assets ready in ${dest}`);
