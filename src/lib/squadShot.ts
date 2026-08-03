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
  /** The captain's or vice-captain's disc, if this card wore one. */
  armband: 'C' | 'V' | null
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
function segment(img: HTMLImageElement | ImageBitmap): { crops: { name: Crop; fixture: Crop; badge: HTMLCanvasElement | null; x: number; y: number }[]; unit: number } {
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

  /* One pill's height, measured rather than assumed.
   *
   * It used to come off the width via PILL_RATIO, which holds on the Pick Team
   * screen and does not hold on the share/export image: there the block was 51px
   * for a 138px card, against the 62px the ratio predicts. An 11px overshoot
   * across two pills lifts the name band off the pill and onto the shirt above,
   * so ten of fifteen names came back mangled — and on one card the shirt was
   * dark enough to outvote the pill and invert the ink, handing Tesseract white
   * type knocked out of a black slab.
   *
   * A card's block is the two pills stacked, so half its height is one pill.
   * Not per-card, though: a white kit flood-fills straight into the block (two
   * cards here measured 130px against 51), so take the median over the squad
   * and let the merged ones ride on it. The bottom edge is unaffected by the
   * merge — both cards in that row ended at the same y — so cropping upward
   * from the bottom stays correct. */
  const halves = cards
    .map((k) => k.h / 2)
    .filter((v) => v > unit * 0.10 && v < unit * 0.35)
    .sort((a, b) => a - b)
  const PILL = Math.round(halves.length ? halves[halves.length >> 1] : unit * PILL_RATIO)

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

    /* Stretch the contrast, then let the browser resample — do NOT paint the
     * binarised mask.
     *
     * Painting the mask as s×s blocks was meant to keep anti-aliased haloes
     * away from the recogniser, and on a Pick Team screenshot it costs nothing.
     * On the share/export image the type is about ten pixels tall, and there a
     * hard threshold shuts the counters in a, e, o and g: measured on that
     * file, "Kayode" came back "Tv Och" and "Szoboszlai" "Srobosziai" off
     * perfectly well-placed crops. The half-lit edge pixels are not noise at
     * that size, they are most of what distinguishes one round letter from
     * another.
     *
     * So map the two Otsu classes onto black and white — which also flips a
     * light-on-dark pill the right way up, since the ramp runs ink→paper
     * whichever order those two sit in — and keep everything in between. */
    let inkSum = 0, papSum = 0
    for (let j = 0; j < g0.length; j++) (ink[j] ? (inkSum += g0[j]) : (papSum += g0[j]))
    const inkMean = count ? inkSum / count : 0
    const papMean = g0.length > count ? papSum / (g0.length - count) : 255
    const span = papMean - inkMean || 1
    const flat = document.createElement('canvas')
    flat.width = bw
    flat.height = bh
    const fg = flat.getContext('2d')!
    const out = fg.createImageData(bw, bh)
    for (let yy2 = y0; yy2 <= y1; yy2++) {
      for (let xx = x0; xx <= x1; xx++) {
        const v = Math.max(0, Math.min(255, ((g0[yy2 * pw + xx] - inkMean) / span) * 255))
        const o = ((yy2 - y0) * bw + (xx - x0)) * 4
        out.data[o] = out.data[o + 1] = out.data[o + 2] = v
        out.data[o + 3] = 255
      }
    }
    fg.putImageData(out, 0, 0)

    const cc = document.createElement('canvas')
    cc.width = (bw + M * 2) * s
    cc.height = (bh + M * 2) * s
    const g = cc.getContext('2d')!
    g.fillStyle = '#fff'
    g.fillRect(0, 0, cc.width, cc.height)
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    g.drawImage(flat, M * s, M * s, bw * s, bh * s)
    return { canvas: cc, ink: count }
  }

  /**
   * The captain's or vice-captain's disc.
   *
   * A small circle at the card's top-left, above the shirt: near-black with a
   * magenta cast — measured at rgb(37,2,44), (45,6,53), (54,6,58) — carrying a
   * white letter. Nothing else on the pitch is that colour; the grass is
   * (54,119,77), so a low green channel with the red and blue lifted well
   * clear of it isolates the disc on its own.
   *
   * Found rather than measured off a fixed offset, because the only fixed
   * thing in the screenshot is the card unit — everything else scales with the
   * device. Search a generous window, take the largest blob, then read the
   * letter out of the middle of it.
   */
  const armband = (cardX: number, nameTop: number): HTMLCanvasElement | null => {
    const x0 = Math.max(0, Math.round(cardX - unit * 0.05))
    const x1 = Math.min(W - 1, Math.round(cardX + unit * 0.40))
    const y0 = Math.max(0, Math.round(nameTop - unit * 1.15))
    const y1 = Math.min(H - 1, Math.round(nameTop - unit * 0.45))
    if (x1 <= x0 || y1 <= y0) return null
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1
    const im = cx.getImageData(x0, y0, bw, bh).data
    const disc = new Uint8Array(bw * bh)
    let n = 0
    for (let i = 0, j = 0; i < im.length; i += 4, j++) {
      const r = im[i], g = im[i + 1], b = im[i + 2]
      if (g < 45 && r > g + 15 && b > g + 20 && b > 25) { disc[j] = 1; n++ }
    }
    // A disc is about a tenth of the card across; anything much smaller is a
    // dark seam in a kit, not a badge.
    if (n < unit * unit * 0.004) return null
    /* The most disc-shaped connected blob — not the biggest, and not the
     * bounding box of every matching pixel.
     *
     * Taking the whole mask's bounding box worked on the card whose disc sits
     * against a pale shirt panel and failed on the one whose disc sits against
     * the pitch: a few stray dark pixels down the card's edge stretched a
     * 40px circle into a 68x89 box, the roundness test still passed, and the
     * letter was then read out of a crop that was mostly grass.
     *
     * Taking the largest blob then failed on dark-red kits. Man Utd, Liverpool
     * and Sunderland shirts all throw a shadow that clears the colour mask, and
     * measured on one screenshot it came to 49x39 against the real disc's
     * 29x29 — twice the area, so it won, and a vice-captaincy landed on the
     * wrong player.
     *
     * The disc's size is the thing that actually holds still: 28-30px across on
     * two screenshots whose card unit was 195, and 20px on one whose unit was
     * 138. That is 0.14-0.16 of the unit every time, so ask for that, round,
     * and reasonably solid — a circle fills about 0.79 of its box before the
     * letter is knocked out of it. */
    const rMin = unit * 0.10
    const rMax = unit * 0.21
    const mark = new Int32Array(bw * bh).fill(-1)
    const q = new Int32Array(bw * bh)
    let bestN = 0, dx0 = 0, dx1 = -1, dy0 = 0, dy1 = -1
    for (let s = 0; s < disc.length; s++) {
      if (!disc[s] || mark[s] >= 0) continue
      let qs = 0, qe = 0
      q[qe++] = s
      mark[s] = s
      let ax0 = s % bw, ax1 = ax0, ay0 = (s / bw) | 0, ay1 = ay0, an = 0
      while (qs < qe) {
        const t = q[qs++]
        an++
        const tx = t % bw, ty = (t / bw) | 0
        if (tx < ax0) ax0 = tx
        if (tx > ax1) ax1 = tx
        if (ty < ay0) ay0 = ty
        if (ty > ay1) ay1 = ty
        if (tx > 0 && disc[t - 1] && mark[t - 1] < 0) { mark[t - 1] = s; q[qe++] = t - 1 }
        if (tx < bw - 1 && disc[t + 1] && mark[t + 1] < 0) { mark[t + 1] = s; q[qe++] = t + 1 }
        if (ty > 0 && disc[t - bw] && mark[t - bw] < 0) { mark[t - bw] = s; q[qe++] = t - bw }
        if (ty < bh - 1 && disc[t + bw] && mark[t + bw] < 0) { mark[t + bw] = s; q[qe++] = t + bw }
      }
      const aw = ax1 - ax0 + 1, ah = ay1 - ay0 + 1
      const round = Math.min(aw, ah) / Math.max(aw, ah)
      const fill = an / (aw * ah)
      if (aw < rMin || aw > rMax || ah < rMin || ah > rMax) continue
      if (aw < 8 || ah < 8 || round < 0.8 || fill < 0.45) continue
      if (an > bestN) { bestN = an; dx0 = ax0; dx1 = ax1; dy0 = ay0; dy1 = ay1 }
    }
    if (bestN < unit * unit * 0.004) return null
    const dw = dx1 - dx0 + 1, dh = dy1 - dy0 + 1
    // Inset well inside the circle so its curved edge, and the grass outside
    // it, never reach the letter.
    const pad = Math.round(Math.min(dw, dh) * 0.2)
    const lx0 = dx0 + pad, ly0 = dy0 + pad
    const lw = dw - pad * 2, lh = dh - pad * 2
    if (lw < 4 || lh < 4) return null
    /* The letter is the bright part of the disc, found relative to the disc
     * rather than against a fixed level. A flat `> 140` worked on a crisp
     * screenshot and silently dropped every badge on the share/export image,
     * whose glyphs render dimmer than that — which looked like the crosses
     * being rejected on purpose when it was really the reader going blind. */
    let lo = 255, hi = 0
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
      const p = ((ly0 + y) * bw + (lx0 + x)) * 4
      const v = im[p] * 0.299 + im[p + 1] * 0.587 + im[p + 2] * 0.114
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    // Too little separation and there is no glyph in there, just flat colour.
    if (hi - lo < 40) return null
    const lit = lo + (hi - lo) * 0.55
    const ink = new Uint8Array(lw * lh)
    let ix0 = lw, ix1 = -1, iy0 = lh, iy1 = -1, ink_n = 0
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
      const p = ((ly0 + y) * bw + (lx0 + x)) * 4
      if ((im[p] * 0.299 + im[p + 1] * 0.587 + im[p + 2] * 0.114) > lit) {
        ink[y * lw + x] = 1; ink_n++
        if (x < ix0) ix0 = x; if (x > ix1) ix1 = x; if (y < iy0) iy0 = y; if (y > iy1) iy1 = y
      }
    }
    if (ink_n < 6 || ix1 < 0) return null
    const M = 8, s = Math.max(4, Math.round(140 / Math.max(1, iy1 - iy0 + 1)))
    const cw = ix1 - ix0 + 1, ch = iy1 - iy0 + 1
    const cc = document.createElement('canvas')
    cc.width = (cw + M * 2) * s
    cc.height = (ch + M * 2) * s
    const g = cc.getContext('2d')!
    g.fillStyle = '#fff'
    g.fillRect(0, 0, cc.width, cc.height)
    g.fillStyle = '#000'
    for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) {
      if (ink[y * lw + x]) g.fillRect((x - ix0 + M) * s, (y - iy0 + M) * s, s, s)
    }
    return cc
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
      badge: armband(k.x, top),
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
      let nameRes = await worker.recognize(crops[i].name.canvas)
      /* psm 7 says "one line of type", which every crop is, and it is the right
       * default. It does occasionally decide a short crop is something other
       * than a line and return a single character for it — measured on the
       * share/export image, a clean, plainly legible "Kerkez" came back as "4"
       * at 95 confidence. psm 6 read it correctly and agreed with psm 7 on the
       * other fourteen names, so it makes a good second opinion. Only reach for
       * it when the first read is too short to be a surname; on a normal card
       * this costs nothing. */
      if (nameRes.data.text.replace(/[^A-Za-z]/g, '').length < 3) {
        await worker.setParameters({ tessedit_pageseg_mode: '6' as never })
        const alt = await worker.recognize(crops[i].name.canvas)
        await worker.setParameters({ tessedit_pageseg_mode: '7' as never })
        if (alt.data.text.replace(/[^A-Za-z]/g, '').length >= 3) nameRes = alt
      }
      const fixRes = await worker.recognize(crops[i].fixture.canvas)
      const fixture = fixRes.data.text.trim().replace(/\s+/g, ' ')
      const m = fixture.toUpperCase().match(FIXTURE_RE)
      let armband: 'C' | 'V' | null = null
      if (crops[i].badge) {
        /* One character, from a small alphabet. Say so: an unconstrained read
         * of a lone glyph offers up G, 0, U and Y just as readily.
         *
         * X is in the list without being an answer. The share/export image puts
         * a remove badge on every card that is the same plum colour, the same
         * shape and — measured — the same 0.145 of the card unit as the armband
         * disc, so shape alone cannot tell them apart. Whitelisting only CV
         * forces each of those crosses to come back as a C or a V, which is
         * fifteen spurious captaincies on one picture. Offer the engine the
         * right answer and it takes it. */
        await worker.setParameters({ tessedit_pageseg_mode: '10' as never, tessedit_char_whitelist: 'CVX' })
        const t = (await worker.recognize(crops[i].badge!)).data.text.trim().toUpperCase()
        await worker.setParameters({ tessedit_pageseg_mode: '7' as never, tessedit_char_whitelist: '' })
        if (t === 'C' || t === 'V') armband = t
      }
      if (rows[i] !== lastRow) { colInRow = 0; lastRow = rows[i] }
      cards.push({
        row: rows[i],
        col: colInRow++,
        name: nameRes.data.text.trim().replace(/\s+/g, ' '),
        fixture,
        opponent: m ? m[1] : null,
        venue: m ? (m[2] as 'H' | 'A') : null,
        armband,
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
