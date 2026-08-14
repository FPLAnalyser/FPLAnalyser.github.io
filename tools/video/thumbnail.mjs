#!/usr/bin/env node
// Renders the YouTube thumbnail from the live captain podium.
//
//   node tools/video/thumbnail.mjs [--text "THE CAPTAIN PICK"]
//
// docs/LAUNCH.md is right that the podium is the strongest still the site
// produces — gold foil, a face, a number. This frames it at 1280x720 and lays a
// headline over the empty half, sized to survive being shrunk to a 210px card.

import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DIST = path.join(ROOT, 'dist')
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1] }
const headline = arg('text', 'EVERY PLAYER,\nRATED.')
const outFile = arg('out', path.join(ROOT, 'build', 'video', 'thumbnail.png'))

if (!existsSync(DIST)) throw new Error('dist/ missing — run `npm run build` first')

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
}
const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url || '/').split('?')[0])
    let file = path.join(DIST, url)
    if (url.endsWith('/')) file = path.join(file, 'index.html')
    if (!file.startsWith(DIST)) { res.writeHead(403).end(); return }
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch { res.writeHead(404).end('not found') }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch({ executablePath: CHROME, args: ['--hide-scrollbars'] })
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
  reducedMotion: 'reduce',
})
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('fpl_mode', 'dark')
    localStorage.setItem('fpl_onboarded', '1')
    localStorage.setItem('fpl_cover_seen_gw', '999')
    sessionStorage.setItem('fpl_intro_seen', '1')
  } catch { /* ignore */ }
})
const page = await ctx.newPage()
await page.goto(`${BASE}/#/preview`, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts?.ready).catch(() => {})
await page.waitForTimeout(2500)

// Put the podium in the lower half, leaving the top clear for the headline.
const y = await page.evaluate(() => {
  for (const el of document.querySelectorAll('h2')) {
    if ((el.textContent || '').trim().toLowerCase() === 'captain') {
      // Leaves the top third clear for the headline block.
      return Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY) - 300)
    }
  }
  return null
})
if (y === null) throw new Error('captain podium not found on /#/preview')
await page.evaluate((v) => window.scrollTo(0, v), y)
await page.waitForTimeout(400)

await page.evaluate((text) => {
  const wrap = document.createElement('div')
  wrap.style.cssText = `position:fixed;inset:0;z-index:2147483647;pointer-events:none;
    background:linear-gradient(180deg, rgba(6,5,4,0.94) 0%, rgba(6,5,4,0.82) 32%, rgba(6,5,4,0) 52%);`
  // Stacked in normal flow rather than absolutely positioned, so the kicker
  // cannot drift onto the podium when the headline wraps to a different number
  // of lines.
  const block = document.createElement('div')
  block.style.cssText = `position:absolute;left:56px;top:40px;right:56px;`

  const h = document.createElement('div')
  h.style.cssText = `font-family:'Archivo Black',system-ui,sans-serif;font-size:92px;
    line-height:0.94;letter-spacing:-0.025em;color:#fff;
    text-shadow:0 6px 30px rgba(0,0,0,0.85);white-space:pre-line;`
  h.textContent = text

  const kicker = document.createElement('div')
  kicker.style.cssText = `margin-top:16px;
    font-family:'Manrope',system-ui,sans-serif;font-size:26px;font-weight:800;
    letter-spacing:0.3em;text-transform:uppercase;color:#c9a227;
    text-shadow:0 2px 14px rgba(0,0,0,0.9);`
  kicker.textContent = 'FPL Analyser'

  block.append(h, kicker)
  wrap.append(block)
  document.documentElement.appendChild(wrap)
}, headline)

await mkdir(path.dirname(outFile), { recursive: true })
await page.screenshot({ path: outFile, type: 'png' })
await browser.close()
server.close()

const { size } = await import('node:fs').then((m) => m.promises.stat(outFile))
console.log(`${outFile}\n  1280x720 · ${(size / 1024).toFixed(0)} KB`)
if (size > 2 * 1024 * 1024) console.warn('  ** over YouTube\'s 2MB thumbnail limit **')
