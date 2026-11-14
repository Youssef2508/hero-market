import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { productionCsp } from './scripts/vite-csp.mjs'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: [
        { find: '@renderer', replacement: resolve('src/renderer/src') },
        // The Excel libraries' zip and unzip without a Worker (src/renderer/src/lib/fflateMainThread.js).
        { find: /^fflate$/, replacement: resolve('src/renderer/src/lib/fflateMainThread.js') }
      ]
    },
    plugins: [react(), productionCsp()]
  }
})
