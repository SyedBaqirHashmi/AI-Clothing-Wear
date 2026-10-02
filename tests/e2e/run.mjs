/**
 * End-to-end test: runs the real demo app in headless Chromium with a fake 720p camera
 * that shows a person (moving slightly), and checks that the full pipeline works:
 * camera → worker tracking → body model → garment warp → WebGL render.
 *
 *   npm run e2e            (CHROMIUM_PATH can override the browser binary)
 *
 * Note: headless Chromium renders with a software GPU, so fps numbers here are NOT
 * representative of phones. Real performance is measured on devices (docs/05-process.md).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'test-results');
mkdirSync(out, { recursive: true });
const PORT = 4173;
const BASE = `http://localhost:${PORT}/`;
const chromePath =
  process.env.CHROMIUM_PATH ??
  (() => {
    const dir = '/opt/pw-browsers';
    const ver = existsSync(dir) && readdirSync(dir).find((d) => /^chromium-\d+$/.test(d));
    return ver ? join(dir, ver, 'chrome-linux/chrome') : undefined;
  })();

// 1. Test footage: MediaPipe's public sample image of a person, animated into a 720p MJPEG.
const photoPath = join(out, 'person.jpg');
if (!existsSync(photoPath)) {
  const res = await fetch('https://storage.googleapis.com/mediapipe-assets/pose.jpg');
  if (!res.ok) throw new Error(`could not download test image: ${res.status}`);
  writeFileSync(photoPath, Buffer.from(await res.arrayBuffer()));
}
const videoPath = join(out, 'camera.mjpeg');
{
  const browser = await chromium.launch({ executablePath: chromePath });
  const page = await browser.newPage();
  const b64 = (await import('node:fs')).readFileSync(photoPath).toString('base64');
  const frames = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${src}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 720;
    const ctx = c.getContext('2d');
    const frames = [];
    for (let i = 0; i < 90; i++) {
      const s = 720 / img.height;
      const dx = 40 * Math.sin((2 * Math.PI * i) / 90);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 1280, 720);
      ctx.drawImage(img, (1280 - img.width * s) / 2 + dx, 0, img.width * s, 720);
      frames.push(c.toDataURL('image/jpeg', 0.9).split(',')[1]);
    }
    return frames;
  }, b64);
  writeFileSync(videoPath, Buffer.concat(frames.map((f) => Buffer.from(f, 'base64'))));
  await browser.close();
}

// 2. Dev server.
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: join(root, 'apps/widget'),
  stdio: 'ignore',
  detached: true,
});
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
  if (i > 60) throw new Error('dev server did not start');
  await new Promise((r) => setTimeout(r, 500));
}

// 3. Run the app with the fake camera.
const browser = await chromium.launch({
  executablePath: chromePath,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${videoPath}`,
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

const catalog = JSON.parse((await import('node:fs')).readFileSync(join(root, 'apps/widget/public/catalog/demo.json'), 'utf8'));
const runs = [
  ...catalog.map((c) => ({ name: c.id, query: `outfit=${c.id}` })),
  { name: 'main-thread-fallback', query: `outfit=${catalog[0].id}&worker=0` },
  { name: 'urdu-ui', query: `outfit=${catalog[1].id}&lang=ur` },
];
const results = [];
let failed = false;

for (const run of runs) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  // External web font: not needed for the test (and may be blocked in CI networks).
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${BASE}?autostart=1&${run.query}`);
  let stats = null;
  let note = '';
  try {
    await page.waitForFunction(() => (window.__tryonStats?.trackHz ?? 0) > 0, null, { timeout: 90000 });
    await page.waitForTimeout(6000);
    stats = await page.evaluate(() => window.__tryonStats);
  } catch (err) {
    note = `no tracking: ${String(err).split('\n')[0]}`;
  }
  const guidance = await page.evaluate(() => document.querySelector('.guidance')?.textContent ?? '');
  await page.screenshot({ path: join(out, `${run.name}.png`) });
  const ok = !!stats && stats.videoWidth === 1280 && stats.videoHeight === 720 && errors.length === 0;
  if (!ok) failed = true;
  results.push({ run: run.name, ok, stats, guidance, errors: errors.slice(0, 3), note });
  await page.close();
}

// 4. Embedded in a store page: open from the product page, add to cart, close.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const checks = {};
  await page.goto(`${BASE}demo-store.html`);
  await page.waitForFunction(() => !!window.TryOn);
  await page.click('[data-tryon-product]');
  const frameEl = await page.waitForSelector('iframe[title="Virtual try-on"]');
  const frame = await frameEl.contentFrame();
  checks.iframeAllowsCamera = (await frameEl.getAttribute('allow')).includes('camera');
  await frame.waitForSelector('[data-action="start"]:not([disabled])');
  await frame.click('[data-action="start"]');
  await frame.waitForFunction(() => (window.__tryonStats?.trackHz ?? 0) > 0, null, { timeout: 90000 });
  checks.closeButtonShown = await frame.isVisible('.topbar [data-action="close"]');
  await frame.click('[data-group="size"] button:nth-child(3)'); // L
  await frame.click('.dock [data-action="cart"]');
  await frame.waitForSelector('.toast:not([hidden])');
  checks.toast = await frame.textContent('.toast');
  checks.storeCart = await page.textContent('#cart-count');
  checks.storeSize = await page.inputValue('#size');
  await page.screenshot({ path: join(out, 'embed-mobile.png') });
  await frame.click('.topbar [data-action="close"]');
  await page.waitForSelector('iframe[title="Virtual try-on"]', { state: 'detached' });
  checks.closed = true;
  // Phone back button closes the try-on instead of leaving the page.
  await page.click('[data-tryon-product]');
  await page.waitForSelector('iframe[title="Virtual try-on"]');
  await page.goBack();
  await page.waitForSelector('iframe[title="Virtual try-on"]', { state: 'detached' });
  checks.backButtonCloses = page.url().endsWith('demo-store.html');
  const ok =
    checks.iframeAllowsCamera && checks.closeButtonShown && checks.toast?.includes('Added') && checks.storeCart === 'Cart: 1' &&
    checks.storeSize === 'L' && checks.backButtonCloses && errors.length === 0;
  if (!ok) failed = true;
  results.push({ run: 'embed-store-mobile', ok, stats: null, guidance: '', errors: errors.slice(0, 3), note: JSON.stringify(checks) });
  await page.close();
}

await browser.close();
stopServer();
console.table(
  results.map((r) => ({
    run: r.run,
    ok: r.ok,
    video: r.stats ? `${r.stats.videoWidth}x${r.stats.videoHeight}` : '-',
    fps: r.stats?.renderFps ?? '-',
    trackHz: r.stats?.trackHz ?? '-',
    inferMs: r.stats?.inferenceMs ?? '-',
    mode: r.stats ? `${r.stats.delegate}/${r.stats.threading}` : '-',
    guidance: r.guidance,
  })),
);
for (const r of results) if (r.errors.length || r.note) console.log(r.run, r.note, r.errors);
writeFileSync(join(out, 'e2e.json'), JSON.stringify(results, null, 2));
console.log(`Screenshots in ${out}`);
process.exit(failed ? 1 : 0);
