import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nxReadySignal } from '@nx/vite/plugins/nx-ready-signal.plugin';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, '');
  return {
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/embed',
  test: {
    name: 'embed',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/embed',
      provider: 'v8' as const,
    },
  },
  server: {
    port: 4201,
    host: 'localhost',
  },
  preview: {
    port: 4301,
    host: 'localhost',
  },
  plugins: [react(), tailwindcss(), nxReadySignal()],
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [],
  // },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  define: {
    'import.meta.vitest': undefined,
    __TICKET_PURCHASE_EMBED_ENV__: JSON.stringify({
      dev: mode === 'development',
      apiBaseUrl: env['VITE_HALL_API_BASE_URL'],
      hostOrigins: env['VITE_TICKET_PURCHASE_HOST_ORIGINS'],
      apiOrigins: env['VITE_TICKET_PURCHASE_API_ORIGINS'],
      paymentOrigins: env['VITE_TICKET_PURCHASE_PAYMENT_ORIGINS'],
    }),
  },
  };
});
