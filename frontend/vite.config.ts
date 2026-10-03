import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@ds': fileURLToPath(new URL('./Tessera Design System', import.meta.url)),
    },
  },
  // Backend CORS_ORIGINS defaults to http://localhost:3000.
  server: { port: 3000, strictPort: true },
});
