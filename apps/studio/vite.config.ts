import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const ROOT = resolve(__dirname, '../..');
const DATASETS = join(ROOT, 'datasets');
const WIDGET_PUBLIC = join(ROOT, 'apps/widget/public');
const IMAGE = /\.(jpe?g|png|webp)$/i;

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

/** Resolve a path inside `base`, refusing anything that escapes it. */
function inside(base: string, rel: string): string {
  const p = resolve(base, rel);
  if (p !== base && !p.startsWith(base + sep)) throw new Error('path outside allowed folder');
  return p;
}

const slugOk = (s: string) => /^[a-z0-9][a-z0-9-]*$/i.test(s);

/**
 * Dev-only bridge for the batch importer (batch.html): lists product photos in datasets/,
 * serves them, and writes imported garments + catalog into the widget's public folder.
 * datasets/<store>/<product>/{photo.jpg, dupatta.jpg, product.json}
 */
function datasetsBridge(): Plugin {
  return {
    name: 'datasets-bridge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__datasets', async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://x');
          const send = (code: number, body: unknown, type = 'application/json') => {
            res.statusCode = code;
            res.setHeader('Content-Type', type);
            res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
          };
          if (url.pathname === '/manifest.json') {
            const stores = existsSync(DATASETS) ? readdirSync(DATASETS).filter((d) => slugOk(d) && statSync(join(DATASETS, d)).isDirectory()) : [];
            const products = stores.flatMap((store) =>
              readdirSync(join(DATASETS, store))
                .filter((p) => slugOk(p) && statSync(join(DATASETS, store, p)).isDirectory())
                .map((product) => {
                  const dir = join(DATASETS, store, product);
                  const files = readdirSync(dir).filter((f) => IMAGE.test(f)).sort();
                  const metaPath = join(dir, 'product.json');
                  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
                  return { store, product, files, meta };
                }),
            );
            return send(200, products);
          }
          if (url.pathname.startsWith('/file/')) {
            const file = inside(DATASETS, decodeURIComponent(url.pathname.slice('/file/'.length)));
            const type = { '.png': 'image/png', '.webp': 'image/webp' }[extname(file).toLowerCase()] ?? 'image/jpeg';
            return send(200, readFileSync(file), type);
          }
          if (req.method === 'POST' && url.pathname === '/save') {
            const rel = url.searchParams.get('path') ?? '';
            if (!/^garments\/[a-z0-9-]+\/[a-z0-9-]+\.(webp|png)$/i.test(rel)) return send(400, { error: 'bad path' });
            const file = inside(WIDGET_PUBLIC, rel);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, await readBody(req));
            return send(200, { ok: true });
          }
          if (req.method === 'POST' && url.pathname === '/catalog') {
            const store = url.searchParams.get('store') ?? '';
            if (!slugOk(store) || store === 'demo') return send(400, { error: 'bad store' });
            const file = inside(WIDGET_PUBLIC, `catalog/${store}.json`);
            const incoming = JSON.parse((await readBody(req)).toString('utf8')) as { id: string }[];
            const existing = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { id: string }[]) : [];
            const merged = [...existing.filter((p) => !incoming.some((q) => q.id === p.id)), ...incoming];
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
            return send(200, { ok: true, products: merged.length });
          }
          if (req.method === 'POST' && url.pathname === '/report') {
            mkdirSync(DATASETS, { recursive: true });
            writeFileSync(join(DATASETS, 'report.html'), await readBody(req));
            return send(200, { ok: true, path: 'datasets/report.html' });
          }
          send(404, { error: 'not found' });
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}

// Garment Studio: internal tool for preparing store product photos for try-on.
export default defineConfig({
  base: './',
  plugins: [datasetsBridge()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: { input: { studio: resolve(__dirname, 'index.html') } },
  },
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
  server: { port: 5174 },
});
