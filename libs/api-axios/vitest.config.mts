import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/api-axios',
  test: {
    name: 'api-axios',
    watch: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
