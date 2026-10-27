import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/hall-viewer',
  test: {
    name: 'hall-viewer',
    watch: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
