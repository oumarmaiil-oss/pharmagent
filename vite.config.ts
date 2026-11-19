import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'PharmAgent — Supervision Multi-Officines',
        short_name: 'PharmAgent',
        description: 'Plateforme SaaS de supervision pharmaceutique avec agents visuels IA.',
        theme_color: '#0a1628',
        background_color: '#0a1628',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
    {
      name: 'copy-src-assets',
      apply: 'build',
      closeBundle(error?: Error) {
        if (error) return;
        const dist = path.resolve(import.meta.dirname, 'dist');
        const src = path.resolve(import.meta.dirname, 'src/assets');
        if (fs.existsSync(dist) && fs.existsSync(src)) {
          fs.cpSync(src, path.join(dist, 'src/assets'), { recursive: true, force: true });
        }
      },
    },
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '.') } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('recharts') || id.includes('d3-')) return 'charts';
          if (id.includes('react-dom') || id.includes('react/')) return 'react';
        },
      },
    },
  },
  server: {
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
});
