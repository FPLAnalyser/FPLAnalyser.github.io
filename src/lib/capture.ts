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

/** Can this URL be read back off a canvas — i.e. does the host answer a CORS
 *  request for it?
 *
 *  Deliberately probed on a throwaway image. Setting `crossOrigin` and
 *  re-assigning `src` on the live element, which is what this used to do,
 *  fires that element's `error` handler when the host has no CORS headers —
 *  and the headshot component reads an error as "this URL is no good" and
 *  advances to the next candidate. Share once and it would walk off the end
 *  of the list, leaving initials where the photo had been, on the page, for
 *  the rest of the session. html2canvas requests its own copies with
 *  `useCORS`, so the live element never needs touching at all.
 *
 *  Cached per URL: fifteen cards on a pitch are fifteen requests otherwise. */
const corsCache = new Map<string, Promise<boolean>>()
function corsLoadable(src: string): Promise<boolean> {
  const hit = corsCache.get(src)
  if (hit) return hit
  const probe = new Promise<boolean>((resolve) => {
    const img = new Image()
    let settled = false
    const finish = (ok: boolean) => { if (!settled) { settled = true; resolve(ok) } }
    img.crossOrigin = 'anonymous'
    img.onload = () => finish(img.naturalWidth > 0)
    img.onerror = () => finish(false)
    img.src = src
    // Don't let one slow host hold up the whole export.
    setTimeout(() => finish(false), 4000)
  })
  corsCache.set(src, probe)
  return probe
}

/** Hide any image html2canvas would draw as a hole, so the monogram beneath it
 *  shows instead. Returns the undo. */
async function hideUnrasterisable(node: HTMLElement): Promise<() => void> {
  const imgs = [...node.querySelectorAll('img')].filter((i) => i.src && !i.src.startsWith('data:'))
  // Hold the slot alongside the image. Resolving it with `closest` at undo
  // time fails if the element has since been detached, which left the slot
  // stuck in its no-photo state — initials on a page whose photo was fine.
  const hidden: { img: HTMLImageElement; slot: Element | null }[] = []
  await Promise.all(
    imgs.map(async (img) => {
      if (await corsLoadable(img.src)) return
      const slot = img.closest('.photo-slot')
      img.style.visibility = 'hidden'
      slot?.setAttribute('data-nophoto', '')
      hidden.push({ img, slot })
    }),
  )
  return () => hidden.forEach(({ img, slot }) => {
    img.style.visibility = ''
    slot?.removeAttribute('data-nophoto')
  })
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
