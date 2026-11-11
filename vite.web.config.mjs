import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { productionCsp } from './scripts/vite-csp.mjs'

// The browser build of the same screens (Phase 2 milestone 2, D-101): `npm run build:web` writes
// out/web, which the cloud serves (HEROMARKET_WEB_ROOT). There is no second application: the entry,
// the screens and the styles are the desktop's; src/renderer/src/lib/webBridge.js stands in for
// the desktop's preload bridge.
//   npm run dev:web   the pages with hot reload; /api goes to a cloud on 127.0.0.1:8787

/**
 * Installing to a phone's home screen: a web app manifest with the brand icons, and the tags that
 * point to it. Only the browser build has them; the desktop build is unchanged. Nothing is cached
 * for working without a connection: the internet way in always needs the cloud.
 */
function installable() {
  const manifest = {
    name: 'HeroMarket',
    short_name: 'HeroMarket',
    lang: 'ar',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f4f6f4',
    theme_color: '#0f3d33',
    icons: [
      { src: '/icon-256.png', sizes: '256x256', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ]
  }
  const icon = (size) => readFileSync(resolve(`resources/brand/png/heromarket-mark-${size}.png`))
  return {
    name: 'heromarket-installable',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: JSON.stringify(manifest, null, 2)
      })
      this.emitFile({ type: 'asset', fileName: 'icon-256.png', source: icon(256) })
      this.emitFile({ type: 'asset', fileName: 'icon-512.png', source: icon(512) })
    },
    transformIndexHtml(html) {
      return html.replace(
        '</head>',
        `    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="${manifest.theme_color}" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="HeroMarket" />
    <link rel="apple-touch-icon" href="/icon-256.png" />
  </head>`
      )
    }
  }
}

export default defineConfig({
  root: resolve('src/renderer'),
  base: '/',
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  plugins: [react(), installable(), productionCsp()],
  build: {
    outDir: resolve('out/web'),
    emptyOutDir: true
  },
  server: {
    port: 5180,
    proxy: { '/api': 'http://127.0.0.1:8787' }
  }
})
