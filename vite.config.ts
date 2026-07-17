import { createReadStream, cpSync, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, type Plugin } from 'vite'

// site_data/ is written by the Python pipeline at the repo root and fetched at
// runtime; it must ship alongside the built app without being bundled.
function copySiteData(): Plugin {
  return {
    name: 'copy-site-data',
    apply: 'build',
    closeBundle() {
      const src = resolve(__dirname, 'site_data')
      if (existsSync(src)) {
        cpSync(src, resolve(__dirname, 'dist/site_data'), { recursive: true })
      }
    },
  }
}

// Dev only: serve the repo-root assets the Python pipeline owns (site_data/*)
// and the legacy static assets (logo.png, icons/, manifest) that don't move to
// public/ until the Phase 7 cutover. In production these are copied to dist/.
const MIME: Record<string, string> = {
  '.json': 'application/json',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}
function serveRootAssets(): Plugin {
  const roots = ['site_data', 'icons']
  const files = ['logo.png', 'manifest.webmanifest']
  return {
    name: 'serve-root-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url || '').split('?')[0])
        const rel = normalize(url).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '')
        const top = rel.split(/[/\\]/)[0]
        if (!roots.includes(top) && !files.includes(rel)) return next()
        const abs = join(__dirname, rel)
        if (!abs.startsWith(__dirname) || !existsSync(abs) || !statSync(abs).isFile()) return next()
        res.setHeader('Content-Type', MIME[extname(abs)] || 'application/octet-stream')
        createReadStream(abs).pipe(res)
      })
    },
  }
}

export default defineConfig({
  // Relative base: works on GitHub Pages project sub-paths and in a Capacitor webview.
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    copySiteData(),
    serveRootAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false, // manifest.webmanifest is hand-maintained
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Same strategy as the legacy service worker: fresh data when
            // online, last-known data when offline.
            urlPattern: /\/site_data\/.*\.json$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'site-data',
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2020',
  },
})
