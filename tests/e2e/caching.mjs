/**
 * Download budget test on the production build (requirement N-07 / N-08):
 * first visit downloads the model + runtime; a repeat visit should load almost nothing
 * from the network thanks to the service worker.
 *
 *   npm run build && npm run e2e:caching
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 4176;
const BASE = `http://localhost:${PORT}/`;
const chromePath =
  process.env.CHROMIUM_PATH ??
  (() => {
    const dir = '/opt/pw-browsers';
    const ver = existsSync(dir) && readdirSync(dir).find((d) => /^chromium-\d+$/.test(d));
    return ver ? join(dir, ver, 'chrome-linux/chrome') : undefined;
  })();

const dist = join(root, 'apps/widget/dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Run `npm run build` first');

// Static server that counts what it sends (browser-side hooks can't see the pose worker's
// downloads, the server sees everything). Compressed size = what a CDN with gzip would send.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const gzCache = new Map();
let served = { raw: 0, gzip: 0, files: [] };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, BASE).pathname)).replace(/^([/\\])+/, '');
  let file = join(dist, path || 'index.html');
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(dist) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  const body = readFileSync(file);
  if (!gzCache.has(file)) gzCache.set(file, gzipSync(body).length);
  served.raw += body.length;
  served.gzip += Math.min(body.length, gzCache.get(file));
  served.files.push([Math.round(gzCache.get(file) / 1024), path.split('/').pop()]);
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': body.length });
  res.end(body);
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({
  executablePath: chromePath,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext();
await context.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));

/** Visit the widget, wait until tracking runs, and sum the bytes fetched from the network. */
async function visit() {
  served = { raw: 0, gzip: 0, files: [] };
  const page = await context.newPage();
  await page.goto(`${BASE}?autostart=1&stats=1`);
  await page.waitForFunction(() => (window.__tryonStats?.trackHz ?? 0) > 0, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const swControlled = await page.evaluate(() => !!navigator.serviceWorker?.controller);
  await page.close();
  served.files.sort((a, b) => b[0] - a[0]);
  return {
    gzipKB: Math.round(served.gzip / 1024),
    rawKB: Math.round(served.raw / 1024),
    requests: served.files.length,
    swControlled,
    largestGzipKB: served.files.slice(0, 4),
  };
}

const first = await visit();
const second = await visit();
await browser.close();
server.close();
const ok = second.swControlled && second.gzipKB <= 300;
console.log(JSON.stringify({ ok, first, second, budgetKB: { firstVisit: 8 * 1024, repeatVisit: 300 } }, null, 2));
process.exit(ok ? 0 : 1);
