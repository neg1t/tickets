import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/seat-view',
  test: {
    name: 'seat-view',
    watch: false,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts', 'src/**/*.test.tsx'],
  },
});
