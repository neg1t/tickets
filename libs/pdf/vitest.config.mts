import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/pdf',
  test: {
    name: 'pdf',
    watch: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
