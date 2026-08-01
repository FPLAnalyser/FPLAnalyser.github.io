import { chromium } from 'playwright-core'
const OUT='/tmp/claude-0/-home-user-fpl-analyser/06d19994-cc2f-5a9b-8817-7cd7ffff77d5/scratchpad/'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
for (const [mode, file] of [['dark','kits-dark'], ['light','kits-light']]) {
  const c = await b.newContext({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: 3 })
  const p = await c.newPage()
  await p.addInitScript((m) => { try { localStorage.setItem('fpl_mode', m) } catch {} }, mode)
  await p.goto('http://localhost:4203/#/preview', { waitUntil: 'networkidle' })
  await p.waitForFunction(() => !document.querySelector('.intro-lock'), null, {timeout:20000}).catch(()=>{})
  await p.waitForTimeout(2200)
  const r = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button[aria-label^="Share GW"]')]
      .find(b => /Man City v Bournemouth|MCI v BOU/i.test(b.getAttribute('aria-label')))
    if (!btn) return { none: true, labels: [...document.querySelectorAll('button[aria-label^="Share GW"]')].map(b=>b.getAttribute('aria-label')).slice(0,8) }
    const card = btn.closest('div[class*="rounded-xl"]') || btn.parentElement
    card.scrollIntoView({ block: 'center' })
    const x = card.getBoundingClientRect()
    return { x: x.left - 6, y: x.top - 6, width: x.width + 12, height: x.height + 12, label: btn.getAttribute('aria-label') }
  })
  if (r.none) { console.log(mode, 'not found. share labels:', JSON.stringify(r.labels)); await c.close(); continue }
  await p.waitForTimeout(400)
  await p.screenshot({ path: OUT + file + '.png', clip: { x: Math.max(0,r.x), y: Math.max(0,r.y), width: Math.min(r.width,1000), height: Math.min(r.height,600) } })
  console.log(mode, '→', r.label)
  await c.close()
}
await b.close()
