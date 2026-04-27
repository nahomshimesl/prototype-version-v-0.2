import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: [
          'favicon.ico',
          'icons/apple-touch-icon.png',
          'icons/icon.svg',
        ],
        manifest: {
          name: 'BOSS',
          short_name: 'BOSS',
          description:
            'Research-grade simulation platform for biological ecosystems with full-stack metabolic flux engine and AI failure prediction.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'any',
          background_color: '#020617',
          theme_color: '#020617',
          categories: ['education', 'science', 'productivity'],
          icons: [
            {
              src: 'icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
          navigateFallback: '/index.html',
          // Don't intercept the API or live socket — those must hit the
          // server fresh. Anything not under /api or /socket.io falls
          // through to the SPA fallback so deep links keep working
          // offline once the shell is cached.
          navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//],
          runtimeCaching: [
            {
              // Network-first only for explicitly public GET endpoints —
              // status + the public sentinel report. Live data wins when
              // online; on offline / cold-Render-wakeup the app stays
              // usable. Short TTL + 200-only cache. Workbox caches GET
              // only by default. Authenticated operator endpoints fall
              // through to the catch-all NetworkOnly rule below so no
              // private data is ever cached on disk.
              urlPattern: ({url}) =>
                url.pathname === '/api/db/status' ||
                url.pathname === '/api/sentinel/report',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'boss-api-public',
                networkTimeoutSeconds: 5,
                expiration: {maxEntries: 8, maxAgeSeconds: 60 * 5},
                cacheableResponse: {statuses: [200]},
              },
            },
            {
              // Catch-all for the rest of /api/* — auth-gated endpoints,
              // POSTs, admin/operator routes — must always hit the
              // network so no private response is ever served from cache.
              urlPattern: ({url}) => url.pathname.startsWith('/api/'),
              handler: 'NetworkOnly',
              options: {cacheName: 'boss-api-private'},
            },
            {
              // Live socket transport must never be intercepted.
              urlPattern: ({url}) => url.pathname.startsWith('/socket.io/'),
              handler: 'NetworkOnly',
              options: {cacheName: 'boss-socket'},
            },
            {
              urlPattern: ({request}) => request.destination === 'image',
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'boss-images',
                expiration: {maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30},
              },
            },
            {
              urlPattern: ({request}) =>
                request.destination === 'font' ||
                request.destination === 'style' ||
                request.destination === 'script',
              handler: 'StaleWhileRevalidate',
              options: {cacheName: 'boss-assets'},
            },
          ],
        },
        devOptions: {
          // Keep the SW disabled in dev — HMR + a SW that caches old chunks
          // is a debugging nightmare. The SW only runs in built/preview/prod.
          enabled: false,
        },
      }),
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: true,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: [
          '**/.local/**',
          '**/.cache/**',
          '**/.git/**',
          '**/.agents/**',
          '**/node_modules/**',
          '**/dist/**',
          '**/.replit',
          '**/replit.md',
        ],
      },
    },
  };
});
