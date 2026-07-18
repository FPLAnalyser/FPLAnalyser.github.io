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

// Dev only: serve site_data/* from the repo root (the Python pipeline owns that
// directory, so it stays at the root and can't live in public/). In production
// copySiteData() copies it into dist/.
function serveSiteData(): Plugin {
  return {
    name: 'serve-site-data',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url || '').split('?')[0])
        const rel = normalize(url).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '')
        if (rel.split(/[/\\]/)[0] !== 'site_data') return next()
        const abs = join(__dirname, rel)
        if (!abs.startsWith(__dirname) || !existsSync(abs) || !statSync(abs).isFile() || extname(abs) !== '.json') return next()
        res.setHeader('Content-Type', 'application/json')
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
    serveSiteData(),
    VitePWA({
      registerType: 'autoUpdate', // injects skipWaiting + clientsClaim for a clean takeover
      manifest: false, // public/manifest.webmanifest is hand-maintained
      workbox: {
        // Hashed assets are precached (immutable → effectively self-updating,
        // matching the legacy stale-while-revalidate intent).
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Serve instantly from cache and refresh in the background. The
            // pipeline updates site_data at most daily, and NetworkFirst's
            // wait-for-network made every page feel slow on mobile.
            urlPattern: /\/site_data\/.*\.json$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'site-data',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 7 },
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
