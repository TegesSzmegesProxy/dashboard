import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Backend CORS_ORIGINS defaults to http://localhost:3000.
  server: { port: 3000, strictPort: true },
});
