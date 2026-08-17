#!/usr/bin/env node
// Clean product screenshots for a post, from the built site.
//
//   npm run build && node tools/social/screens.mjs
//
// Not video stills. render.mjs burns a caption and a pointer into every frame,
// which is right for a video and wrong here — in a thread the tweet above the
// image is already the caption, and a second one inside the picture reads as a
// screenshot of a video rather than of the product.
//
// The framings are the ones the planner cut already proved legible: same
// anchors, same zooms, same reasons. A shot is one viewport at 1440x810, which
// is 16:9 exactly, so nothing is cropped by the timeline.

import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPlan } from '../video/shots.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DIST = path.join(ROOT, 'dist')
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1] }
const outDir = arg('out', path.join(ROOT, 'build', 'social', 'shots'))
// 2x so the image survives being opened full-screen on a phone. X re-encodes
// anything larger without adding detail.
const scale = Number(arg('scale', 2))

if (!existsSync(DIST)) throw new Error('dist/ missing — run `npm run build` first')

/**
 * What each shot frames, and why.
 *
 *  scroll  anchor text + offset, resolved against the live page like the video
 *          shots are — a data refresh moves pixel offsets and does not move
 *          headings
 *  zoom    magnification and the element it magnifies around, as a fixed point
 *  ox      pins the horizontal origin; without it a hard zoom to the right of
 *          the grid drags the sticky name column out of frame
 *  before  clicks to make first
 */
const SHOTS = {
  // The hero: plan switcher, card and grid in one frame. Anchored to put the
  // page top at the very top of the shot — the site's nav is sticky and about
  // seventy pixels deep, so anything that scrolls the card header up to meet
  // it half-hides the header behind the nav and reads as a rendering bug.
  planner: {
    scroll: { text: 'Your season', offset: -254 },
  },
  // The bars, close enough to read the chip badge and the fixture strip.
  bars: {
    scroll: { text: 'GW2', offset: -421 },
    zoom: { to: 1.9, at: 'GW2' },
  },
  // The same twelve weeks re-read as defensive contribution, crests on. The
  // one that shows the grid is a lens, not a fixed table.
  metrics: {
    scroll: { text: 'Your season', offset: -70 },
    before: [{ role: 'button', name: 'DC%' }],
  },
  // The transfer seams, with the name column held in shot — a coloured edge
  // with no name beside it is a decoration rather than a decision.
  //
  // Explicitly back to Fix first. Mode is component state that survives
  // between shots, so without this the seams are read against whatever metric
  // the previous shot selected, and a caption about red-out/green-in lands
  // over a grid of percentages.
  transfers: {
    scroll: { contains: '◂', offset: -223 },
    zoom: { to: 2.2, at: { contains: '◂' }, ox: 44 },
    before: [{ role: 'button', name: 'Fix' }],
  },
  // What could go wrong with the plan, which is the half of the product the
  // bars do not show.
  risk: {
    scroll: { text: 'Analysis', offset: -90 },
    before: [{ role: 'tab', name: 'Risk' }],
  },
}

// ---------------------------------------------------------------- server

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
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

// ---------------------------------------------------------------- page

/**
 * Where an element is, matched the way the video shots match it.
 *
 * `text` takes the tightest exact-or-prefix match; `contains` takes the first
 * INNERMOST match, because every ancestor up to <html> contains the string too
 * and the first of those is the whole page.
 */
function findBox({ text, contains }) {
  const want = String(contains ?? text).trim().toLowerCase()
  let best = null
  for (const el of document.querySelectorAll('h1,h2,h3,h4,div,span,section,button,a,p')) {
    const t = (el.textContent || '').trim().toLowerCase()
    if (!t) continue
    const hit = contains ? t.includes(want) : (t === want || t.startsWith(want))
    if (!hit) continue
    if (contains && [...el.children].some((c) => (c.textContent || '').toLowerCase().includes(want))) continue
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    if (best && (contains || t.length >= best.len)) continue
    best = {
      top: Math.round(r.top + window.scrollY),
      cx: Math.round(r.left + r.width / 2 + window.scrollX),
      cy: Math.round(r.top + r.height / 2 + window.scrollY),
      len: t.length,
    }
  }
  return best
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--force-color-profile=srgb', '--hide-scrollbars', '--disable-lcd-text'],
})
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 810 },
  deviceScaleFactor: scale,
  colorScheme: 'dark',
  // The site's own static-render path: counters at their final value, no
  // reveal animation caught halfway.
  reducedMotion: 'reduce',
})
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('fpl_mode', 'dark')
    localStorage.setItem('fpl_onboarded', '1')
    localStorage.setItem('fpl_cover_seen_gw', '999')
    sessionStorage.setItem('fpl_intro_seen', '1')
  } catch { /* private mode */ }
})

const page = await ctx.newPage()
await page.goto(`${BASE}/#/squad`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)
await buildPlan(page)

await mkdir(outDir, { recursive: true })

for (const [name, spec] of Object.entries(SHOTS)) {
  // Every shot starts from the same state, so one shot's toggle or tab does
  // not silently become the next one's starting position.
  await page.evaluate(() => {
    document.body.style.transform = ''
    document.body.style.transformOrigin = ''
  })
  for (const click of spec.before || []) {
    await page.getByRole(click.role, { name: click.name, exact: true }).first().click()
    await page.waitForTimeout(700)
  }

  const box = await page.evaluate(findBox, spec.scroll)
  if (box === null) throw new Error(`${name}: anchor not found — "${spec.scroll.text ?? spec.scroll.contains}"`)
  const y = Math.max(0, box.top + (spec.scroll.offset || 0))

  if (spec.zoom) {
    const at = typeof spec.zoom.at === 'string' ? { text: spec.zoom.at } : spec.zoom.at
    const origin = await page.evaluate(findBox, at)
    if (origin === null) throw new Error(`${name}: zoom target not found`)
    await page.evaluate(({ ox, oy, k }) => {
      // Scaling <body> re-rasterises at the new size, so type stays sharp;
      // cropping a page-scale screenshot would magnify finished pixels.
      document.body.style.transformOrigin = `${ox}px ${oy}px`
      document.body.style.transform = `scale(${k})`
    }, { ox: spec.zoom.ox ?? origin.cx, oy: origin.cy, k: spec.zoom.to })
  }

  await page.evaluate((to) => window.scrollTo(0, to), y)
  await page.waitForTimeout(500)
  const file = path.join(outDir, `planner-${name}.png`)
  await page.screenshot({ path: file })
  console.log(`  ${name.padEnd(10)} y=${y}${spec.zoom ? ` zoom=${spec.zoom.to}` : ''}  ${file}`)
}

await browser.close()
server.close()
