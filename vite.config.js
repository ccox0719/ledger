import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const input = path => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: input('./public/index.html'),
        retirement: input('./public/retirement.html'),
      },
    },
  },
});
