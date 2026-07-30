/* ════════════════════════════════════════════════════════════════════════
   Rasterising a piece of the page to a PNG.

   TWO ENGINES, and the difference between them is the difference between a
   photograph and a copy painted from memory.

   PRIMARY — modern-screenshot. Wraps the panel in an SVG `<foreignObject>`
   and draws that, so the BROWSER lays it out and paints it. Whatever is on
   the screen is what lands in the file.

   FALLBACK — html2canvas-pro. Re-implements CSS layout and paint from
   scratch. It was the primary engine for a long time and everything below
   with `legacy` in its name exists because of what it gets wrong:

     · `background-clip: text` — unsupported, so every rating painted as a
       solid gold BLOCK where the digits should be, and had to be replaced by
       a flat colour. The gold, silver and bronze that make a rating look
       struck rather than typed simply could not survive the trip.
     · text position — every glyph drawn about half its own font size too
       low, while boxes stayed exactly where they were. Measured at 0.48em to
       0.59em across five type sizes. A club crest ended up nine and a half
       pixels above the name beside it, and cards came out taller than the
       real ones.
     · repeating gradients — drawn as their last colour and nothing else, so
       Bournemouth's stripes exported as solid black.
     · truncating text — sliced through the middle by a line box a few pixels
       too short.

   Every one of those is a workaround in this file or in the
   `[data-capturing="legacy"]` half of index.css, and every one of them is
   dead weight the moment the primary engine is doing the work. They stay
   because the fallback has to keep working when it is reached.

   Both put the document into capture mode first — a `data-capturing`
   attribute the stylesheet answers — and both always take it off again. The
   unsuffixed rules are the ones true of any picture: no share buttons in it,
   nothing clipped by a scrollbar, nothing stuck to a viewport it hasn't got.
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

/** Photograph the panel exactly as it is on screen.
 *
 *  Deliberately the live element and nothing clever. An earlier version cloned
 *  the panel into an off-screen iframe so it could be laid out at a width of
 *  our choosing — the same picture from a phone and a laptop, and the wide
 *  layout available to both. It worked in Chromium and produced garbage in iOS
 *  Safari: the cloned stylesheets never applied, so the export came out as
 *  unstyled HTML with default-blue names, photos at natural size and the
 *  ratings as solid blocks. Inline styles survived and nothing else did.
 *
 *  It is not obviously unfixable — a `<base>`, or serialising the rules into
 *  one inline <style> instead of cloning <link>s, would probably do it. But it
 *  is a cross-browser trick on the one path that has to work on the phone in
 *  somebody's hand, in a browser this sandbox cannot run. So it captures what
 *  the reader is actually looking at, which is the thing that is guaranteed to
 *  be styled correctly, because the browser styled it.
 *
 *  `minWidth` is the width the result has to reach. The capture scale is
 *  chosen so the canvas is at least that wide natively rather than being
 *  enlarged afterwards, which is the one part of the iframe attempt worth
 *  keeping: it is a plain html2canvas option and carries no layout risk. */
/** Did the capture come back empty?
 *
 *  The one failure the primary engine can have without throwing: Safari
 *  finishes loading the serialised SVG, reports success, and draws nothing.
 *  Samples a coarse grid rather than every pixel — a panel that is genuinely
 *  one flat colour over sixty-four sample points is not a panel worth
 *  exporting either, so a false positive costs a slower render and never a
 *  wrong picture. */
function looksBlank(canvas: HTMLCanvasElement, bg: string): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx || !canvas.width || !canvas.height) return true
  const probe = document.createElement('canvas').getContext('2d')!
  probe.fillStyle = bg
  probe.fillRect(0, 0, 1, 1)
  const [br, bgc, bb] = probe.getImageData(0, 0, 1, 1).data
  const STEPS = 8
  try {
    for (let i = 1; i <= STEPS; i++) {
      for (let j = 1; j <= STEPS; j++) {
        const x = Math.floor((canvas.width * i) / (STEPS + 1))
        const y = Math.floor((canvas.height * j) / (STEPS + 1))
        const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data
        if (a > 8 && (Math.abs(r - br) > 10 || Math.abs(g - bgc) > 10 || Math.abs(b - bb) > 10)) return false
      }
    }
  } catch {
    // Tainted canvas: unreadable, but that means something was drawn onto it.
    return false
  }
  return true
}

/** Exactly enough to reach the frame, and not a pixel more.
 *
 *  This used to round up to the next half — 3.02 became 3.5, which on the squad
 *  card meant a 1253px-wide canvas for a 1080px frame. Thirty-five percent more
 *  pixels to rasterise, encode and then throw away in the downscale, on the one
 *  export that was already the slowest thing on the site.
 *
 *  Floor of 2 so a small panel still exports at retina density; ceiling of 4
 *  because beyond that a tall panel on a phone is a canvas big enough to be
 *  refused outright, and a blank export is worse than a soft one. */
function captureScale(node: HTMLElement, minWidth: number): number {
  const live = node.getBoundingClientRect().width || 1
  return Math.max(2, Math.min(4, minWidth / live))
}

/** The old engine, kept as the parachute.
 *
 *  html2canvas re-implements layout and paint, which is why the workarounds
 *  above exist and why the `[data-capturing="legacy"]` half of the stylesheet
 *  exists. Nothing reaches this unless the primary engine throws. */
async function legacyShot(node: HTMLElement, dark: boolean, minWidth: number): Promise<HTMLCanvasElement> {
  const root = document.documentElement
  root.setAttribute('data-capturing', 'legacy')
  let restoreImages = () => {}
  let restoreGradients = () => {}
  try {
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
      scale: captureScale(node, minWidth),
      useCORS: true,
      logging: false,
    })
  } finally {
    restoreGradients()
    restoreImages()
    root.removeAttribute('data-capturing')
  }
}

/** Photograph a panel — actually photograph it, rather than redraw it.
 *
 *  The panel is serialised into an SVG `<foreignObject>` and that is drawn to a
 *  canvas, which means **the browser does the layout and the painting**. Not an
 *  approximation of the browser: the browser. Whatever it puts on the screen is
 *  what lands in the file.
 *
 *  That distinction is the whole reason for this module's history. The previous
 *  engine re-implemented CSS from scratch and got two things wrong that no
 *  amount of patching fixed:
 *
 *    · `background-clip: text` — unsupported, so the gold, silver and bronze
 *      gradients that make a rating look struck rather than typed had to be
 *      replaced by one flat colour.
 *    · text position — every glyph drawn about half its own font size too low,
 *      measured at 0.48em to 0.59em across five sizes, while boxes stayed put.
 *      So a club crest sat nine and a half pixels above the name beside it, and
 *      each card came out taller than the real one.
 *
 *  Both are simply gone: measured against a browser screenshot of the same
 *  card, the crest-to-name offset is zero in both, the numeral occupies the
 *  identical pixel span, and the gradient's colour ramp matches stop for stop.
 *
 *  The cost is a different set of requirements — fonts and images have to be
 *  inlined, which the library does by fetching them. Everything this site draws
 *  is same-origin, so there is nothing to negotiate. Where it does fail it
 *  throws, and the old engine catches the fall.
 *
 *  `minWidth` is the width the result has to reach; the scale is chosen so the
 *  canvas is at least that wide natively rather than enlarged afterwards. */
export async function rasterise(node: HTMLElement, dark: boolean, minWidth = 0): Promise<HTMLCanvasElement> {
  const root = document.documentElement
  // No engine suffix: only the rules that are true of any picture — no share
  // buttons in it, nothing clipped by a scrollbar, nothing stuck to a viewport
  // that the picture does not have.
  root.setAttribute('data-capturing', 'dom')
  let restoreImages = () => {}
  try {
    await document.fonts?.ready
    await settleImages(node)
    restoreImages = hideUnrasterisable(node)
    await twoFrames()
    const { domToCanvas } = await import('modern-screenshot')
    const bg = dark ? '#0c0b09' : '#ffffff'
    const canvas = await domToCanvas(node, {
      scale: captureScale(node, minWidth),
      backgroundColor: bg,
      features: {
        // Off, and it is the difference between one second and eleven.
        //
        // The library guards against Safari failing to decode a large SVG on
        // first draw by drawing it repeatedly. The guard is not sized to the
        // problem: it increments its retry count once per embedded image AND
        // once per CSS background-image, then waits `i + 100`ms before each
        // redraw. The squad card has thirty images and a great many gradients,
        // so it redrew about a hundred times on a rising delay — measured at
        // 10.8s under an iPhone user agent against 0.67s otherwise, for the
        // same card, the same nodes, the same output.
        //
        // Paying that on every export to insure against a failure that may not
        // happen is the wrong trade when the failure is *detectable*. So the
        // insurance comes off and the result is checked instead: a blank
        // canvas throws, and the throw lands on the old engine below, which
        // draws slowly but draws.
        fixSvgXmlDecode: false,
      },
    })
    if (looksBlank(canvas, bg)) throw new Error('empty capture')
    return canvas
  } catch {
    return await legacyShot(node, dark, minWidth)
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

