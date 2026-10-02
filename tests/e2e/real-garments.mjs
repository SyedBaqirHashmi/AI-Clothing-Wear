/**
 * Visual check: imported real garments worn through the live try-on (fake camera person).
 *
 *   npm run import && npm run e2e:real -- <store> [count]
 *
 * Writes test-results/real-<store>-<product>.png and a contact sheet
 * test-results/real-<store>.png. Needs test-results/camera.mjpeg (created by `npm run e2e`).
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'test-results');
const store = process.argv[2] ?? 'internal-hf-pk';
const count = Number(process.argv[3]) || 6;
const PORT = 4177;
const BASE = `http://localhost:${PORT}/`;
const chromePath =
  process.env.CHROMIUM_PATH ??
  (() => {
    const dir = '/opt/pw-browsers';
    const ver = existsSync(dir) && readdirSync(dir).find((d) => /^chromium-\d+$/.test(d));
    return ver ? join(dir, ver, 'chrome-linux/chrome') : undefined;
  })();

const catalogFile = join(root, `apps/widget/public/catalog/${store}.json`);
if (!existsSync(catalogFile)) throw new Error(`No catalog for "${store}": run npm run import first`);
if (!existsSync(join(out, 'camera.mjpeg'))) throw new Error('Run `npm run e2e` once first (it creates the fake camera video)');
const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
// Spread the picks across the catalog.
const picks = Array.from({ length: Math.min(count, catalog.length) }, (_, i) => catalog[Math.floor((i * catalog.length) / Math.min(count, catalog.length))]);

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: join(root, 'apps/widget'), stdio: 'ignore', detached: true });
const stop = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
};
process.on('exit', stop);
for (let i = 0; ; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {}
  if (i > 60) throw new Error('widget dev server did not start');
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({
  executablePath: chromePath,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${join(out, 'camera.mjpeg')}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const shots = [];
for (const item of picks) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(`${BASE}?autostart=1&stats=0&store=${store}&outfit=${item.id}`);
  try {
    await page.waitForFunction(() => (window.__tryonStats?.trackHz ?? 0) > 0, null, { timeout: 90000 });
    await page.waitForTimeout(5000);
    const file = join(out, `real-${store}-${item.id}.png`);
    await page.locator('#view').screenshot({ path: file });
    shots.push(file);
    console.log(`✓ ${item.id} (${item.layers.map((l) => l.slot).join('+')})`);
  } catch (err) {
    console.log(`✗ ${item.id}: ${String(err).split('\n')[0]}`);
  }
  await page.close();
}

// Contact sheet.
const sheet = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await sheet.setContent(
  `<body style="margin:0;background:#111;display:flex;flex-wrap:wrap;gap:6px;padding:6px">${shots
    .map((f) => `<img style="width:490px" src="data:image/png;base64,${readFileSync(f).toString('base64')}">`)
    .join('')}</body>`,
);
await sheet.screenshot({ path: join(out, `real-${store}.png`), fullPage: true });
await browser.close();
stop();
console.log(`Contact sheet: test-results/real-${store}.png`);
