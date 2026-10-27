import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/renderer-webgl',
  test: {
    name: 'renderer-webgl',
    watch: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
