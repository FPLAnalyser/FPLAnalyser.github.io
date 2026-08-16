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
// Three layouts, because a thumbnail's job is to win a click at 210px wide and
// which approach does that is an empirical question, not a taste one.
//   headline  the claim              — "EVERY PLAYER, RATED."
//   number    the single figure      — the pick's xP, huge
//   question  the hook               — "WHO'S YOUR CAPTAIN?"
const variant = String(arg('variant', 'headline')).toLowerCase()
const headline = arg('text', null)
const outFile = arg('out', path.join(ROOT, 'build', 'video', `thumbnail-${variant}.png`))
if (!['headline', 'number', 'question'].includes(variant)) {
  throw new Error(`unknown variant "${variant}" (have: headline, number, question)`)
}

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

// The live captain pick, so a thumbnail promising a number states the real one.
const pick = await page.evaluate(() => {
  let label = null
  for (const el of document.querySelectorAll('div,span')) {
    if ((el.textContent || '').trim().toLowerCase() === 'the pick') { label = el; break }
  }
  if (!label) return null
  const card = label.closest('div')?.parentElement?.parentElement || label.parentElement
  // The player's name is simply the largest type on the card that is not the
  // xP figure — more robust than guessing at the element structure, which is
  // what the first attempt did, and it came back empty.
  let best = null
  for (const el of card.querySelectorAll('*')) {
    if (el.children.length) continue
    const t = (el.textContent || '').trim()
    if (!t || t.length > 26) continue
    if (/xp|£|·|the pick/i.test(t)) continue
    // The figure and its "xP" suffix are separate elements, so filtering on
    // "xP" alone leaves the bare number looking like the largest name on the
    // card — which is exactly what it picked first time round.
    if (/^[\d.,%+-]+$/.test(t)) continue
    const size = parseFloat(getComputedStyle(el).fontSize) || 0
    if (!best || size > best.size) best = { t, size }
  }
  const xp = /(\d+\.\d+)\s*xP/i.exec(card.textContent || '')
  return { player: best ? best.t : null, xp: xp ? xp[1] : null }
})

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

await page.evaluate(({ variant, headline, pick }) => {
  const GOLD = '#c9a227', GOLD_2 = '#ead188'
  const DISPLAY = "'Archivo Black', system-ui, sans-serif"
  const BODY = "'Manrope', system-ui, sans-serif"

  const wrap = document.createElement('div')
  wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;'

  const kicker = (text, extra = '') => `<div style="font-family:${BODY};font-weight:800;
    font-size:26px;letter-spacing:0.3em;text-transform:uppercase;color:${GOLD_2};
    text-shadow:0 2px 14px rgba(0,0,0,0.9);${extra}">${text}</div>`

  if (variant === 'headline') {
    // Scrim down the top half only, so the podium stays readable underneath.
    wrap.style.background =
      'linear-gradient(180deg, rgba(6,5,4,0.94) 0%, rgba(6,5,4,0.82) 32%, rgba(6,5,4,0) 52%)'
    const block = document.createElement('div')
    block.style.cssText = 'position:absolute;left:56px;top:40px;right:56px;'
    block.innerHTML = `
      <div style="font-family:${DISPLAY};font-size:92px;line-height:0.94;
        letter-spacing:-0.025em;color:#fff;text-shadow:0 6px 30px rgba(0,0,0,0.85);
        white-space:pre-line;">${headline || 'EVERY PLAYER,\nRATED.'}</div>
      ${kicker('FPL Analyser', 'margin-top:16px;')}`
    wrap.appendChild(block)
  }

  if (variant === 'number') {
    // The figure carries it. At 210px wide a number still reads; a sentence does not.
    // The figure has to sit wholly inside the scrim. At 230px it spilled onto
    // the lit cards behind and lost its edge.
    wrap.style.background =
      'linear-gradient(90deg, rgba(6,5,4,0.97) 0%, rgba(6,5,4,0.95) 52%, rgba(6,5,4,0.55) 72%, rgba(6,5,4,0.1) 100%)'
    const block = document.createElement('div')
    block.style.cssText = 'position:absolute;left:60px;top:50%;transform:translateY(-50%);width:60%;'
    block.innerHTML = `
      ${kicker('The captain pick')}
      <div style="font-family:${DISPLAY};font-size:172px;line-height:0.9;color:${GOLD};
        margin-top:6px;text-shadow:0 10px 40px rgba(0,0,0,0.8);">${pick?.xp || '6.45'}<span
        style="font-family:${BODY};font-size:54px;color:${GOLD_2};"> xP</span></div>
      <div style="font-family:${DISPLAY};font-size:64px;color:#fff;margin-top:2px;
        letter-spacing:-0.02em;text-shadow:0 4px 20px rgba(0,0,0,0.9);">${pick?.player || ''}</div>`
    wrap.appendChild(block)
  }

  if (variant === 'question') {
    wrap.style.background =
      'linear-gradient(180deg, rgba(6,5,4,0.95) 0%, rgba(6,5,4,0.88) 44%, rgba(6,5,4,0) 62%)'
    const block = document.createElement('div')
    block.style.cssText = 'position:absolute;left:56px;top:52px;right:56px;'
    block.innerHTML = `
      <div style="font-family:${DISPLAY};font-size:104px;line-height:0.94;color:#fff;
        letter-spacing:-0.03em;text-shadow:0 6px 30px rgba(0,0,0,0.85);
        white-space:pre-line;">${headline || "WHO'S YOUR\nCAPTAIN?"}</div>
      <div style="height:6px;width:300px;margin-top:22px;border-radius:3px;background:${GOLD};"></div>
      ${kicker('The model has an answer', 'margin-top:18px;')}`
    wrap.appendChild(block)
  }

  document.documentElement.appendChild(wrap)
}, { variant, headline, pick })

await mkdir(path.dirname(outFile), { recursive: true })
await page.screenshot({ path: outFile, type: 'png' })
await browser.close()
server.close()

const { size } = await import('node:fs').then((m) => m.promises.stat(outFile))
console.log(`${outFile}\n  1280x720 · ${(size / 1024).toFixed(0)} KB`)
if (size > 2 * 1024 * 1024) console.warn('  ** over YouTube\'s 2MB thumbnail limit **')
