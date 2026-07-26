import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

/**
 * The admin dashboard is a SEPARATE Vite app from the prayer-times SPA.
 *
 * Why separate rather than a route inside the SPA: capacitor.config.ts sets
 * `webDir: "dist"`, so everything in the SPA build is packaged into the Android
 * APK. Building the dashboard into its own `dist-admin` keeps operator code out
 * of a distributable app, and keeps the two UIs' very different conventions
 * (Arabic/RTL/four themes vs English/LTR/one dark theme) from bleeding.
 *
 * Note the absent `reusedEngineResolver()` — the admin bundle has no business
 * touching the prayer engine, and leaving the plugin out makes that structural
 * rather than a rule someone has to remember.
 */
export default defineConfig({
  root: path.resolve(__dirname, 'admin'),
  // Served by Express at /admin from ./static-admin (see server/src/app.ts).
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Pure helpers from the app are reusable; src/native/** is NOT (hard rule 3).
      '@': path.resolve(__dirname, 'src'),
      '@admin': path.resolve(__dirname, 'admin'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist-admin'),
    emptyOutDir: true,
    // One operator on a good connection: readable stack traces beat bytes.
    sourcemap: true,
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
