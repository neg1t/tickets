import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      '@hall-platform/hall-viewer': fileURLToPath(
        new URL('../hall-viewer/src/index.ts', import.meta.url),
      ),
    },
  },
  cacheDir: '../../node_modules/.vite/libs/seat-view',
  test: {
    name: 'seat-view',
    watch: false,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts', 'src/**/*.test.tsx'],
  },
});
