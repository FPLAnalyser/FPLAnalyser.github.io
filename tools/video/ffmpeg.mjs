/** Resolve a *full* ffmpeg.
 *
 *  Playwright ships one at /opt/pw-browsers/ffmpeg-*, but it is a stripped
 *  build — no libx264, no PNG decoder — so it silently cannot encode this.
 *  Prefer an explicit FFMPEG_PATH, then a system ffmpeg, then the static build
 *  that imageio-ffmpeg installs under site-packages. */
import fs from 'node:fs'
import path from 'node:path'

function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  for (const c of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg']) {
    if (fs.existsSync(c)) return c
  }
  for (const root of ['/usr/local/lib', '/usr/lib']) {
    if (!fs.existsSync(root)) continue
    for (const py of fs.readdirSync(root)) {
      const dir = path.join(root, py, 'dist-packages', 'imageio_ffmpeg', 'binaries')
      if (!fs.existsSync(dir)) continue
      const hit = fs.readdirSync(dir).find((f) => f.startsWith('ffmpeg-'))
      if (hit) return path.join(dir, hit)
    }
  }
  throw new Error('No usable ffmpeg found. Install ffmpeg or set FFMPEG_PATH. '
    + 'The Playwright-bundled ffmpeg will not work: it has no libx264.')
}

export const FFMPEG = resolveFfmpeg()
