import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/hall-editor',
  test: {
    name: 'hall-editor',
    watch: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
