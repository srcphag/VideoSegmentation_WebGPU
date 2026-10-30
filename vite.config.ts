import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5175,
    headers: {
      'Cache-Control': 'no-store',
    },
  },
  preview: {
    port: 4175,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    include: ['prores-wasm-encoder'],
  },
});
