import { resolve } from 'path'
import { createHash } from 'crypto'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * Production Content-Security-Policy (G-15). Development needs 'unsafe-eval', inline scripts and the
 * HMR websocket (React Fast Refresh); the built app needs none of them. The one inline script (theme
 * before first paint) is allowed by its SHA-256 hash instead of 'unsafe-inline'.
 */
function productionCsp() {
  return {
    name: 'heromarket-production-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
          (m) => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`
        )
        const out = html
          .replace(/script-src [^;"]*/, `script-src 'self' ${hashes.join(' ')}`)
          .replace(/connect-src 'self' ws:\/\/localhost:\*/, "connect-src 'self'")
        if (/unsafe-eval|ws:\/\/localhost/.test(out)) throw new Error('production CSP not applied')
        return out
      }
    }
  }
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), productionCsp()]
  }
})
