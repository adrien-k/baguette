import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { loadRootDotenv, publicHostHostname } from '../server/lib/public-host.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

loadRootDotenv();
const viteDevPublicHostEnv = {
  ...process.env,
  VITE_SERVER_ENABLED: process.env.VITE_SERVER_ENABLED ?? 'true',
};
const devAllowedHost = publicHostHostname(viteDevPublicHostEnv);

const APP_PORT = process.env.PORT || 3000;
const VITE_PORT = parseInt(process.env.VITE_PORT) || 5173;

const reactRoot = path.join(repoRoot, 'node_modules/react');
const reactDomRoot = path.join(repoRoot, 'node_modules/react-dom');

export default defineConfig({
  root: __dirname,
  define: {
    'import.meta.env.VITE_ENABLE_MOCK_AGENT': JSON.stringify(process.env.ENABLE_MOCK_AGENT ?? ''),
  },
  resolve: {
    alias: {
      '@baguette/shared': path.resolve(repoRoot, 'shared'),
      // Single React copy (client/ had a nested 19.2.x vs root 19.3.x — Rolldown duplicated hooks).
      react: reactRoot,
      'react-dom': reactDomRoot,
      'react-dom/client': path.join(reactDomRoot, 'client'),
      'react/jsx-runtime': path.join(reactRoot, 'jsx-runtime.js'),
      'react/jsx-dev-runtime': path.join(reactRoot, 'jsx-dev-runtime.js'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    // The big chunks are mermaid's diagram engines (elk is ~1.5 MB). They are already split off and
    // only fetched when a diagram is shown, so the default 500 kB warning does not apply to them.
    chunkSizeWarningLimit: 1600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
          ],
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Do not precache HTML shells; always fetch document navigations from the network.
        globIgnores: ['**/*.html'],
        navigateFallback: null,
        // If navigateFallback is re-enabled, keep OAuth and API paths off the SPA shell.
        navigateFallbackDenylist: [/^\/auth/, /^\/api/],
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
    allowedHosts: devAllowedHost ? [devAllowedHost] : undefined,
    proxy: {
      '/api': `http://127.0.0.1:${APP_PORT}`,
      '/auth': `http://127.0.0.1:${APP_PORT}`,
    },
  },
});
