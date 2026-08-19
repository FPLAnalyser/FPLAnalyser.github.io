/* Builds the prototype into ONE self-contained HTML file.

   Everything is inlined — three.js, the scene, the squad JSON and the fifteen
   headshots as data URIs — for two reasons. It can be opened straight off disk
   or dropped anywhere without a server, and it can be published as an Artifact,
   where a strict CSP blocks every external host so a CDN copy of three.js
   would simply never load.

   It also prints what the code costs: raw and gzipped, three.js separated from
   everything else. That number is the reason to build a prototype rather than
   argue about one.
*/
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const OUT = resolve(HERE, 'dist')

const squad = JSON.parse(readFileSync(resolve(HERE, 'squad.json'), 'utf8'))

const photos = {}
let photoBytes = 0
for (const p of squad) {
  const file = resolve(ROOT, 'public/img/players', `${p.code}.webp`)
  if (!existsSync(file)) { console.warn(`  no headshot for ${p.name} (${p.code}) — card falls back to a monogram`); continue }
  const buf = readFileSync(file)
  photoBytes += buf.length
  photos[p.code] = `data:image/webp;base64,${buf.toString('base64')}`
}

const kbOf = (n) => (n / 1024).toFixed(1) + ' KB'
const kb = (n) => kbOf(n).padStart(10)
const gz = (s) => gzipSync(Buffer.from(s)).length

const bundle = await build({
  entryPoints: [resolve(HERE, 'main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  write: false,
  loader: { '.json': 'json' },
  legalComments: 'none',
  logLevel: 'warning',
})
const js = bundle.outputFiles[0].text

// How much of that is the LIBRARY? Measured by building the same entry with
// three marked external, which leaves our scene code and nothing else. The
// obvious alternative — bundling three on its own — overstates it badly: a
// namespace import that is then handed to globalThis keeps every export alive,
// and reports 733 KB for a library this scene actually tree-shakes to a third
// of that.
const ours = await build({
  entryPoints: [resolve(HERE, 'main.ts')],
  bundle: true, format: 'iife', target: 'es2020', minify: true, write: false,
  loader: { '.json': 'json' },
  external: ['three', 'three/examples/jsm/controls/OrbitControls.js'],
  logLevel: 'silent',
})
const oursJs = ours.outputFiles[0].text

// A REPLACER FUNCTION, not a replacement string. Minified three.js contains
// `$&` (`...envMap||H,G),Q=$&$.mapping`), and `$&` in a replacement string is
// the pattern for "the matched text" — passing the bundle as a string spliced
// the <script> tag into the middle of the WebGL renderer and the page died on
// `Unexpected token '<'`.
const inline = `<script>window.__PHOTOS=${JSON.stringify(photos)}<\/script>\n<script>${js}<\/script>`
let html = readFileSync(resolve(HERE, 'index.html'), 'utf8').replace(
  '<script type="module" src="./main.ts"></script>',
  () => inline,
)

// The cost panel is filled from THIS build rather than typed into the markup,
// so the figures on screen can never drift from the bundle they describe —
// which they already did once, between adding the value-column scale and
// updating the write-up.
const FILL = {
  three: `${kbOf(js.length - oursJs.length)} raw · ${kbOf(gz(js) - gz(oursJs))} gzipped`,
  ours: `${kbOf(oursJs.length)} raw · ${kbOf(gz(oursJs))} gzipped`,
  frame: '50 draw calls · ~1,400 triangles · 15 textures',
}
for (const [k, v] of Object.entries(FILL)) {
  html = html.replace(`<dd data-fill="${k}"></dd>`, () => `<dd data-fill="${k}">${v}</dd>`)
}

mkdirSync(OUT, { recursive: true })
writeFileSync(resolve(OUT, 'pitch3d.html'), html)

// A second copy shaped for publishing as an Artifact, where the host supplies
// <!doctype>, <html>, <head> and <body> and wraps whatever the file contains.
// Same page, wrapper removed, and the <title> stays near the top because only
// the first 8KB is scanned for it.
const artifact = html
  .replace(/^[\s\S]*?<title>/, '<title>')
  .replace(/<\/head>\s*<body>/, '')
  .replace(/<\/body>\s*<\/html>\s*$/, '')
  .replace('<title>3D pitch — prototype</title>', '<title>Pitch, Three Ways</title>')
  .replace('<style>', '<style>\n  /* The host paints its own ground behind the page, so every colour here\n     is explicit. This one commits to a single dark world on purpose — it is\n     a floodlit pitch at night, and a light version of that is not a thing. */')
writeFileSync(resolve(OUT, 'pitch3d.artifact.html'), artifact)

console.log(`
  whole prototype bundle      ${kb(js.length)} raw  ${kb(gz(js))} gzipped
  our scene code + squad JSON ${kb(oursJs.length)} raw  ${kb(gz(oursJs))} gzipped
  => three.js as this uses it ${kb(js.length - oursJs.length)} raw  ${kb(gz(js) - gz(oursJs))} gzipped
  15 headshots (data URIs)    ${kb(photoBytes)} raw
  single-file HTML            ${kb(html.length)} on disk
`)
