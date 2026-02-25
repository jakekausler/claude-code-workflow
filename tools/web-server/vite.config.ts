import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@client': resolve(__dirname, 'src/client'),
      '@server': resolve(__dirname, 'src/server'),
    },
  },
  root: '.',
  server: {
    host: '0.0.0.0',
    port: 3101,
    hmr: {
      protocol: 'ws',
      port: 3101,
      clientPort: 3101,
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
