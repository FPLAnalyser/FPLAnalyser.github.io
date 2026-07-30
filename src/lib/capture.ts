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

/** A copy of the panel, laid out at a width we choose rather than the one the
 *  reader's phone happens to have.
 *
 *  This is the difference between a share image and a screenshot. Capturing the
 *  live element captures the reader's device: the captain podium is three
 *  stacked cards at 370px on a phone and a single 1392px row on a laptop, so
 *  the same button produced two unrelated pictures — and the phone one then had
 *  to be blown up 2.2x to reach export resolution, which is why everything
 *  looked soft.
 *
 *  The layout is driven by CSS media queries, and media queries answer to the
 *  *viewport*, not to the element — so forcing a width on the node does
 *  nothing. An iframe has its own viewport, which is the whole trick: clone the
 *  panel into a 520px-wide frame and it lays itself out as the phone version,
 *  from a desktop browser, deterministically.
 *
 *  Same stylesheets, same theme attributes, same fonts. Resolves once the copy
 *  has settled and is ready to be photographed. */
/** The layout widths worth trying. Spread wide enough to straddle every
 *  breakpoint the site has, so the search can find the stacked version and the
 *  row version of the same panel. */
const LADDER = [440, 560, 700, 900, 1200]

interface Staged {
  el: HTMLElement
  done: () => void
  /** Re-lay the copy out at another width and hand back its new box. */
  resize: (w: number) => Promise<DOMRect>
}

async function stage(node: HTMLElement, width: number, dark: boolean): Promise<Staged> {
  const frame = document.createElement('iframe')
  // Off-screen rather than hidden: `display:none` gives an element no layout at
  // all, and a panel with no layout measures zero.
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:10px;border:0;visibility:hidden`
  document.body.appendChild(frame)
  const done = () => frame.remove()

  const doc = frame.contentDocument!
  doc.open()
  doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
  doc.close()

  for (const sheet of document.querySelectorAll('style, link[rel="stylesheet"]')) {
    doc.head.appendChild(sheet.cloneNode(true))
  }
  // The token layer keys off these; without them the copy renders unthemed.
  const root = doc.documentElement
  root.dataset.mode = document.documentElement.dataset.mode ?? (dark ? 'dark' : 'light')
  root.dataset.accent = document.documentElement.dataset.accent ?? 'aurum'
  root.setAttribute('data-capturing', '')
  doc.body.style.cssText = `margin:0;padding:0;width:${width}px;background:${dark ? '#0c0b09' : '#ffffff'}`

  const el = node.cloneNode(true) as HTMLElement
  // The panel's own width usually comes from a parent that isn't coming with
  // it, so it is given the frame outright.
  el.style.width = '100%'
  doc.body.appendChild(el)

  // Fonts load per-document. Without this the copy is measured in the fallback
  // face and every line box is the wrong height.
  await (doc as Document & { fonts?: FontFaceSet }).fonts?.ready
  await settleImages(el)
  // Let the frame grow to whatever the content needs, so nothing is clipped by
  // the 10px it was created at.
  frame.style.height = `${Math.ceil(el.getBoundingClientRect().height) + 40}px`
  await twoFrames()

  /** Re-lay the same copy out at another width. Cheap — the stylesheets and
   *  the images are already in this document, only the viewport moves. */
  const resize = async (w: number) => {
    frame.style.width = `${w}px`
    doc.body.style.width = `${w}px`
    await twoFrames()
    return el.getBoundingClientRect()
  }
  return { el, done, resize }
}

/** Lay the panel out at the width whose shape comes closest to the hole it has
 *  to fill.
 *
 *  There is no formula for this. A list of fifteen injuries is 1125px tall at
 *  every width — it does not reflow at all — while the captain podium goes from
 *  a 1.17 stack at 520px to an 8.57 row at 1200px, because a breakpoint moves
 *  it from column to row. Anything that predicts one gets the other badly
 *  wrong, and the first version of this used a conserved-area model that put
 *  the podium at 498px when 700px was the right answer.
 *
 *  So it measures. Five widths, one clone, the viewport moved between them:
 *  the expensive part of staging is copying the stylesheets, and that happens
 *  once. Compared in log space, because being twice as wide as the frame and
 *  half as wide are equally wrong. */
async function fitToAspect(staged: Staged, target: number): Promise<void> {
  let best = { w: 0, miss: Infinity }
  for (const w of LADDER) {
    const box = await staged.resize(w)
    if (!box.width || !box.height) continue
    const miss = Math.abs(Math.log(box.width / box.height / target))
    if (miss < best.miss) best = { w, miss }
  }
  if (best.w) await staged.resize(best.w)
}

/** Photograph a panel.
 *
 *  `renderWidth` lays the panel out at that width first (see `stage`) — pass it
 *  whenever the output has a shape to fill, so a tall frame gets the stacked
 *  layout and a wide frame gets the row. Omit it to photograph the live element
 *  exactly as the reader sees it.
 *
 *  `minWidth` is the pixel width the result needs to reach; the capture scale
 *  is chosen so the canvas is at least that wide natively. Enlarging a bitmap
 *  afterwards is what softened every export before this. */
export async function rasterise(
  node: HTMLElement,
  dark: boolean,
  renderWidth?: number,
  minWidth = 0,
  /** Width ÷ height of the hole the picture has to fill. Given it, the panel is
   *  measured once and then re-laid-out at the width that comes closest to that
   *  shape, so the frame is filled rather than merely fitted. */
  targetAspect?: number,
): Promise<HTMLCanvasElement> {
  const root = document.documentElement
  root.setAttribute('data-capturing', '')
  let restoreImages = () => {}
  let restoreGradients = () => {}
  let unstage = () => {}
  try {
    // Webfonts have to be resolved before html2canvas measures text, or the
    // fallback's metrics decide the line boxes.
    await document.fonts?.ready
    let target = node
    if (renderWidth) {
      const staged = await stage(node, renderWidth, dark)
      target = staged.el
      unstage = staged.done
      if (targetAspect) await fitToAspect(staged, targetAspect)
    } else {
      await settleImages(target)
    }
    restoreImages = hideUnrasterisable(target)
    // After the capture stylesheet is on, so a rule that changes a gradient in
    // capture mode is the one that gets written out.
    restoreGradients = unrollGradients(target)
    await twoFrames()
    // Capped at 4: past that a tall panel on a phone is a canvas big enough to
    // be refused outright, and a blank export is worse than a soft one.
    const natural = target.getBoundingClientRect().width || renderWidth || 1
    const scale = Math.max(2, Math.min(4, Math.ceil((minWidth / natural) * 2) / 2))
    const { default: html2canvas } = await import('html2canvas-pro')
    return await html2canvas(target, {
      backgroundColor: dark ? '#0c0b09' : '#ffffff',
      scale,
      useCORS: true,
      logging: false,
    })
  } finally {
    restoreGradients()
    restoreImages()
    unstage()
    root.removeAttribute('data-capturing')
  }
}

// Local-only test hook, so the screenshot harness can drive the real capture
// path (and catch regressions in the exported PNG) rather than a copy of it.
if (import.meta.env.DEV || location.hostname === 'localhost') {
  ;(window as unknown as { __rasterise?: typeof rasterise }).__rasterise = rasterise
}
