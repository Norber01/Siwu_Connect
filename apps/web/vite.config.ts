import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Siwu Connect',
        short_name: 'Siwu Connect',
        description: 'Community platform for Akpafu Odomi, Mempeasem, Todzi, Adokor and Sokpo.',
        id: '/',
        scope: '/',
        lang: 'en',
        categories: ['social', 'news', 'sports'],
        theme_color: '#1d6283',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache the app's code and images; all community data is always fetched fresh.
        // Pages themselves are NOT pre-cached: they are loaded from the network first (so security headers such
        // as the microphone permission always come fresh) and the last copy is used only when offline.
        globPatterns: ['**/*.{js,css,svg,png,woff2}'],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        // Shows notifications and opens the right page when one is tapped.
        importScripts: ['/push-sw.js'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'pages', networkTimeoutSeconds: 5, expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  server: { port: 5173, host: '127.0.0.1' },
  preview: { port: 4173, host: '127.0.0.1' },
  build: {
    target: 'es2020',
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        // Separate long-lived vendor chunks so app updates don't force users to re-download Firebase/React.
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          react: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
  },
});
