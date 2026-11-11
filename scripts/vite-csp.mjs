import { createHash } from 'crypto'

/**
 * Production Content-Security-Policy (G-15), shared by the desktop build (electron.vite.config.mjs)
 * and the browser build (vite.web.config.mjs). Development needs 'unsafe-eval', inline scripts and
 * the HMR websocket (React Fast Refresh); the built app needs none of them. The one inline script
 * (theme before first paint) is allowed by its SHA-256 hash instead of 'unsafe-inline'.
 */
export function productionCsp() {
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
