/**
 * End-to-end test of the Garment Studio: real photo → AI cut-out → automatic joints →
 * split into top + bottom layers → export → try-on preview on the same photo.
 *
 *   npm run e2e:studio   (run `npm run e2e` once first: it downloads the test photo)
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'test-results');
mkdirSync(out, { recursive: true });
const PORT = 4174;
const BASE = `http://localhost:${PORT}/`;
const chromePath =
  process.env.CHROMIUM_PATH ??
  (() => {
    const dir = '/opt/pw-browsers';
    const ver = existsSync(dir) && readdirSync(dir).find((d) => /^chromium-\d+$/.test(d));
    return ver ? join(dir, ver, 'chrome-linux/chrome') : undefined;
  })();

const photoPath = join(out, 'person.jpg');
if (!existsSync(photoPath)) {
  const res = await fetch('https://storage.googleapis.com/mediapipe-assets/pose.jpg');
  if (!res.ok) throw new Error(`could not download test image: ${res.status}`);
  writeFileSync(photoPath, Buffer.from(await res.arrayBuffer()));
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: join(root, 'apps/studio'), stdio: 'ignore', detached: true });
const stopServer = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
};
process.on('exit', stopServer);
for (let i = 0; ; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {}
  if (i > 60) throw new Error('studio dev server did not start');
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ executablePath: chromePath, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const checks = {};

await page.goto(BASE);
await page.setInputFiles('#photo', photoPath);
await page.waitForSelector('[data-action="cutout"]:not([disabled])');
await page.click('[data-action="cutout"]');
await page.waitForFunction(() => document.querySelector('.status')?.textContent?.startsWith('Cut out'), null, { timeout: 120000 });
checks.status = await page.textContent('.status');
Object.assign(
  checks,
  await page.evaluate(() => {
    const s = window.__studio.state;
    const a = s.alpha;
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i];
    const j = s.joints;
    return {
      coverage: +(sum / a.length).toFixed(3),
      shoulderWidthPx: Math.round(Math.hypot(j['R.shoulder'].x - j['L.shoulder'].x, j['R.shoulder'].y - j['L.shoulder'].y)),
      rightShoulderIsImageLeft: j['R.shoulder'].x < j['L.shoulder'].x,
      hipsBelowShoulders: j['R.hip'].y > j['R.shoulder'].y,
    };
  }),
);
await page.locator('.canvas-wrap').screenshot({ path: join(out, 'studio-cutout.png') });

// Top layer: everything above the hips (the tank top); bottom layer: the shorts.
await page.fill('#pid', 'test-outfit');
await page.fill('#name-en', 'Test Outfit');
await page.fill('#price', '2500');
await page.selectOption('#keep', 'above');
await page.evaluate(() => {
  const s = window.__studio.state;
  s.splitY = (s.joints['R.hip'].y + s.joints['L.hip'].y) / 2 + 10;
});
await page.selectOption('#slot', 'top');
await page.click('[data-action="add-layer"]');
await page.waitForFunction(() => window.__studio.state.layers.length === 1);
await page.selectOption('#keep', 'below');
await page.selectOption('#slot', 'bottom');
await page.click('[data-action="add-layer"]');
await page.waitForFunction(() => window.__studio.state.layers.length === 2);
const product = await page.evaluate(() => window.__studio.productJson());
checks.layers = product.layers.map((l) => `${l.slot}:${l.size.join('x')}:${l.coverage}`);
checks.imagePaths = product.layers.map((l) => l.image);
// Shoulders and hips must sit on or near the layer image; other joints may lie far outside it.
checks.jointsValid = product.layers.every((l) =>
  ['R.shoulder', 'L.shoulder', 'R.hip', 'L.hip'].every((j) => l.joints[j] && l.joints[j].every((x) => Number.isFinite(x) && Math.abs(x) < 10)),
);
writeFileSync(join(out, 'studio-product.json'), JSON.stringify(product, null, 2));

await page.click('[data-action="preview"]');
await page.waitForFunction(() => (window.__previewStats?.trackHz ?? 0) > 0, null, { timeout: 120000 });
await page.waitForTimeout(6000);
await page.locator('dialog.preview').screenshot({ path: join(out, 'studio-preview.png') });
checks.preview = await page.evaluate(() => window.__previewStats);

// Harder: the same garment on the mirrored photo (arms and legs in different places).
const mirrored = await page.evaluate(async () => {
  const img = document.querySelector('#work');
  const src = window.__studio.state.photo;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const cx = c.getContext('2d');
  cx.translate(c.width, 0);
  cx.scale(-1, 1);
  cx.drawImage(src, 0, 0);
  void img;
  return c.toDataURL('image/jpeg', 0.92).split(',')[1];
});
await page.setInputFiles('#preview-file', { name: 'mirrored.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(mirrored, 'base64') });
await page.waitForTimeout(8000);
await page.locator('dialog.preview').screenshot({ path: join(out, 'studio-preview-mirrored.png') });

await browser.close();
stopServer();
const ok =
  checks.coverage > 0.01 &&
  checks.rightShoulderIsImageLeft &&
  checks.hipsBelowShoulders &&
  checks.layers.length === 2 &&
  checks.jointsValid &&
  checks.preview?.trackHz > 0 &&
  errors.length === 0;
console.log(JSON.stringify({ ok, checks, errors: errors.slice(0, 5) }, null, 2));
process.exit(ok ? 0 : 1);
