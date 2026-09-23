import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const APP_PORT = process.env.PORT || 3000;
const VITE_PORT = parseInt(process.env.VITE_PORT) || 5173;

export default defineConfig({
  resolve: {
    alias: {
      '@baguette/shared': path.resolve(repoRoot, 'shared'),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Let /auth/* hit the network (OAuth redirects); do not serve the SPA shell.
        navigateFallbackDenylist: [/^\/auth/],
      },
      manifest: {
        name: 'Baguette',
        short_name: 'Baguette',
        description: 'Baguette - your AI coding agent',
        theme_color: '#f5a523',
        background_color: '#0f0f0f',
        display: 'standalone',
        icons: [
          {
            src: '/baguette-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/baguette-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/baguette-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: VITE_PORT,
    strictPort: true,
    fs: {
      allow: [repoRoot],
    },
    allowedHosts: process.env.PUBLIC_HOST ? [new URL(process.env.PUBLIC_HOST).hostname] : undefined,
    proxy: {
      '/api': `http://127.0.0.1:${APP_PORT}`,
      '/auth': `http://127.0.0.1:${APP_PORT}`,
    },
  },
});
