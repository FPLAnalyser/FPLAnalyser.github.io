/* Screenshot + frame-time harness.

   Two devices, because the only claim worth making about WebGL on this site is
   what it does on a phone: a desktop viewport, and an iPhone 15 viewport at
   dpr 3 under an iOS user agent. Frame time is read from the scene's own
   rolling mean after a fixed settle, with auto-rotate left ON so the number
   describes a moving scene rather than a still one.

   Headless GPU: Chromium in this container has no hardware GL, so it falls
   back to SwiftShader — software rasterisation. That makes these numbers a
   FLOOR, not the phone number. Reported as such; a real device reading has to
   come from a real device. */
import { chromium, devices } from 'playwright'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FILE = 'file://' + resolve(HERE, 'dist/pitch3d.html')
const VARIANTS = ['standing', 'tabletop', 'columns']

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})

async function run(label, contextOpts, shotPrefix) {
  const ctx = await browser.newContext(contextOpts)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto(FILE, { waitUntil: 'load' })
  await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 20000 })
  await page.waitForTimeout(1200)

  // What the GPU is actually being asked to do. These are the numbers worth
  // quoting, because unlike frame time they do not depend on this container
  // having no graphics hardware.
  const cost = await page.evaluate(() => {
    const r = window.__scene.renderer
    const gl = r.getContext()
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    return {
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      calls: r.info.render.calls,
      tris: r.info.render.triangles,
      textures: r.info.memory.textures,
      geometries: r.info.memory.geometries,
      programs: r.info.programs?.length ?? 0,
    }
  })

  const rows = []
  for (const v of VARIANTS) {
    await page.click(`[data-variant="${v}"]`)
    await page.waitForTimeout(2600)          // tween (700ms) + settle
    if (shotPrefix) {
      await page.screenshot({ path: resolve(HERE, 'shots', `${shotPrefix}-${v}.png`) })
    }
    const ms = await page.evaluate(() => window.__scene.frameTime())
    rows.push([v, ms])
  }

  // Same scene, shadows off — the one setting worth having a number for.
  await page.click('[data-variant="tabletop"]')
  await page.waitForTimeout(1500)
  await page.uncheck('#shadows')
  await page.waitForTimeout(2600)
  const noShadow = await page.evaluate(() => window.__scene.frameTime())

  console.log(`\n  ${label}`)
  console.log(`    GL: ${cost.renderer}`)
  console.log(`    per frame: ${cost.calls} draw calls, ${cost.tris.toLocaleString()} triangles`)
  console.log(`    resident: ${cost.textures} textures, ${cost.geometries} geometries, ${cost.programs} shader programs`)
  for (const [v, ms] of rows) console.log(`    ${v.padEnd(10)} ${ms.toFixed(1).padStart(6)} ms  ${String(Math.round(1000 / ms)).padStart(3)} fps`)
  console.log(`    ${'tabletop, no shadows'.padEnd(10)} ${noShadow.toFixed(1).padStart(6)} ms  ${String(Math.round(1000 / noShadow)).padStart(3)} fps`)
  if (errors.length) console.log('    page errors:', errors.slice(0, 5))
  else console.log('    page errors: none')

  await ctx.close()
  return rows
}

await run('desktop  1440x900  dpr 1', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, 'desktop')
await run('iPhone 15  393x852  dpr 3 (iOS UA)', { ...devices['iPhone 15'] }, 'iphone')

await browser.close()
