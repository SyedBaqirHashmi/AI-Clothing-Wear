import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

// `HTTPS=1 npm run dev` serves over https with a self-signed certificate, so a phone on the
// same Wi-Fi can open the camera (browsers only allow cameras on https or localhost).
export default defineConfig({
  // Relative paths so the build works from any folder (GitHub Pages, a store's CDN, …).
  base: './',
  plugins: process.env.HTTPS ? [basicSsl()] : [],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
});
