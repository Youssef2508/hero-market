import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { productionCsp } from './scripts/vite-csp.mjs'

// The browser build of the same screens (Phase 2 milestone 2, D-101): `npm run build:web` writes
// out/web, which the cloud serves (HEROMARKET_WEB_ROOT). There is no second application: the entry,
// the screens and the styles are the desktop's; src/renderer/src/lib/webBridge.js stands in for
// the desktop's preload bridge.
//   npm run dev:web   the pages with hot reload; /api goes to a cloud on 127.0.0.1:8787
export default defineConfig({
  root: resolve('src/renderer'),
  base: '/',
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  plugins: [react(), productionCsp()],
  build: {
    outDir: resolve('out/web'),
    emptyOutDir: true
  },
  server: {
    port: 5180,
    proxy: { '/api': 'http://127.0.0.1:8787' }
  }
})
