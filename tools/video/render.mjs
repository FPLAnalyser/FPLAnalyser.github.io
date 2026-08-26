/**
 * Render stage: steps the composition frame by frame in Chromium and pipes the
 * PNGs straight into ffmpeg. Frames are never written to disk — a 3600-frame
 * 1080p render is ~1GB of PNG that nobody needs.
 *
 *   node tools/video/render.mjs                  # full film -> tools/video/out
 *   node tools/video/render.mjs --sheet          # contact sheet of key frames
 *   node tools/video/render.mjs --from 9 --to 18 # seconds, for iterating
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FFMPEG } from './ffmpeg.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'out')
const ORIGIN = process.env.VIDEO_ORIGIN || 'http://127.0.0.1:4179'
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'


const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? Number(argv[i + 1]) : d }

fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--force-color-profile=srgb', '--font-render-hinting=none',
         '--hide-scrollbars', '--disable-lcd-text'],
})
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message))
await page.goto(`${ORIGIN}/tools/video/composition/index.html`, { waitUntil: 'networkidle', timeout: 90000 })
await page.waitForFunction(() => document.documentElement.dataset.ready === '1', { timeout: 90000 })

const FPS = await page.evaluate(() => window.__FPS)
const TOTAL = await page.evaluate(() => window.__TOTAL)

async function shot(f) {
  await page.evaluate((n) => window.__setFrame(n), f)
  return page.screenshot({ type: 'png' })
}

if (flag('--at')) {
  // Specific timestamps at full resolution, for judging a beat properly.
  const dir = path.join(OUT, 'at')
  fs.mkdirSync(dir, { recursive: true })
  const times = String(argv[argv.indexOf('--at') + 1]).split(',').map(Number)
  for (const s of times) {
    fs.writeFileSync(path.join(dir, `t${String(s).replace('.', '_')}.png`), await shot(Math.round(s * FPS)))
  }
  console.log('frames ->', dir)
  await browser.close()
  process.exit(0)
}

if (flag('--sheet')) {
  // One frame every N seconds, laid out for eyeballing before a full render.
  const every = val('--every', 2)
  const dir = path.join(OUT, 'sheet')
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
  for (let s = 0; s < TOTAL / FPS; s += every) {
    const f = Math.round(s * FPS)
    fs.writeFileSync(path.join(dir, `t${String(s).padStart(5, '0')}.png`), await shot(f))
  }
  console.log('sheet ->', dir)
  await browser.close()
  process.exit(0)
}

const from = Math.round(val('--from', 0) * FPS)
const to = Math.min(TOTAL, Math.round(val('--to', TOTAL / FPS) * FPS))
const name = flag('--from') || flag('--to') ? `segment-${val('--from', 0)}-${val('--to', TOTAL / FPS)}.mp4` : 'fpl-analyser-launch.mp4'
const target = path.join(OUT, name)

const ff = spawn(FFMPEG, [
  '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '17',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  '-x264-params', 'keyint=120:min-keyint=60',
  target,
], { stdio: ['pipe', 'ignore', 'pipe'] })
let ffErr = ''
let ffDead = false
ff.stderr.on('data', (d) => { ffErr += d.toString() })
ff.on('error', (e) => { ffDead = true; console.error('ffmpeg failed to start:', e.message) })
ff.on('close', (c) => { if (c !== 0) ffDead = true })
ff.stdin.on('error', () => { ffDead = true })

const started = Date.now()
for (let f = from; f < to; f++) {
  if (ffDead) break
  const buf = await shot(f)
  if (!ff.stdin.write(buf)) {
    await new Promise((r) => {
      const done = () => { ff.stdin.off('drain', done); ff.off('close', done); r() }
      ff.stdin.once('drain', done)
      ff.once('close', done)
    })
  }
  if ((f - from) % 120 === 0) {
    const done = f - from + 1, all = to - from
    const rate = done / ((Date.now() - started) / 1000)
    process.stdout.write(`\r  frame ${done}/${all}  ${rate.toFixed(1)} fps  eta ${Math.round((all - done) / rate)}s   `)
  }
}
ff.stdin.end()
const code = await new Promise((r) => ff.on('close', r))
process.stdout.write('\n')
if (code !== 0) { console.error(ffErr.slice(-3000)); process.exit(1) }
console.log('wrote', target, (fs.statSync(target).size / 1e6).toFixed(1), 'MB')
await browser.close()
