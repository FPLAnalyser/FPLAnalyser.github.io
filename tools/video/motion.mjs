#!/usr/bin/env node
// Renders the motion-graphics layer, and assembles the finished film.
//
//   node tools/video/motion.mjs --comp Intro
//   node tools/video/motion.mjs --comp Film --clips build/video/fpl-full-wide.mp4
//
// render.mjs films the real product. This adds what a screen recording cannot
// give you — sprung titles, a stat sting, an end card — and dissolves the
// joins. Both use headless Chromium; this one animates React on a timeline
// rather than driving a live page.

import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { spawnSync } from 'node:child_process'
import { mkdir, copyFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpegStatic from 'ffmpeg-static'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const PROJECT = path.join(HERE, 'remotion')
const PUBLIC = path.join(PROJECT, 'public')

// Remotion drives chrome-headless-shell (the old headless mode), which the
// ordinary Chromium binary dropped. Its own download host is blocked by the
// network policy here, but Playwright already ships the shell.
const SHELL = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1] }

const comp = arg('comp', 'Film')
const clipArg = arg('clips', path.join(ROOT, 'build/video/fpl-full-wide.mp4'))
const audioArg = arg('audio', null)
const dissolve = Number(arg('dissolve', 12))
const musicVolume = Number(arg('music-volume', 0.18))
const outDir = arg('out', path.join(ROOT, 'build', 'video'))

if (!existsSync(SHELL)) throw new Error(`chrome-headless-shell missing at ${SHELL}`)

/** Frame count of a clip, read from the container rather than assumed. */
function probeFrames(file, fps) {
  const out = spawnSync(ffmpegStatic, ['-hide_banner', '-i', file], { encoding: 'utf8' })
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(out.stderr || '')
  if (!m) throw new Error(`could not read duration of ${file}`)
  const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  return Math.round(seconds * fps)
}

// Remotion can only load media from its public/ directory, so anything being
// composited is staged there first and cleared afterwards.
await rm(path.join(PUBLIC, 'clips'), { recursive: true, force: true })
await mkdir(path.join(PUBLIC, 'clips'), { recursive: true })
await mkdir(path.join(PUBLIC, 'fonts'), { recursive: true })
await mkdir(path.join(PUBLIC, 'brand'), { recursive: true })
for (const f of ['manrope-800.woff2', 'archivo-black-400.woff2']) {
  await copyFile(path.join(ROOT, 'src/fonts', f), path.join(PUBLIC, 'fonts', f))
}
// The cards are built on the real mark, not a re-typeset imitation of it.
//
// It is prepared rather than copied, for two reasons. The source carries about
// 4.4% of dead black margin on every side (content measured at 585x579 inside
// 640x640), which is screen area the mark is not using. And at 640px it is
// smaller than the size the cards want it, so the browser would be upscaling
// at render time with plain bilinear filtering. Cropping the margin and
// pre-scaling to 1280 with lanczos means the browser *downscales* into place
// instead, which is the direction that stays sharp.
const logoOut = path.join(PUBLIC, 'brand/lockup-hi.png')
{
  const r = spawnSync(ffmpegStatic, [
    '-y', '-hide_banner', '-v', 'error',
    '-i', path.join(ROOT, 'public/brand/lockup.jpg'),
    // Proportional crop, so replacing the logo does not need this re-measured.
    '-vf', 'crop=iw*0.92:ih*0.92,scale=1280:1280:flags=lanczos',
    logoOut,
  ], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`logo prep failed: ${r.stderr}`)
}

const FPS = 30
const clips = []
if (comp === 'Film') {
  for (const raw of clipArg.split(',').map((s) => s.trim()).filter(Boolean)) {
    const src = path.isAbsolute(raw) ? raw : path.join(ROOT, raw)
    if (!existsSync(src)) throw new Error(`clip not found: ${src}\nRun render.mjs first.`)
    const base = path.basename(src)
    await copyFile(src, path.join(PUBLIC, 'clips', base))
    clips.push({ src: `clips/${base}`, durationInFrames: probeFrames(src, FPS) })
  }
  if (!clips.length) throw new Error('no clips to assemble')
}

let audio = null
if (audioArg) {
  const src = path.isAbsolute(audioArg) ? audioArg : path.join(ROOT, audioArg)
  if (!existsSync(src)) throw new Error(`audio not found: ${src}`)
  const base = path.basename(src)
  await copyFile(src, path.join(PUBLIC, base))
  audio = base
}

const inputProps = { clips, dissolve, audio, musicVolume }

console.log(`composition=${comp}`)
if (clips.length) {
  for (const c of clips) console.log(`  clip ${c.src} · ${c.durationInFrames} frames`)
}

// publicDir has to be explicit: the entry point is nested under tools/, so
// Remotion's convention-based lookup misses it and staticFile() 404s. That
// fails silently as a fallback font rather than an error, so it is only
// visible in the rendered frames.
const serveUrl = await bundle({ entryPoint: path.join(PROJECT, 'index.ts'), publicDir: PUBLIC })
const composition = await selectComposition({
  serveUrl, id: comp, inputProps, browserExecutable: SHELL,
})

await mkdir(outDir, { recursive: true })
const outFile = path.join(outDir, `fpl-${comp.toLowerCase()}.mp4`)

console.log(`${composition.width}x${composition.height} · ${composition.durationInFrames} frames @${composition.fps}`)

let lastPct = -1
await renderMedia({
  composition, serveUrl, codec: 'h264', outputLocation: outFile,
  inputProps, browserExecutable: SHELL,
  chromiumOptions: { gl: 'swangle' },
  x264Preset: 'slow', crf: 20,
  onProgress: ({ progress }) => {
    const pct = Math.floor(progress * 10) * 10
    if (pct !== lastPct) { lastPct = pct; process.stdout.write(`${pct}% `) }
  },
})

await rm(path.join(PUBLIC, 'clips'), { recursive: true, force: true })
const { size } = await import('node:fs').then((m) => m.promises.stat(outFile))
console.log(`\n${outFile}\n  ${(composition.durationInFrames / composition.fps).toFixed(1)}s · ${(size / 1e6).toFixed(1)} MB`)
