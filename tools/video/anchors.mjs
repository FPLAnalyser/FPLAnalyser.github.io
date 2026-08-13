import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:4173'
const route = process.argv[2] || '/#/preview'
const width = Number(process.argv[3] || 1280)
const height = Number(process.argv[4] || 720)

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const ctx = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
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
await page.goto(BASE + route, { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

const out = await page.evaluate(() => {
  const res = { total: document.scrollingElement.scrollHeight, sections: [] }
  const seen = new Set()
  document.querySelectorAll('h1,h2,h3,[class*="uppercase"]').forEach((e) => {
    const t = (e.textContent || '').trim()
    if (!t || t.length > 60 || seen.has(t)) return
    const r = e.getBoundingClientRect()
    const y = Math.round(r.top + window.scrollY)
    if (y < 0) return
    seen.add(t)
    res.sections.push({ y, tag: e.tagName, text: t })
  })
  res.sections.sort((a, b) => a.y - b.y)
  return res
})

console.log(`route=${route} viewport=${width}x${height} totalHeight=${out.total}`)
for (const s of out.sections) console.log(`  y=${String(s.y).padStart(5)}  ${s.tag.padEnd(4)} ${s.text}`)

await browser.close()
