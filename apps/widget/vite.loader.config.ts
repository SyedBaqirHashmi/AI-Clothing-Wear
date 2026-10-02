import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Builds the store-side loader as one small classic script: dist/tryon.js
export default defineConfig({
  build: {
    target: 'es2019',
    emptyOutDir: false,
    lib: { entry: resolve(__dirname, 'src/loader.ts'), formats: ['iife'], name: 'TryOnLoader', fileName: () => 'tryon.js' },
  },
});
