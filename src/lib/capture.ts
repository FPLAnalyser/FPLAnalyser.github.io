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

/** Try to load `src` through CORS so its pixels can be read back off a canvas. */
function corsLoadable(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = new Image()
    probe.crossOrigin = 'anonymous'
    probe.onload = () => resolve(true)
    probe.onerror = () => resolve(false)
    probe.src = src
    // Don't let one slow host hold up the whole export.
    setTimeout(() => resolve(false), 4000)
  })
}

/** Hide any image html2canvas would draw as a hole, so the monogram beneath it
 *  shows instead. Returns the undo. */
async function hideUnrasterisable(node: HTMLElement): Promise<() => void> {
  const imgs = [...node.querySelectorAll('img')].filter((i) => i.src && !i.src.startsWith('data:'))
  const hidden: HTMLImageElement[] = []
  await Promise.all(
    imgs.map(async (img) => {
      if (await corsLoadable(img.src)) {
        // Re-request through CORS so the clone can read it back.
        img.crossOrigin = 'anonymous'
        img.src = img.src
        return
      }
      img.style.visibility = 'hidden'
      hidden.push(img)
    }),
  )
  return () => hidden.forEach((i) => (i.style.visibility = ''))
}

const twoFrames = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))

export async function rasterise(node: HTMLElement, dark: boolean): Promise<HTMLCanvasElement> {
  const root = document.documentElement
  root.setAttribute('data-capturing', '')
  let restoreImages = () => {}
  try {
    // Webfonts have to be resolved before html2canvas measures text, or the
    // fallback's metrics decide the line boxes.
    await document.fonts?.ready
    restoreImages = await hideUnrasterisable(node)
    await twoFrames()
    const { default: html2canvas } = await import('html2canvas-pro')
    return await html2canvas(node, {
      backgroundColor: dark ? '#0c0b09' : '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    })
  } finally {
    restoreImages()
    root.removeAttribute('data-capturing')
  }
}

// Local-only test hook, so the screenshot harness can drive the real capture
// path (and catch regressions in the exported PNG) rather than a copy of it.
if (import.meta.env.DEV || location.hostname === 'localhost') {
  ;(window as unknown as { __rasterise?: typeof rasterise }).__rasterise = rasterise
}
