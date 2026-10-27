import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/renderer-core',
  test: {
    name: 'renderer-core',
    watch: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
