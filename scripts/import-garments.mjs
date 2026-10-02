/**
 * Import real product photos for testing:
 *   datasets/<store>/<product>/photo.jpg  →  apps/widget/public/garments/<store>/*.webp
 *                                          + apps/widget/public/catalog/<store>.json
 *                                          + datasets/report.html (visual review)
 *
 *   npm run import
 *
 * Runs the Garment Studio's batch page in headless Chromium (same code as the Studio).
 * Then try the products on: npm run dev → http://localhost:5173/?store=<store>
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5184;
const BASE = `http://localhost:${PORT}/`;
const chromePath =
  process.env.CHROMIUM_PATH ??
  (() => {
    const dir = '/opt/pw-browsers';
    const ver = existsSync(dir) && readdirSync(dir).find((d) => /^chromium-\d+$/.test(d));
    return ver ? join(dir, ver, 'chrome-linux/chrome') : undefined;
  })();

// Models for the Studio (segmentation + pose).
await new Promise((ok, fail) =>
  spawn('npm', ['run', '-s', 'assets'], { cwd: join(root, 'apps/studio'), stdio: 'inherit' }).on('exit', (c) => (c ? fail(new Error('assets')) : ok())),
);

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: join(root, 'apps/studio'), stdio: 'ignore', detached: true });
const stop = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
};
process.on('exit', stop);
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}batch.html`)).ok) break;
  } catch {}
  if (i > 60) throw new Error('studio dev server did not start');
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ executablePath: chromePath, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'log') console.log(m.text());
  if (m.type() === 'error') console.error(m.text());
});
await page.goto(`${BASE}batch.html`);
const summary = await page.evaluate(() => window.__runImport());
await browser.close();
stop();
if (summary.products === 0) process.exit(1);
console.log('\nOpen datasets/report.html to review. Try on: npm run dev → http://localhost:5173/?store=<store>');
process.exit(summary.failed ? 1 : 0);
