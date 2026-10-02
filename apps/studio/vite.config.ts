import { defineConfig } from 'vite';

// Garment Studio: internal tool for preparing store product photos for try-on.
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
  server: { port: 5174 },
});
