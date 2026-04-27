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
              // Network-first so live data wins when online, but a recent
              // cached GET response is served when the device is offline so
              // the app stays usable. Short TTL keeps stale operator data
              // from lingering. Workbox only caches GET by default; POST/
              // PUT/DELETE always go straight to the network.
              urlPattern: ({url}) => url.pathname.startsWith('/api/'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'boss-api',
                networkTimeoutSeconds: 5,
                expiration: {maxEntries: 32, maxAgeSeconds: 60 * 5},
                cacheableResponse: {statuses: [0, 200]},
              },
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
