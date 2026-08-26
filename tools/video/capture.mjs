/**
 * Capture stage for the launch video.
 *
 * Drives the *built* site in Chromium and writes two things to tools/video/plates:
 *   - full-page PNG "plates" at 2x, one per route, used as image layers
 *   - plates.json: measured element rects (page coords, CSS px) + the real
 *     figures read straight off the rendered DOM
 *
 * Reading the figures off the DOM rather than recomputing them from site_data
 * is deliberate: the site is the source of truth for its own numbers, and
 * re-deriving them here would be a second implementation to drift from it.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'plates')
const ORIGIN = process.env.VIDEO_ORIGIN || 'http://127.0.0.1:4179'
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const VIEWPORT = { width: 1440, height: 900 }
const SCALE = 2

fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--force-color-profile=srgb', '--font-render-hinting=none', '--hide-scrollbars'],
})
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE })
const page = await ctx.newPage()

/** Scroll the whole page once so lazy images/charts commit, then return to top. */
async function settle(ms = 4000) {
  await page.waitForTimeout(ms)
  await page.evaluate(async () => {
    const h = document.body.scrollHeight
    for (let y = 0; y < h; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 90)) }
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(1200)
  await page.evaluate(() => document.fonts.ready)
}

async function open(route) {
  await page.goto(`${ORIGIN}/#/${route}`, { waitUntil: 'networkidle', timeout: 90000 })
  await settle()
}

async function recordHeight(name) {
  pageHeights[name] = await page.evaluate(() => ({
    w: document.documentElement.clientWidth,
    h: document.body.scrollHeight,
  }))
}

const meta = {}
const pageHeights = {}

const rects = () => page.evaluate(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect()
    return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height } }
  const table = document.querySelector('table')
  return {
    table: box(table),
    thead: box(table?.querySelector('thead')),
    rows: [...document.querySelectorAll('tbody tr')].map(box),
  }
})

// ---------------------------------------------------------------- players
await open('players')
await recordHeight('players')
await page.screenshot({ path: path.join(OUT, 'players.png'), fullPage: true })
meta.players = {
  ...(await rects()),
  figures: await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')].slice(0, 8).map((tr) => {
      const c = [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())
      return { rank: c[0], name: c[1], pos: c[2], team: c[3], price: c[4], rating: c[5] }
    })
    const lede = document.querySelector('table')
      ?.closest('div')?.parentElement?.textContent?.match(/leads the overall ratings[^.]*\./)?.[0] ?? null
    return { rows, lede, shown: document.querySelectorAll('tbody tr').length }
  }),
}

// --------------------------------------------------------------- fixtures
await open('fixtures')
await recordHeight('fixtures')
await page.screenshot({ path: path.join(OUT, 'fixtures.png'), fullPage: true })
meta.fixtures = {
  ...(await rects()),
  figures: await page.evaluate(() => ({
    window: document.body.textContent.match(/GW\d+–GW\d+/)?.[0] ?? null,
    teams: [...document.querySelectorAll('tbody tr')].slice(0, 6)
      .map((tr) => tr.querySelector('td')?.textContent.trim()),
  })),
}

// ---------------------------------------------------------------- preview
await open('preview')
await recordHeight('preview')
await page.screenshot({ path: path.join(OUT, 'preview.png'), fullPage: true })
meta.preview = {
  sections: await page.evaluate(() => {
    const out = {}
    const box = (el) => { const r = el.getBoundingClientRect()
      return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height } }
    for (const h of document.querySelectorAll('h2,h3')) {
      const key = h.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
      let n = h.parentElement
      while (n && (n.getBoundingClientRect().width < 1000 || n.getBoundingClientRect().height < 80)) n = n.parentElement
      if (n && !out[key]) out[key] = box(n)
    }
    return out
  }),
  figures: await page.evaluate(() => {
    const t = document.body.textContent
    return {
      gw: t.match(/GW(\d+) PREVIEW/i)?.[1] ?? t.match(/GW(\d+) DEADLINE/i)?.[1] ?? null,
      deadline: t.match(/GW\d+ DEADLINE\s*(.+?at\s*\d{2}:\d{2})/i)?.[1]?.trim() ?? null,
      captains: [...document.querySelectorAll('*')]
        .filter((e) => e.children.length === 0 && /^the (pick|challenger|outsider)$/i.test(e.textContent.trim()))
        .map((e) => {
          let card = e.parentElement
          while (card && card.getBoundingClientRect().height < 100) card = card.parentElement
          const txt = card.textContent
          const r = card.getBoundingClientRect()
          return {
            slot: e.textContent.trim(),
            name: txt.replace(/^the (pick|challenger|outsider)/i, '').match(/^([A-Za-zÀ-ÿ.\-' ]+?)(?=MID|DEF|FWD|GKP)/)?.[1]?.trim() ?? null,
            detail: txt.match(/(MID|DEF|FWD|GKP)\s*·[^·]*·\s*£[\d.]+m/)?.[0] ?? null,
            xp: txt.match(/(\d+\.\d+)xP/)?.[1] ?? null,
            rect: { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height },
          }
        }),
    }
  }),
}

// ------------------------------------------------------------------ squad
await page.goto(`${ORIGIN}/#/squad`, { waitUntil: 'networkidle', timeout: 90000 })
await page.waitForTimeout(4000)
const auto = page.getByRole('button', { name: /auto pick/i })
if (await auto.count()) { await auto.first().click(); await page.waitForTimeout(4000) }
await settle(2000)
await recordHeight('squad')
await page.screenshot({ path: path.join(OUT, 'squad.png'), fullPage: true })
meta.squad = {
  sections: await page.evaluate(() => {
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect()
      return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height } }
    // The pitch is the tallest green-ish block on the left column.
    const pitch = [...document.querySelectorAll('div')]
      .filter((d) => d.getBoundingClientRect().height > 400 && d.getBoundingClientRect().width > 500
                  && /rgb\(|gradient/.test(getComputedStyle(d).background) && d.getBoundingClientRect().x < 800)
      .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0]
    let plan = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^your season$/i.test(e.textContent.trim()))
    while (plan && (plan.getBoundingClientRect().height < 200 || plan.getBoundingClientRect().width < 1000)) plan = plan.parentElement
    return { pitch: box(pitch), plan: box(plan) }
  }),
  figures: await page.evaluate(() => {
    const t = document.body.textContent
    return {
      xp: t.match(/([\d.]+)\s*\/\s*(\d+)\s*weekly rating/)?.[1] ?? null,
      weeklyRating: t.match(/([\d.]+)\s*\/\s*(\d+)\s*weekly rating/)?.[2] ?? null,
      squadRating: t.match(/(\d+)\s*SQUAD RATING/i)?.[1] ?? null,
      bank: t.match(/(£[\d.]+m)\s*IN THE BANK/i)?.[1] ?? null,
      picked: t.match(/\b(\d{1,2})\/15\b/)?.[0] ?? null,
    }
  }),
}

// ------------------------------------------------------------------- home
await open('')
await recordHeight('home')
await page.screenshot({ path: path.join(OUT, 'home.png'), fullPage: true })
meta.home = {
  figures: await page.evaluate(() => ({
    h1: document.querySelector('h1')?.textContent?.trim() ?? null,
  })),
}

meta.viewport = VIEWPORT
meta.scale = SCALE
// Page height in CSS px, so the composition can map measured rects onto the plate.
meta.pageHeights = pageHeights

fs.writeFileSync(path.join(OUT, 'plates.json'), JSON.stringify(meta, null, 2))
console.log('captured ->', OUT)
console.log(JSON.stringify({
  topRows: meta.players.figures.rows.slice(0, 4),
  captains: meta.preview.figures.captains,
  gw: meta.preview.figures.gw,
  squad: meta.squad.figures,
}, null, 1))
await browser.close()
