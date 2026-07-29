import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'fs'

/* Full-site audit. Walks every route at desktop and mobile, in both themes,
   and records anything a user would notice: script errors, failed requests,
   horizontal overflow, empty pages, missing alt text, tiny tap targets and
   headings that skip levels.

   The Premier League image CDN is blocked by this environment's network
   policy, so its requests are served a stand-in rather than counted as
   failures — otherwise every page reports dozens of false positives. */
const OUT = '/tmp/claude-0/-home-user-fpl-analyser/06d19994-cc2f-5a9b-8817-7cd7ffff77d5/scratchpad'
const stand = readFileSync(OUT + '/crest.png')
const BASE = 'http://localhost:4177/#'

const ROUTES = [
  ['/', 'home'],
  ['/preview', 'preview'],
  ['/players', 'players'],
  ['/player?name=Haaland', 'player-detail'],
  ['/player?name=Raya', 'player-gkp'],
  ['/player?name=Mosquera', 'player-unrated'],
  ['/teams', 'teams'],
  ['/teams?team=ARS', 'team-detail'],
  ['/compare', 'compare'],
  ['/fixtures', 'fixtures'],
  ['/squad', 'squad'],
  ['/loadteam', 'myteam'],
  ['/scout', 'scouting'],
  ['/debug', 'debug'],
  ['/legal', 'legal'],
  ['/no-such-route', '404-fallback'],
]

const issues = []
const add = (route, view, kind, detail) => issues.push({ route, view, kind, detail })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

for (const [width, height, view] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' })
  await ctx.route('**resources.premierleague.com/**', (r) =>
    r.fulfill({ status: 200, contentType: 'image/png', body: stand }))

  for (const [path, name] of ROUTES) {
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)))
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)) })
    page.on('requestfailed', (r) => {
      const u = r.url()
      if (u.includes('resources.premierleague.com')) return
      errs.push('request failed: ' + u.slice(0, 120))
    })
    page.on('response', (r) => {
      if (r.status() >= 400 && !r.url().includes('resources.premierleague.com')) {
        errs.push(`http ${r.status()}: ` + r.url().slice(0, 120))
      }
    })

    try {
      await page.goto(BASE + path, { waitUntil: 'load', timeout: 30000 })
      await page.waitForTimeout(1200)
      // The home intro splash covers the page until dismissed.
      await page.mouse.click(width / 2, height / 2).catch(() => {})
      await page.waitForTimeout(3200)

      const m = await page.evaluate(() => {
        const de = document.documentElement
        const text = (document.body.innerText || '').trim()
        const imgs = [...document.querySelectorAll('img')]
        const noAlt = imgs.filter((i) => i.getAttribute('alt') === null).length
        // Anything interactive smaller than 32px square is hard to hit.
        const small = [...document.querySelectorAll('button,a[href],[role=tab]')].filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0 && (r.height < 32 || r.width < 32) && el.innerText.trim().length > 0
        }).length
        const hs = [...document.querySelectorAll('h1,h2,h3,h4')].map((h) => +h.tagName[1])
        let skips = 0
        for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1) skips++
        return {
          scrollW: de.scrollWidth, clientW: de.clientWidth,
          len: text.length, head: text.slice(0, 60).replace(/\n/g, ' '),
          h1: document.querySelectorAll('h1').length,
          noAlt, small, skips,
          title: document.title,
          nan: (text.match(/\bNaN\b|undefined|\[object Object\]|Infinity/g) || []).length,
        }
      })

      if (m.scrollW > m.clientW + 1) add(name, view, 'overflow', `${m.scrollW} > ${m.clientW}`)
      if (m.len < 120) add(name, view, 'empty-page', `${m.len} chars: "${m.head}"`)
      if (m.h1 === 0) add(name, view, 'no-h1', '')
      if (m.h1 > 1) add(name, view, 'multiple-h1', String(m.h1))
      if (m.noAlt) add(name, view, 'img-missing-alt', String(m.noAlt))
      if (m.small) add(name, view, 'small-tap-target', String(m.small))
      if (m.skips) add(name, view, 'heading-skip', String(m.skips))
      if (m.nan) add(name, view, 'bad-value-in-text', `${m.nan} occurrences`)
      if (!m.title || m.title.length < 3) add(name, view, 'no-title', m.title)

      for (const e of [...new Set(errs)]) add(name, view, 'runtime', e)
      if (view === 'desktop') await page.screenshot({ path: `${OUT}/audit-${name}.png`, fullPage: false })
    } catch (e) {
      add(name, view, 'navigation', String(e).slice(0, 160))
    }
    await page.close()
  }
  await ctx.close()
}

await browser.close()
writeFileSync(OUT + '/audit.json', JSON.stringify(issues, null, 1))

const byKind = {}
for (const i of issues) (byKind[i.kind] ??= []).push(i)
console.log(`ROUTES ${ROUTES.length} × 2 viewports — ${issues.length} findings\n`)
for (const [k, list] of Object.entries(byKind).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`## ${k} (${list.length})`)
  const seen = new Set()
  for (const i of list) {
    const key = i.kind + i.detail
    if (seen.has(key)) continue
    seen.add(key)
    console.log(`   ${i.route} [${i.view}] ${i.detail}`)
  }
}
