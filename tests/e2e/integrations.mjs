/**
 * Tests the store integrations' cart hand-off code on simulated store pages:
 *  - Shopify snippet: S/M/L/XL → matching variant → POST /cart/add.js
 *  - WooCommerce plugin: S/M/L/XL → size dropdown selected → product form submitted
 * The real loader (tryon.js) is served by the widget dev server.
 *
 *   npm run e2e:integrations
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 4175;
const LOCAL = `http://localhost:${PORT}`;
/** Public-looking CDN host for the loader (browsers block public pages from loading localhost scripts). */
const HOST = 'https://cdn.tryon.test';
const chromePath =
  process.env.CHROMIUM_PATH ??
  (() => {
    const dir = '/opt/pw-browsers';
    const ver = existsSync(dir) && readdirSync(dir).find((d) => /^chromium-\d+$/.test(d));
    return ver ? join(dir, ver, 'chrome-linux/chrome') : undefined;
  })();

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: join(root, 'apps/widget'), stdio: 'ignore', detached: true });
const stopServer = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
};
process.on('exit', stopServer);
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${LOCAL}/tryon.js`)).ok) break;
  } catch {}
  if (i > 60) throw new Error('widget dev server did not start');
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ executablePath: chromePath });
const results = {};
const loaderJs = await (await fetch(`${LOCAL}/tryon.js`)).text();
const serveLoader = (page) =>
  page.route(`${HOST}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: loaderJs }));

// --- Shopify -------------------------------------------------------------------------------
{
  const variants = [
    { id: 101, available: true, options: ['Small'] },
    { id: 102, available: false, options: ['Medium'] },
    { id: 103, available: true, options: ['Large'] },
  ];
  const liquid = readFileSync(join(root, 'integrations/shopify/snippets/tryon.liquid'), 'utf8');
  const html = liquid
    .replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/, '')
    .replace(/\{%-?\s*assign tryon_host = '[^']*'\s*-?%\}/, '')
    .replace(/\{%-?\s*assign tryon_store = '[^']*'\s*-?%\}/, '')
    .replace(/\{%-?\s*if request\.locale\.iso_code == 'ur'\s*-?%\}.*?\{%-?\s*else\s*-?%\}(.*?)\{%-?\s*endif\s*-?%\}/, '$1')
    .replaceAll('{{ tryon_host }}', HOST)
    .replaceAll('{{ tryon_store | escape }}', 'demo')
    .replaceAll('{{ request.locale.iso_code }}', 'en')
    .replaceAll('{{ product.handle | escape }}', 'firozi-lawn-3pc')
    .replaceAll('{{ product.variants | json }}', JSON.stringify(variants))
    .replaceAll('{{ routes.cart_add_url }}', '/cart/add');
  if (/\{\{|\{%/.test(html)) throw new Error('unrendered Liquid left in the Shopify snippet test');
  const page = await browser.newPage();
  await serveLoader(page);
  const posted = [];
  await page.route('https://shop.test/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/cart/add.js')) {
      posted.push(JSON.parse(route.request().postData()));
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><body>${html}</body></html>` });
  });
  await page.goto('https://shop.test/products/firozi-lawn-3pc', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.TryOn?.onAddToCart === 'function');
  const okL = await page.evaluate(() => window.TryOn.onAddToCart({ product: 'firozi-lawn-3pc', size: 'L' }));
  const okM = await page.evaluate(() => window.TryOn.onAddToCart({ product: 'firozi-lawn-3pc', size: 'M' })); // sold out
  results.shopify = {
    ok: okL === true && okM === false && posted.length === 1 && posted[0].items[0].id === 103,
    addLarge: okL,
    addSoldOutMedium: okM,
    posted,
    buttonText: (await page.textContent('[data-tryon-product]')).trim(),
  };
  await page.close();
}

// --- WooCommerce ---------------------------------------------------------------------------
{
  const php = readFileSync(join(root, 'integrations/woocommerce/tryon-for-woocommerce/tryon-for-woocommerce.php'), 'utf8');
  const js = php.match(/<<<'JS'\n([\s\S]*?)\nJS;/)[1];
  const html = `<!doctype html><html><body>
    <form class="cart" method="post" action="/product/firozi">
      <select name="attribute_pa_size"><option value="">Choose</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option><option value="xl">XL</option></select>
      <button type="submit" name="add-to-cart" value="42" class="single_add_to_cart_button button alt">Add to cart</button>
    </form>
    <script id="tryon-loader-js" src="${HOST}/tryon.js" data-store="demo"></script>
    <script>${js}</script>
  </body></html>`;
  const page = await browser.newPage();
  await serveLoader(page);
  await page.route('https://woo.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto('https://woo.test/product/firozi', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.TryOn?.onAddToCart === 'function');
  await page.evaluate(() => {
    window.__submitted = null;
    document.querySelector('form.cart').addEventListener('submit', (e) => {
      e.preventDefault();
      window.__submitted = new FormData(e.target, e.submitter).get('attribute_pa_size');
    });
  });
  const ok = await page.evaluate(() => window.TryOn.onAddToCart({ product: 'firozi', size: 'XL' }));
  await page.waitForFunction(() => window.__submitted !== null);
  const submitted = await page.evaluate(() => window.__submitted);
  results.woocommerce = { ok: ok === true && submitted === 'xl', returned: ok, submittedSize: submitted };
  await page.close();
}

await browser.close();
stopServer();
console.log(JSON.stringify(results, null, 2));
process.exit(Object.values(results).every((r) => r.ok) ? 0 : 1);
