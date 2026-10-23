import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/fixtures',
  test: {
    name: 'fixtures',
    watch: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
