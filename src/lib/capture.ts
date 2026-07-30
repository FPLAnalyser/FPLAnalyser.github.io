/* ════════════════════════════════════════════════════════════════════════
   Rasterising a piece of the page to a PNG.

   html2canvas re-implements layout and paint from scratch in a cloned
   document, and a few things this site leans on simply aren't in it. Left
   alone the export came out wrong in three visible ways:

     · `background-clip: text` — every rating painted as a solid gold BLOCK
       where the digits should be, because the gradient is drawn and the
       transparent text over it never is.
     · `truncate` (overflow:hidden + ellipsis) — names rendered in a line box
       an few pixels too short, slicing the glyphs through the middle.
     · Remote headshots — the Premier League CDN images are drawn from cache
       for the page but cannot be read back into a canvas unless the response
       carries CORS headers, so they came out as empty holes.

   `rasterise` puts the document into capture mode first (a `data-capturing`
   attribute the stylesheet answers), settles fonts and images, and always
   takes the mode back off again.
   ════════════════════════════════════════════════════════════════════════ */

/** Wait for every image in the panel to finish, and stop deferring the ones
 *  below the fold. `loading="lazy"` is right for a long page and wrong for a
 *  capture: an image that has not been scrolled to has not been fetched, and
 *  the export gets whatever was there — nothing. */
async function settleImages(node: HTMLElement): Promise<void> {
  const imgs = [...node.querySelectorAll('img')]
  for (const img of imgs) if (img.loading === 'lazy') img.loading = 'eager'
  await Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((res) => {
            const done = () => res()
            img.addEventListener('load', done, { once: true })
            img.addEventListener('error', done, { once: true })
            setTimeout(done, 4000)
          }),
    ),
  )
}

/** Hide any image html2canvas would draw as a hole, so the monogram beneath it
 *  shows instead. Returns the undo.
 *
 *  No network probing here any more. The page already loads its headshots
 *  through CORS, and marks the ones that had to fall back to a plain request,
 *  so which images can be rasterised is simply known — asking again was both
 *  slow and wrong, because the browser answered the second request out of the
 *  cache with the first one's headerless response. */
function hideUnrasterisable(node: HTMLElement): () => void {
  // Hold the slot alongside the image. Resolving it with `closest` at undo
  // time fails if the element has since been detached, which left the slot
  // stuck in its no-photo state — initials on a page whose photo was fine.
  const hidden: { img: HTMLImageElement; slot: Element | null }[] = []
  for (const img of node.querySelectorAll('img')) {
    if (!img.src || img.src.startsWith('data:')) continue
    const sameOrigin = new URL(img.src, location.href).origin === location.origin
    const readable = sameOrigin || (!!img.crossOrigin && img.naturalWidth > 0)
    if (readable) continue
    const slot = img.closest('.photo-slot')
    img.style.visibility = 'hidden'
    slot?.setAttribute('data-nophoto', '')
    hidden.push({ img, slot })
  }
  return () => hidden.forEach(({ img, slot }) => {
    img.style.visibility = ''
    slot?.removeAttribute('data-nophoto')
  })
}

/** Split on the commas that aren't inside brackets — `rgb(1, 2, 3)` is one
 *  item, not three. */
function topLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1 }
  }
  out.push(s.slice(start))
  return out.map((x) => x.trim()).filter(Boolean)
}

/** One repeating gradient, written out instead of repeated.
 *
 *  Same geometry, stated ninety times rather than once — which covers a bar
 *  about a thousand pixels long, and everything on this site that repeats a
 *  gradient is a bar. Anything that doesn't parse is handed back untouched;
 *  a wrong stripe is worse than the short form html2canvas already mishandles,
 *  and there is no way to check from in here which of the two you'd get. */
function writeOut(layer: string): string {
  const inner = layer.slice(layer.indexOf('(') + 1, layer.lastIndexOf(')'))
  const parts = topLevel(inner)
  const head = parts[0]
  const stops = parts.slice(1).map((p) => {
    const m = /^(.*?)\s+(-?[\d.]+)px$/.exec(p)
    return m ? { colour: m[1].trim(), at: parseFloat(m[2]) } : null
  })
  if (!stops.length || stops.some((s) => !s)) return layer
  const cycle = stops[stops.length - 1]!.at - stops[0]!.at
  if (!(cycle > 0)) return layer
  const out: string[] = []
  for (let i = 0; i < 90; i++) for (const s of stops) out.push(`${s!.colour} ${(s!.at + i * cycle).toFixed(2)}px`)
  return `linear-gradient(${head},${out.join(',')})`
}

/** html2canvas draws a repeating gradient as its LAST colour and nothing else,
 *  so every striped shirt exported as a solid block — Bournemouth's red and
 *  black came out pure black, which is not a club that plays in the Premier
 *  League. The repetition is written out for the capture and put back after,
 *  because on screen the short form is both exact and cheap. */
function unrollGradients(node: HTMLElement): () => void {
  const undo: { el: HTMLElement; was: string }[] = []
  for (const el of [node, ...node.querySelectorAll<HTMLElement>('*')]) {
    const bg = getComputedStyle(el).backgroundImage
    if (!bg.includes('repeating-linear-gradient')) continue
    const next = topLevel(bg)
      .map((layer) => (layer.startsWith('repeating-linear-gradient') ? writeOut(layer) : layer))
      .join(',')
    if (next === bg) continue
    undo.push({ el, was: el.style.backgroundImage })
    el.style.backgroundImage = next
  }
  return () => undo.forEach(({ el, was }) => { el.style.backgroundImage = was })
}

const twoFrames = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

export async function rasterise(node: HTMLElement, dark: boolean): Promise<HTMLCanvasElement> {
  const root = document.documentElement
  root.setAttribute('data-capturing', '')
  let restoreImages = () => {}
  let restoreGradients = () => {}
  try {
    // Webfonts have to be resolved before html2canvas measures text, or the
    // fallback's metrics decide the line boxes.
    await document.fonts?.ready
    await settleImages(node)
    restoreImages = hideUnrasterisable(node)
    // After the capture stylesheet is on, so a rule that changes a gradient in
    // capture mode is the one that gets written out.
    restoreGradients = unrollGradients(node)
    await twoFrames()
    const { default: html2canvas } = await import('html2canvas-pro')
    return await html2canvas(node, {
      backgroundColor: dark ? '#0c0b09' : '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    })
  } finally {
    restoreGradients()
    restoreImages()
    root.removeAttribute('data-capturing')
  }
}

// Local-only test hook, so the screenshot harness can drive the real capture
// path (and catch regressions in the exported PNG) rather than a copy of it.
if (import.meta.env.DEV || location.hostname === 'localhost') {
  ;(window as unknown as { __rasterise?: typeof rasterise }).__rasterise = rasterise
}
