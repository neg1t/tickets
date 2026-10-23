import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/renderer-konva',
  test: {
    name: 'renderer-konva',
    watch: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
