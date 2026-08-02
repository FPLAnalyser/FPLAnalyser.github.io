/**
 * Read an FPL app squad screenshot.
 *
 * The FPL app's Pick Team screen draws every player as two stacked pills — his
 * name over his next fixture — on a green pitch. That is the whole basis of
 * this reader: find the pills, cut the type out of them, and hand the pieces
 * to an OCR engine. Nothing here knows anything about football; the matching
 * to actual players lives in `squadMatch.ts`.
 *
 * Two things make it tractable. The pills are a fixed width across the whole
 * screenshot, whatever the device, so the commonest component width IS the
 * card unit and everything scales off it. And a fixture pill says which club
 * the player is at — every (opponent, venue) pair in a gameweek belongs to
 * exactly one club — which cuts the pool a name has to be matched against from
 * five hundred players to about ten.
 *
 * The engine is Tesseract, self-hosted under `public/ocr/` and imported only
 * when this function is called: it is roughly 4.5MB over the wire and nobody
 * who never opens the importer should pay for it. Second use is free — the
 * language data goes into IndexedDB and the code into the service worker's
 * cache.
 */

/** Where the card sat on the pitch, and what its two pills said. */
export interface ShotCard {
  /** 0-based pitch row, top to bottom. */
  row: number
  /** Position within the row, left to right. */
  col: number
  /** Raw OCR of the name pill. */
  name: string
  /** Raw OCR of the fixture pill. */
  fixture: string
  /** Three-letter opponent code parsed out of the fixture pill, if it read. */
  opponent: string | null
  venue: 'H' | 'A' | null
  nameConf: number
  fixConf: number
}

export interface ShotRead {
  cards: ShotCard[]
  /** How many rows the pitch was split into — five for a normal team sheet. */
  rowCount: number
  /** Pixel width of one card unit, for diagnostics. */
  unit: number
}

export type ShotProgress = (stage: string, pct: number) => void

/** The height of one pill, as a fraction of the card unit's width. Measured
 *  off the app: a 195px-wide card has 44px pills. */
const PILL_RATIO = 44 / 195

/** Base URL for the self-hosted engine. `import.meta.env.BASE_URL` is './' on
 *  this build (Pages sub-path + Capacitor), which a Web Worker cannot resolve,
 *  so make it absolute against the document. */
function ocrBase(): string {
  return new URL(`${import.meta.env.BASE_URL}ocr/`, document.baseURI).href
}

interface Crop { canvas: HTMLCanvasElement; ink: number }

/**
 * Cut the two pills out of every card.
 *
 * White-mask the image, flood-fill it into connected components, and take the
 * commonest sizeable width as the card unit; a card is any component of that
 * width. The name and fixture pills touch, so one component covers both and
 * the bottom two pill-heights of it are the pair.
 *
 * Cropping is then done on the ink rather than on the bounding box. The white
 * component stops at the pill's coloured outline, so a bbox crop carries a few
 * pixels of that outline down each side and Tesseract reads a vertical stroke
 * as a character — three of fifteen names came back empty that way. Otsu the
 * band, take the minority class as ink, crop to the ink's extent.
 */
function segment(img: HTMLImageElement | ImageBitmap): { crops: { name: Crop; fixture: Crop; x: number; y: number }[]; unit: number } {
  const W = 'naturalWidth' in img ? img.naturalWidth : img.width
  const H = 'naturalHeight' in img ? img.naturalHeight : img.height
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const cx = c.getContext('2d', { willReadFrequently: true })!
  cx.drawImage(img as CanvasImageSource, 0, 0)
  const d = cx.getImageData(0, 0, W, H).data

  const white = new Uint8Array(W * H)
  for (let i = 0, px = 0; i < d.length; i += 4, px++) {
    const mx = Math.max(d[i], d[i + 1], d[i + 2])
    const mn = Math.min(d[i], d[i + 1], d[i + 2])
    white[px] = mn > 200 && mx - mn < 30 ? 1 : 0
  }

  const seen = new Uint8Array(W * H)
  const stack = new Int32Array(W * H)
  const comps: { x: number; y: number; w: number; h: number; n: number }[] = []
  for (let y = 0; y < H; y++) {
    for (let px = 0; px < W; px++) {
      const s = y * W + px
      if (!white[s] || seen[s]) continue
      let sp = 0
      stack[sp++] = s
      seen[s] = 1
      let x0 = px, x1 = px, y0 = y, y1 = y, n = 0
      while (sp) {
        const q = stack[--sp]
        n++
        const qx = q % W
        const qy = (q / W) | 0
        if (qx < x0) x0 = qx
        if (qx > x1) x1 = qx
        if (qy < y0) y0 = qy
        if (qy > y1) y1 = qy
        if (qx > 0 && white[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack[sp++] = q - 1 }
        if (qx < W - 1 && white[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack[sp++] = q + 1 }
        if (qy > 0 && white[q - W] && !seen[q - W]) { seen[q - W] = 1; stack[sp++] = q - W }
        if (qy < H - 1 && white[q + W] && !seen[q + W]) { seen[q + W] = 1; stack[sp++] = q + W }
      }
      comps.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, n })
    }
  }

  // A card's pills are wider than they are tall and cover a real area; the
  // thresholds scale with the image so a 750px-wide phone and a 1290px one
  // both work.
  const minArea = (W * H) / 900
  const big = comps.filter((k) => k.n > minArea && k.h >= W / 40)
  if (!big.length) return { crops: [], unit: 0 }
  const widths = new Map<number, number>()
  for (const k of big) widths.set(k.w, (widths.get(k.w) ?? 0) + 1)
  const unit = [...widths.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const cards = big.filter((k) => Math.abs(k.w - unit) <= Math.max(4, unit * 0.02))
  const PILL = Math.round(unit * PILL_RATIO)

  const cut = (x: number, w: number, yy: number, hh: number): Crop => {
    const IN = Math.max(3, Math.round(w * 0.036))
    const px = x + IN
    const pw = w - IN * 2
    if (pw < 8 || hh < 6 || yy < 0 || yy + hh > H) {
      const empty = document.createElement('canvas')
      empty.width = 8
      empty.height = 8
      return { canvas: empty, ink: 0 }
    }
    const im = cx.getImageData(px, yy, pw, hh)
    const g0 = new Float32Array(pw * hh)
    for (let i = 0, j = 0; i < im.data.length; i += 4, j++) {
      g0[j] = im.data[i] * 0.299 + im.data[i + 1] * 0.587 + im.data[i + 2] * 0.114
    }
    // Otsu: the band is two-tone, type and paper, whichever way round.
    const hist = new Array<number>(256).fill(0)
    for (const v of g0) hist[Math.round(v)]++
    let sum = 0
    for (let t = 0; t < 256; t++) sum += t * hist[t]
    let sumB = 0, wB = 0, best = 0, thr = 128
    for (let t = 0; t < 256; t++) {
      wB += hist[t]
      if (!wB) continue
      const wF = g0.length - wB
      if (!wF) break
      sumB += t * hist[t]
      const between = wB * wF * Math.pow(sumB / wB - (sum - sumB) / wF, 2)
      if (between > best) { best = between; thr = t }
    }
    /* Ink is the minority class, whichever side of the threshold it falls on.
     * Deciding it by the pill's mean luminance failed on the one card it
     * mattered for — a flagged player's pill is dark red with white type, and
     * a sample at the pill's centre lands mostly on the glyphs, reads "light",
     * and turns the whole red background into ink. Counting is not a
     * heuristic: type never covers more of a pill than its background does. */
    let nDark = 0
    for (let j = 0; j < g0.length; j++) if (g0[j] <= thr) nDark++
    const inkIsDark = nDark <= g0.length - nDark
    const ink = new Uint8Array(pw * hh)
    let count = 0
    for (let j = 0; j < g0.length; j++) {
      const on = inkIsDark ? g0[j] <= thr : g0[j] > thr
      ink[j] = on ? 1 : 0
      if (on) count++
    }
    let x0 = pw, x1 = -1, y0 = hh, y1 = -1
    for (let yy2 = 0; yy2 < hh; yy2++) {
      for (let xx = 0; xx < pw; xx++) {
        if (!ink[yy2 * pw + xx]) continue
        if (xx < x0) x0 = xx
        if (xx > x1) x1 = xx
        if (yy2 < y0) y0 = yy2
        if (yy2 > y1) y1 = yy2
      }
    }
    if (x1 < 0) { x0 = 0; x1 = pw - 1; y0 = 0; y1 = hh - 1 }
    const M = 6
    // Upscale so the smallest type clears Tesseract's ~30px x-height comfort
    // zone even on a 750px screenshot.
    const s = Math.max(2, Math.min(6, Math.round(120 / Math.max(1, y1 - y0 + 1))))
    const bw = x1 - x0 + 1
    const bh = y1 - y0 + 1
    const cc = document.createElement('canvas')
    cc.width = (bw + M * 2) * s
    cc.height = (bh + M * 2) * s
    const g = cc.getContext('2d')!
    g.fillStyle = '#fff'
    g.fillRect(0, 0, cc.width, cc.height)
    // Paint the binarised ink rather than resampling the original, so no
    // anti-aliased halo round a glyph ever reaches the recogniser.
    g.fillStyle = '#000'
    for (let yy2 = y0; yy2 <= y1; yy2++) {
      for (let xx = x0; xx <= x1; xx++) {
        if (ink[yy2 * pw + xx]) g.fillRect((xx - x0 + M) * s, (yy2 - y0 + M) * s, s, s)
      }
    }
    return { canvas: cc, ink: count }
  }

  const crops = cards.map((k) => {
    const bottom = k.y + k.h
    const top = bottom - PILL * 2
    const inset = Math.max(2, Math.round(PILL * 0.07))
    return {
      x: k.x,
      y: top,
      name: cut(k.x, k.w, top + inset, PILL - inset * 2),
      fixture: cut(k.x, k.w, top + PILL + inset - 1, PILL - inset * 2),
    }
  })
  crops.sort((a, b) => a.y - b.y || a.x - b.x)
  return { crops, unit }
}

/** Group cards into pitch rows by their y, tolerating a pixel or two of drift. */
function rowsOf(crops: { y: number }[], unit: number): number[] {
  const tol = Math.max(8, unit * 0.25)
  const rows: number[] = []
  let anchor = -1e9
  let n = -1
  for (const c of crops) {
    if (c.y - anchor > tol) { n++; anchor = c.y }
    rows.push(n)
  }
  return rows
}

const FIXTURE_RE = /([A-Z]{3})\s*\(?\s*([HA])\s*\)?/

export async function readSquadScreenshot(file: Blob, onProgress?: ShotProgress): Promise<ShotRead> {
  onProgress?.('Opening the picture', 2)
  const url = URL.createObjectURL(file)
  let img: HTMLImageElement
  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error("That file didn't open as an image."))
      el.src = url
    })
  } finally {
    // Revoking after decode is safe and keeps the blob from leaking if the
    // reader is opened several times.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  onProgress?.('Finding the cards', 8)
  const { crops, unit } = segment(img)
  if (crops.length < 5) {
    throw new Error(
      "Couldn't find the player cards in that picture. It needs to be a screenshot of the Pick Team screen in the FPL app — the pitch with a name and a fixture under each player.",
    )
  }

  onProgress?.('Loading the reader', 12)
  const { createWorker } = await import('tesseract.js')
  const base = ocrBase()
  const worker = await createWorker('eng', 1, {
    workerPath: `${base}worker.min.js`,
    // Pinned rather than left to pick a build: the SIMD cores are a few per
    // cent faster over thirty crops the size of a word, which is not worth
    // hosting three binaries and hoping the browser picks one we shipped.
    corePath: `${base}tesseract-core-lstm.wasm.js`,
    langPath: base,
    gzip: true,
    logger: () => {},
  })
  // Every crop is one line of type, already isolated.
  await worker.setParameters({ tessedit_pageseg_mode: '7' as never })

  const rows = rowsOf(crops, unit)
  const cards: ShotCard[] = []
  try {
    let colInRow = 0
    let lastRow = -1
    for (let i = 0; i < crops.length; i++) {
      onProgress?.('Reading the names', 15 + Math.round((i / crops.length) * 80))
      const nameRes = await worker.recognize(crops[i].name.canvas)
      const fixRes = await worker.recognize(crops[i].fixture.canvas)
      const fixture = fixRes.data.text.trim().replace(/\s+/g, ' ')
      const m = fixture.toUpperCase().match(FIXTURE_RE)
      if (rows[i] !== lastRow) { colInRow = 0; lastRow = rows[i] }
      cards.push({
        row: rows[i],
        col: colInRow++,
        name: nameRes.data.text.trim().replace(/\s+/g, ' '),
        fixture,
        opponent: m ? m[1] : null,
        venue: m ? (m[2] as 'H' | 'A') : null,
        nameConf: Math.round(nameRes.data.confidence),
        fixConf: Math.round(fixRes.data.confidence),
      })
    }
  } finally {
    await worker.terminate()
  }
  onProgress?.('Matching players', 98)
  return { cards, rowCount: rows.length ? rows[rows.length - 1] + 1 : 0, unit }
}
