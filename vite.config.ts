import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'zite-endpoints-sdk': path.resolve(__dirname, './src/shims/zite-endpoints-sdk'),
      'zite-auth-sdk': path.resolve(__dirname, './src/shims/zite-auth-sdk'),
      'zite-file-upload-sdk': path.resolve(__dirname, './src/shims/zite-file-upload-sdk'),
    },
  },
  server: {
    port: 5173,
    // Permite Host headers de túneles de desarrollo (ngrok/localtunnel) —
    // solo afecta el server de dev, nunca el build de producción.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
