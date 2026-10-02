import basicSsl from '@vitejs/plugin-basic-ssl';
import { build as esbuild } from 'esbuild';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Serve the store-side loader as /tryon.js in dev, built the same way as production. */
function loaderDevServer(): Plugin {
  return {
    name: 'tryon-loader-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.split('?')[0].endsWith('/tryon.js')) return next();
        const out = await esbuild({ entryPoints: [resolve(__dirname, 'src/loader.ts')], bundle: true, format: 'iife', write: false });
        res.setHeader('Content-Type', 'text/javascript');
        res.end(out.outputFiles[0].text);
      });
    },
  };
}

// `HTTPS=1 npm run dev` serves over https with a self-signed certificate, so a phone on the
// same Wi-Fi can open the camera (browsers only allow cameras on https or localhost).
export default defineConfig({
  // Relative paths so the build works from any folder (GitHub Pages, a store's CDN, …).
  base: './',
  plugins: [loaderDevServer(), ...(process.env.HTTPS ? [basicSsl()] : [])],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: { widget: resolve(__dirname, 'index.html'), 'demo-store': resolve(__dirname, 'demo-store.html') },
    },
  },
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
});
