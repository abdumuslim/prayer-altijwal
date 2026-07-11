import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'

// Browser-only shims for the REUSED server sources (hard rule 2 — imported
// verbatim, never copied/edited). Only the native-only offline chunk reaches them.
const IRAQ_BROWSER = path.resolve(__dirname, 'src/native/iraq-calibration-browser.ts')
const NODE_MODULE_SHIM = path.resolve(__dirname, 'src/native/node-module-shim.ts')

const norm = (p: string) => p.replace(/\\/g, '/')

/**
 * Resolves the reused prayer engine + wrappers for the browser build without
 * editing them (docs/NATIVE_ALARM_SPEC.md §3b). One place handles:
 *   - the @prayer-engine/* and @prayer/* aliases → server sources,
 *   - the engine's `node:module` → the astronomy-engine shim (astro.ts only),
 *   - the wrappers' `./iraq-calibration.js` → the browser calibration variant,
 *   - `.js` import specifiers → their real `.ts` source (NodeNext convention).
 */
function reusedEngineResolver() {
  return {
    name: 'reused-engine-resolver',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined) {
      // node:module → browser shim, but ONLY for the engine's astro.ts (never
      // for vitest/vite internals that legitimately use node builtins).
      if (source === 'node:module' && importer && norm(importer).includes('/server/src/prayer-engine/')) {
        return NODE_MODULE_SHIM
      }

      // Only act on relative imports that resolve INTO the reused server tree
      // (either internal engine/wrapper imports, or the native chunk reaching in).
      if (!importer || (!source.startsWith('./') && !source.startsWith('../'))) return null
      const abs = path.resolve(path.dirname(importer), source)
      const a = norm(abs)
      if (!a.includes('/server/src/') && !a.includes('/server/data/')) return null
      // Redirect the reused wrappers' calibration loader to the browser variant.
      if (/\/iraq-calibration\.js$/.test(a)) return IRAQ_BROWSER
      // Map a `.js` specifier to its real `.ts` source.
      if (a.endsWith('.js')) {
        const ts = a.slice(0, -3) + '.ts'
        if (fs.existsSync(ts)) return ts
      }
      if (fs.existsSync(a)) return a
      return null
    },
  }
}

export default defineConfig({
  plugins: [reusedEngineResolver(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
    },
    fs: {
      // Allow importing the reused server sources + generated calibration JSON.
      allow: [path.resolve(__dirname, '..')],
    },
  },
  test: {
    // Offline compute is pure JS (no DOM); node env keeps the parity test fast.
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
