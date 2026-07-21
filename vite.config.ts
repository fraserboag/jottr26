import path from 'node:path';
import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      // Without this the navigation fallback serves the app shell for the
      // auth handler, so the vercel.json proxy is never reached.
      workbox: {
        navigateFallbackDenylist: [/^\/__\/auth\//],
      },
      manifest: {
        name: 'Jottr',
        short_name: 'Jottr',
        description: 'A simple notes app with offline support and sync.',
        // Manifest colours cannot vary by scheme, so both track the light
        // --color-bg; index.html's paired meta tags handle dark where the
        // platform honours them.
        theme_color: '#fdfdfd',
        background_color: '#fdfdfd',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
