import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  optimizeDeps: {
    // Workspace package ships CJS; pre-bundle it for the dev server.
    include: ['@stockpred/shared-types'],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    commonjsOptions: {
      // Symlinked workspace packages resolve outside node_modules; make the
      // CJS interop cover them so named exports (e.g. DISCLAIMER) resolve.
      include: [/node_modules/, /shared-types/],
    },
  },
});
