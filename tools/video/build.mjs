/**
 * One command for the whole film: build the site, capture plates from it,
 * render the frames, and cut the homepage hero loop out of the master.
 *
 *   npm run video              # everything
 *   npm run video -- --skip-build --skip-capture   # just re-render
 *
 * The site must already be built (dist/) unless --skip-build is omitted.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from './serve.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = path.join(HERE, 'out')
const PORT = Number(process.env.VIDEO_PORT || 4179)
const argv = process.argv.slice(2)
const skip = (n) => argv.includes(`--skip-${n}`)

const run = (cmd, args, env = {}) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } })
  p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${c}`))))
})

if (!skip('build')) {
  console.log('· building the site')
  await run('npm', ['run', 'build'])
}
if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  throw new Error('dist/ is missing — run `npm run build` first, or drop --skip-build.')
}

console.log(`· serving on :${PORT}`)
const distServer = await serve(path.join(ROOT, 'dist'), PORT)
const repoServer = await serve(ROOT, PORT + 1)
const ORIGIN = `http://127.0.0.1:${PORT}`
const REPO_ORIGIN = `http://127.0.0.1:${PORT + 1}`

try {
  if (!skip('capture')) {
    console.log('· capturing plates from the live pages')
    await run('node', ['tools/video/capture.mjs'], { VIDEO_ORIGIN: ORIGIN })
  }
  console.log('· rendering frames')
  await run('node', ['tools/video/render.mjs', ...argv.filter((a) => !a.startsWith('--skip-'))],
            { VIDEO_ORIGIN: REPO_ORIGIN })
} finally {
  distServer.close(); repoServer.close()
}

// ---- homepage hero loop -------------------------------------------------
// Six seconds of the ranking filling in, scaled to 720p, silent, fading from
// and back to black so it loops without a visible seam.
const master = path.join(OUT, 'fpl-analyser-launch.mp4')
if (fs.existsSync(master)) {
  const { FFMPEG } = await import('./ffmpeg.mjs')
  const LOOP_START = 10.4, LOOP_LEN = 6.0
  const common = ['-y', '-ss', String(LOOP_START), '-t', String(LOOP_LEN), '-i', master, '-an',
    '-vf', `scale=1280:-2,fade=t=in:st=0:d=0.45,fade=t=out:st=${LOOP_LEN - 0.45}:d=0.45`]
  for (const [name, args] of [
    ['fpl-analyser-hero.mp4', ['-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']],
    ['fpl-analyser-hero.webm', ['-c:v', 'libvpx-vp9', '-crf', '38', '-b:v', '0', '-row-mt', '1']],
  ]) {
    const target = path.join(OUT, name)
    const r = spawnSync(FFMPEG, [...common, ...args, target], { stdio: ['ignore', 'ignore', 'pipe'] })
    if (r.status !== 0) { console.error(r.stderr.toString().slice(-1500)); continue }
    console.log('  hero loop:', name, (fs.statSync(target).size / 1e6).toFixed(2), 'MB')
  }
}
console.log('· done ->', OUT)
