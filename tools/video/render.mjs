#!/usr/bin/env node
// Renders the showcase video straight out of the built site.
//
//   node tools/video/render.mjs --cut full --format wide
//
// Frames are captured deterministically: for each frame we compute the scroll
// position for that instant, set it, and screenshot. Nothing is left to real
// time, so motion is smooth at whatever speed we ask for rather than depending
// on how fast the machine happens to screenshot. The browser runs with
// prefers-reduced-motion, which is the site's own supported static-render path —
// counters show final values and reveal animations sit at their end state.
//
// Output is H.264/AAC in an MP4, silent, with captions burned in — the only
// combination that both plays on a phone and uploads from one. --codec vp8
// still emits VP8/WebM, which YouTube accepts from a desktop browser but an
// iPhone will neither play nor offer to upload. A voiceover has to be muxed on
// afterwards; the .json manifest carries per-shot timings for that.

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FORMATS, CUTS, SHOTS, secondsFor } from './shots.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DIST = path.join(ROOT, 'dist')
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

// Playwright ships a stripped ffmpeg: VP8/WebM only, no libx264, no audio
// encoders. That is not enough — an iPhone will not play VP8 in Photos or
// Files, and the YouTube iOS app only lists files the OS can decode, so a WebM
// never even appears in the picker. ffmpeg-static carries libx264 and AAC.
const PW_FFMPEG = '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux'
let ffmpegStatic = null
try { ffmpegStatic = (await import('ffmpeg-static')).default } catch { /* optional */ }

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
const flag = (name) => argv.includes(`--${name}`)

const cutName = String(arg('cut', 'full')).toLowerCase()
const formatName = String(arg('format', 'wide')).toLowerCase()
const fps = Number(arg('fps', 30))
const outDir = arg('out', path.join(ROOT, 'build', 'video'))
const stills = flag('stills')
// --dry resolves every anchor and reports, without encoding. The data refreshes
// several times a day and moves the layout, so this is the cheap way to check
// the shot list still lines up before spending minutes on a render.
const dry = flag('dry')
// MP4/H.264 by default: it is the only thing that plays on an iPhone and
// uploads from one. --codec vp8 keeps the old WebM path.
const codec = String(arg('codec', 'h264')).toLowerCase()

if (!CUTS[cutName]) throw new Error(`unknown cut "${cutName}" (have: ${Object.keys(CUTS).join(', ')})`)
if (!FORMATS[formatName]) throw new Error(`unknown format "${formatName}"`)
if (!['h264', 'vp8'].includes(codec)) throw new Error(`unknown codec "${codec}" (have: h264, vp8)`)
if (!existsSync(DIST)) throw new Error('dist/ missing — run `npm run build` first')

const FFMPEG = codec === 'vp8' ? (ffmpegStatic || PW_FFMPEG) : ffmpegStatic
if (!FFMPEG) {
  throw new Error('MP4 needs a full ffmpeg: run `npm install` (ffmpeg-static is a devDependency), or pass --codec vp8')
}

const format = FORMATS[formatName]
const shotIds = CUTS[cutName]

// Caption sizing differs per format: the vertical cut renders at 432 CSS px, so
// a size tuned for the 1280px desktop layout would come out unreadably small.
//
// The vertical caption sits at the TOP. A lower third is conventional, but in
// this layout the bottom of the frame holds the site's own tab bar, and the
// Shorts/Reels/TikTok chrome (title, handle, action rail) covers the bottom
// third on top of that — so a bottom caption collides twice, and in cut A it
// landed squarely over the captain pick's name and xP.
const CAPTION = formatName === 'vertical'
  ? { px: 20, edge: 'top', offset: '11%', pad: '14px 18px', maxWidth: '92%' }
  : { px: 30, edge: 'bottom', offset: '7%', pad: '18px 24px', maxWidth: '72%' }

// The drawn pointer belongs in the desktop cut only. A mouse cursor floating
// over a phone-shaped mobile layout reads as a desktop screen recording that
// has been cropped, which is exactly what these are not.
const SHOW_CURSOR = formatName !== 'vertical'

// ---------------------------------------------------------------- static server

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
}

function startServer(root) {
  const server = createServer(async (req, res) => {
    try {
      const url = decodeURIComponent((req.url || '/').split('?')[0])
      let file = path.join(root, url)
      if (url.endsWith('/')) file = path.join(file, 'index.html')
      // Never serve outside the build directory.
      if (!file.startsWith(root)) { res.writeHead(403).end(); return }
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

// ---------------------------------------------------------------- director layer

// Caption + synthetic pointer, injected into the page. The real cursor is not
// captured by screenshots, so the pointer has to be drawn; LAUNCH.md is right
// that a recording with nothing ever hovered reads as fake.
function installDirector({ caption, text }) {
  const prev = document.getElementById('__director')
  if (prev) prev.remove()

  const wrap = document.createElement('div')
  wrap.id = '__director'
  wrap.style.cssText = `position:fixed;inset:0;z-index:2147483647;pointer-events:none;`

  const cap = document.createElement('div')
  cap.id = '__director_caption'
  cap.style.cssText = `
    position:absolute;left:50%;transform:translateX(-50%);
    ${caption.edge}:${caption.offset};max-width:${caption.maxWidth};
    padding:${caption.pad};box-sizing:border-box;
    font-family:'Manrope',system-ui,sans-serif;font-weight:700;
    font-size:${caption.px}px;line-height:1.28;letter-spacing:-0.01em;
    color:#fff;text-align:center;text-wrap:balance;
    background:rgba(8,7,6,0.95);backdrop-filter:blur(10px);
    border-radius:12px;border:1px solid rgba(201,162,39,0.45);
    box-shadow:0 12px 48px rgba(0,0,0,0.7);
    opacity:0;`
  cap.textContent = text || ''
  if (!text) cap.style.display = 'none'
  wrap.appendChild(cap)

  const end = document.createElement('div')
  end.id = '__director_endcard'
  end.style.cssText = `
    position:absolute;inset:0;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:0.6em;
    background:rgba(6,5,4,0.86);opacity:0;
    font-family:'Manrope',system-ui,sans-serif;color:#fff;`
  end.innerHTML = `
    <div style="font-family:'Archivo Black',system-ui,sans-serif;font-size:${caption.px * 1.9}px;letter-spacing:-0.02em">
      <span style="color:#fff">FPL</span> <span style="color:#c9a227">Analyser</span></div>
    <div style="font-size:${caption.px * 0.62}px;letter-spacing:0.34em;text-transform:uppercase;color:#ead188">Data · Insight · Points</div>
    <div style="margin-top:0.5em;font-size:${caption.px * 1.05}px;font-weight:800;color:#fff">fplanalyser.co.uk</div>
    <div style="font-size:${caption.px * 0.6}px;color:rgba(255,255,255,0.66)">@FPLAnalyser · fpl_analyser</div>`
  wrap.appendChild(end)

  const cur = document.createElement('div')
  cur.id = '__director_cursor'
  cur.style.cssText = `position:absolute;left:0;top:0;opacity:0;will-change:transform;`
  cur.innerHTML = `
    <svg width="30" height="42" viewBox="0 0 30 42" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 2 L3 30 L10.5 23.5 L15.5 35.5 L20.5 33.5 L15.5 21.5 L25 21 Z"
            fill="#fff" stroke="rgba(0,0,0,0.55)" stroke-width="1.6" stroke-linejoin="round"/>
    </svg>`
  wrap.appendChild(cur)

  const ring = document.createElement('div')
  ring.id = '__director_ring'
  ring.style.cssText = `
    position:absolute;left:0;top:0;width:14px;height:14px;margin:-7px 0 0 -7px;
    border-radius:50%;border:2.5px solid #c9a227;opacity:0;will-change:transform;`
  wrap.appendChild(ring)

  document.documentElement.appendChild(wrap)
}

// Applied per frame. Kept as one evaluate call to hold the round-trips down.
function applyFrame({ y, capOpacity, cursor, ring, endcard }) {
  window.scrollTo(0, y)
  const cap = document.getElementById('__director_caption')
  const end = document.getElementById('__director_endcard')
  const cur = document.getElementById('__director_cursor')
  const rng = document.getElementById('__director_ring')
  if (cap) cap.style.opacity = endcard ? '0' : String(capOpacity)
  if (end) end.style.opacity = endcard ? String(capOpacity) : '0'
  if (cur) {
    cur.style.opacity = cursor ? '1' : '0'
    if (cursor) cur.style.transform = `translate(${cursor.x}px, ${cursor.y}px)`
  }
  if (rng) {
    rng.style.opacity = ring ? String(ring.opacity) : '0'
    if (ring) rng.style.transform = `translate(${ring.x}px, ${ring.y}px) scale(${ring.scale})`
  }
}

// ---------------------------------------------------------------- helpers

const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10)

function pathAt(points, t) {
  if (!points || !points.length) return null
  if (points.length === 1) return { fx: points[0][1], fy: points[0][2] }
  for (let i = 0; i < points.length - 1; i++) {
    const [t0, x0, y0] = points[i]
    const [t1, x1, y1] = points[i + 1]
    if (t <= t1 || i === points.length - 2) {
      const local = t1 === t0 ? 0 : Math.min(Math.max((t - t0) / (t1 - t0), 0), 1)
      const e = smootherstep(local)
      return { fx: x0 + (x1 - x0) * e, fy: y0 + (y1 - y0) * e }
    }
  }
  return null
}

// Resolve a scroll anchor to an absolute Y. Anchors are heading text so they
// survive a data refresh moving the layout; a missing one is a hard error.
async function resolveAnchor(page, spec, label) {
  // An anchor may be given per format ({wide: …, vertical: …}) when the desktop
  // and mobile layouts need genuinely different framing.
  const anchor = spec[formatName] ?? spec
  if (anchor.y !== undefined) return anchor.y
  const y = await page.evaluate(({ text, offset }) => {
    const want = text.trim().toLowerCase()
    let best = null
    for (const el of document.querySelectorAll('h1,h2,h3,h4,span,div,p,button')) {
      const t = (el.textContent || '').trim().toLowerCase()
      if (!t) continue
      if (t === want || t.startsWith(want)) {
        // Prefer the tightest element carrying the text, not its container.
        if (!best || t.length < best.len) {
          const r = el.getBoundingClientRect()
          if (r.height > 0) best = { y: Math.round(r.top + window.scrollY), len: t.length }
        }
      }
    }
    return best ? best.y + (offset || 0) : null
  }, { text: anchor.text, offset: anchor.offset })

  if (y === null) throw new Error(`anchor not found for ${label}: "${anchor.text}"`)
  return Math.max(0, y)
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => document.fonts?.ready).catch(() => {})
  // Give lazy images a chance, then force any that are still pending.
  await page.evaluate(async () => {
    const imgs = [...document.images].filter((i) => !i.complete)
    await Promise.all(imgs.map((i) => new Promise((r) => {
      i.addEventListener('load', r, { once: true })
      i.addEventListener('error', r, { once: true })
      setTimeout(r, 3000)
    })))
  })
  await page.waitForTimeout(600)
}

function writeAsync(stream, buf) {
  return new Promise((resolve, reject) => {
    if (stream.write(buf)) return resolve()
    const onDrain = () => { stream.off('error', onError); resolve() }
    const onError = (e) => { stream.off('drain', onDrain); reject(e) }
    stream.once('drain', onDrain)
    stream.once('error', onError)
  })
}

// ---------------------------------------------------------------- render

const { server, port } = await startServer(DIST)
const BASE = `http://127.0.0.1:${port}`
await mkdir(outDir, { recursive: true })
if (stills) await mkdir(path.join(outDir, 'stills'), { recursive: true })

const outFile = path.join(outDir, `fpl-${cutName}-${formatName}.${codec === 'vp8' ? 'webm' : 'mp4'}`)
const width = Math.round(format.css.width * format.scale)
const height = Math.round(format.css.height * format.scale)

console.log(`cut=${cutName} format=${formatName} ${width}x${height} @${fps}fps codec=${codec}`)
console.log(`shots: ${shotIds.join(', ')}`)

// "pipe:0", not "-": the Playwright-bundled ffmpeg is built with only the pipe
// and file protocols, and the "-" shorthand does not resolve against them.
const INPUT = ['-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0']

const H264 = [
  ...INPUT,
  // A silent AAC track, not -an. iOS Photos and the social uploaders all handle
  // video-only MP4s unreliably, and a 2 kb/s track costs nothing.
  '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
  '-map', '0:v', '-map', '1:a',
  // High profile at yuv420p is what iOS will actually decode; level 4.2 covers
  // 1080p30 either way up. faststart puts the moov atom first so the file plays
  // before it has finished downloading.
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
  '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '128k', '-shortest',
  '-movflags', '+faststart', '-r', String(fps),
  outFile,
]

const VP8 = [
  ...INPUT,
  '-c:v', 'libvpx', '-b:v', '8M', '-crf', '10',
  '-deadline', 'good', '-cpu-used', '2',
  '-pix_fmt', 'yuv420p', '-r', String(fps), '-an',
  outFile,
]

const ffmpeg = dry ? null : spawn(FFMPEG, ['-y', ...(codec === 'vp8' ? VP8 : H264)],
  { stdio: ['pipe', 'ignore', 'pipe'] })

let ffErr = ''
ffmpeg?.stderr.on('data', (d) => { ffErr += d.toString() })
const ffDone = dry ? Promise.resolve() : new Promise((resolve, reject) => {
  ffmpeg.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}\n${ffErr.slice(-2500)}`)))
})

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--force-color-profile=srgb', '--hide-scrollbars', '--disable-lcd-text'],
})
const ctx = await browser.newContext({
  viewport: format.css,
  deviceScaleFactor: format.scale,
  colorScheme: 'dark',
  // The site's own static-render path: final counter values, no reveal
  // animations mid-flight, no infinite foil sweep ticking between frames.
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
const manifest = []
let totalFrames = 0
const startedAt = Date.now()

for (const id of shotIds) {
  const shot = SHOTS[id]
  if (!shot) throw new Error(`shot "${id}" not in shots.mjs`)
  const seconds = secondsFor(shot, formatName)
  const frames = Math.max(1, Math.round(seconds * fps))

  await page.goto(BASE + '/' + shot.route.replace(/^\//, ''), { waitUntil: 'domcontentloaded' })
  // A hash change does not reload, so force the route then settle.
  await page.evaluate((r) => { if (location.hash !== r.slice(1)) location.hash = r.slice(1) }, shot.route)
  await settle(page)
  await page.evaluate(installDirector, { caption: CAPTION, text: shot.captionStyle === 'endcard' ? '' : shot.caption })

  if (shot.setup) await shot.setup(page)

  const yFrom = await resolveAnchor(page, shot.from, `${id}.from`)
  const yTo = await resolveAnchor(page, shot.to, `${id}.to`)
  const maxY = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight))
  const clamp = (v) => Math.min(Math.max(v, 0), maxY)

  const isEnd = shot.captionStyle === 'endcard'
  const vw = format.css.width
  const vh = format.css.height
  let actionDone = false

  process.stdout.write(`  ${id.padEnd(18)} ${String(seconds).padStart(4)}s  y ${clamp(yFrom)}→${clamp(yTo)}  `)

  if (dry) {
    const travel = Math.abs(clamp(yTo) - clamp(yFrom))
    const fromSpec = shot.from[formatName] ?? shot.from
    const toSpec = shot.to[formatName] ?? shot.to
    // A deliberately static shot (home_close) is not a warning.
    const warn = travel < 40 && fromSpec.y !== toSpec.y ? '  ** barely moves **' : ''
    console.log(`ok · page ${maxY + vh}px · travel ${travel}px${warn}`)
    manifest.push({ id, route: shot.route, seconds, frames, caption: shot.caption })
    totalFrames += frames
    continue
  }

  for (let i = 0; i < frames; i++) {
    const t = frames === 1 ? 0 : i / (frames - 1)
    const tSec = t * seconds
    const y = Math.round(clamp(yFrom + (clamp(yTo) - clamp(yFrom)) * smootherstep(t)))

    // Captions fade in and out so cuts do not snap.
    const FADE = 0.4
    let capOpacity = 1
    if (tSec < FADE) capOpacity = tSec / FADE
    else if (tSec > seconds - FADE) capOpacity = Math.max(0, (seconds - tSec) / FADE)

    const p = SHOW_CURSOR ? pathAt(shot.cursor, t) : null
    const cursor = p ? { x: Math.round(p.fx * vw), y: Math.round(p.fy * vh) } : null

    let ring = null
    if (shot.action && cursor) {
      const dt = t - shot.action.at
      if (dt >= 0 && dt < 0.14) {
        const k = dt / 0.14
        ring = { x: cursor.x, y: cursor.y, scale: 1 + k * 2.6, opacity: 1 - k }
      }
    }

    await page.evaluate(applyFrame, { y, capOpacity, cursor, ring, endcard: isEnd })

    if (shot.action && !actionDone && t >= shot.action.at) {
      actionDone = true
      await shot.action.run(page).catch((e) => console.warn(`\n    action failed: ${e.message}`))
      await page.waitForTimeout(200)
    }

    const buf = await page.screenshot({ type: 'jpeg', quality: 92 })
    await writeAsync(ffmpeg.stdin, buf)

    if (stills && (i === 0 || i === frames - 1 || i === Math.floor(frames / 2))) {
      const tag = i === 0 ? 'a-first' : i === frames - 1 ? 'c-last' : 'b-mid'
      await writeFile(path.join(outDir, 'stills', `${cutName}-${formatName}-${id}-${tag}.png`),
        await page.screenshot({ type: 'png' }))
    }
  }

  totalFrames += frames
  manifest.push({ id, route: shot.route, seconds, frames, caption: shot.caption })
  console.log(`${frames} frames`)
}

ffmpeg?.stdin.end()
await browser.close()
server.close()
await ffDone

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0)
if (dry) {
  console.log(`\ndry run ok · ${shotIds.length} shots · ${(totalFrames / fps).toFixed(1)}s at ${fps}fps · checked in ${elapsed}s`)
  process.exit(0)
}
const { size } = await import('node:fs').then((m) => m.promises.stat(outFile))
await writeFile(
  path.join(outDir, `fpl-${cutName}-${formatName}.json`),
  JSON.stringify({ cut: cutName, format: formatName, width, height, fps, seconds: totalFrames / fps, shots: manifest }, null, 2),
)

console.log(`\n${outFile}`)
console.log(`  ${width}x${height} · ${(totalFrames / fps).toFixed(1)}s · ${totalFrames} frames · ${(size / 1e6).toFixed(1)} MB · rendered in ${elapsed}s`)
