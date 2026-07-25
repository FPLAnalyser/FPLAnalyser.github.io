import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await b.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme: 'dark' })
p.on('console', (m) => { if (m.type() === 'error' || m.text().includes('html2canvas')) console.log('CONSOLE:', m.text().slice(0, 220)) })
p.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)))
await p.goto('http://localhost:4600/#/players', { waitUntil: 'networkidle' })
await p.waitForSelector('text=Top Rated', { timeout: 40000 }).catch(() => {})
await p.waitForTimeout(1200)
// Capture a table panel directly with html2canvas and report pixel stats
const res = await p.evaluate(async () => {
  const el = document.querySelector('table')?.closest('div')
  if (!el) return { err: 'no panel' }
  const mod = await import('/assets/' + [...document.querySelectorAll('script')].map(s=>s.src).join(' ').match(/index-[^"]+\.js/)?.[0] ?? '')
    .catch(() => null)
  return { ok: !!el, tag: el.tagName, w: el.clientWidth, h: el.clientHeight, mod: !!mod }
})
console.log('panel:', JSON.stringify(res))
// Now click the real Share button and download
const share = p.locator('button', { hasText: 'Share' }).first()
await share.click(); await p.waitForTimeout(400)
const dl = p.waitForEvent('download', { timeout: 30000 }).catch(() => null)
await p.locator('button', { hasText: 'Download PNG' }).first().click()
const d = await dl
if (d) {
  const path = '/tmp/claude-0/-home-user-fpl-analyser/06d19994-cc2f-5a9b-8817-7cd7ffff77d5/scratchpad/share-test.png'
  await d.saveAs(path)
  console.log('saved', path)
} else console.log('NO DOWNLOAD EVENT')
await p.waitForTimeout(800)
await b.close()
