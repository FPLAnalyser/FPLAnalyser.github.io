import { SKIN, tierOf, initialsOf, type Tier } from './tiers'
import type { Player } from './squad'

/* A pitch card, painted to a canvas so it can be a texture.

   The 2D card is DOM: a padded gradient background with a rounded child on
   top. Canvas has no such trick, so the edge is a filled rounded rect and the
   stock is a second rounded rect inset by the padding — same result, and the
   inset has to shrink the radius too or the corners bulge.

   Texture size is deliberate rather than pretty: 320x420 is ~2.6x the largest
   size a card is ever drawn at on screen (136px wide), which is what keeps the
   name crisp when a card is near the camera. Every card in the squad is its
   own texture; 15 of these is 15 * 320*420*4 = 8MB of VRAM, which is nothing,
   but it is why a full 600-player board would need an atlas instead. */

export const CARD_W = 320
export const CARD_H = 420
/** World size of a card, in pitch metres. Started at 8.6 and came down: at
 *  that size a four-man midfield seen from behind the goal overlapped the back
 *  four however the rows were staggered, because a 8.6m-wide card is a player
 *  five metres across. 7.4 is the width at which the standing XI reads with
 *  clear air between every card and the name is still legible at the far
 *  post. */
export const CARD_WORLD_W = 7.4
export const CARD_WORLD_H = CARD_WORLD_W * (CARD_H / CARD_W)

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

function edgeFill(c: CanvasRenderingContext2D, tier: Tier): CanvasGradient {
  const skin = SKIN[tier]
  if (skin.conic) {
    // from 210deg, clockwise, about the card's centre — matches the CSS.
    const g = c.createConicGradient((210 * Math.PI) / 180, CARD_W / 2, CARD_H / 2)
    skin.edge.forEach((col, i) => g.addColorStop(i / (skin.edge.length - 1), col))
    return g
  }
  // 160deg in CSS is measured from "up", clockwise; canvas wants two points.
  const a = (160 - 90) * (Math.PI / 180)
  const len = Math.abs(CARD_W * Math.cos(a)) + Math.abs(CARD_H * Math.sin(a))
  const g = c.createLinearGradient(
    CARD_W / 2 - (Math.cos(a) * len) / 2, CARD_H / 2 - (Math.sin(a) * len) / 2,
    CARD_W / 2 + (Math.cos(a) * len) / 2, CARD_H / 2 + (Math.sin(a) * len) / 2,
  )
  skin.edge.forEach((col, i) => g.addColorStop(i / (skin.edge.length - 1), col))
  return g
}

export type CardOpts = {
  /** Replace the rating figure in the corner — the tier, and so the metal,
   *  still comes from the rating. Same contract as the 2D card's cornerText. */
  cornerText?: string
  /** Captain / vice armband. */
  armband?: 'C' | 'V' | null
  /** A second line under the name, used by the value-column variant to put
   *  the number the plinth height is showing on the card itself. */
  strap?: string
}

export function paintCard(p: Player, photo: HTMLImageElement | null, opts: CardOpts = {}): HTMLCanvasElement {
  const tier = tierOf(p.rating)
  const skin = SKIN[tier]
  const cv = document.createElement('canvas')
  cv.width = CARD_W
  cv.height = CARD_H
  const c = cv.getContext('2d')!

  const pad = skin.conic ? 9 : 7
  const R = 30

  // Foil edge.
  roundRect(c, 0, 0, CARD_W, CARD_H, R)
  c.fillStyle = edgeFill(c, tier)
  c.fill()

  // Stock.
  roundRect(c, pad, pad, CARD_W - pad * 2, CARD_H - pad * 2, R - pad)
  const st = c.createLinearGradient(0, 0, CARD_W * 0.3, CARD_H)
  skin.stock.forEach((col, i) => st.addColorStop(i / (skin.stock.length - 1), col))
  c.fillStyle = st
  c.fill()
  c.save()
  c.clip()

  // Rating. Big, top-left, in the tier's ink — the figure a shelf of cards
  // sorts itself by.
  c.fillStyle = skin.num
  c.font = '800 54px system-ui, -apple-system, "Segoe UI", sans-serif'
  c.textAlign = 'left'
  c.textBaseline = 'top'
  c.fillText(opts.cornerText ?? (p.rating != null ? String(p.rating) : '—'), 26, 22)

  // Position tag, top-right, so a card read from behind still says what it is.
  c.fillStyle = 'rgba(255,255,255,.38)'
  c.font = '800 20px system-ui, -apple-system, sans-serif'
  c.textAlign = 'right'
  c.fillText(p.position, CARD_W - 26, 34)

  // Headshot. Transparent cut-outs, so nothing is painted behind them.
  const ph = { x: CARD_W / 2 - 78, y: 92, w: 156, h: 168 }
  if (photo && photo.complete && photo.naturalWidth > 0) {
    const s = Math.min(ph.w / photo.naturalWidth, ph.h / photo.naturalHeight)
    const w = photo.naturalWidth * s
    const h = photo.naturalHeight * s
    c.drawImage(photo, ph.x + (ph.w - w) / 2, ph.y, w, h)
  } else {
    c.fillStyle = 'rgba(255,255,255,.28)'
    c.font = '800 62px system-ui, -apple-system, sans-serif'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(initialsOf(p.name), CARD_W / 2, ph.y + ph.h / 2)
  }

  // Name, with the armband taking its bite out of the row before the name is
  // measured — the 2D card steps type down for the same reason.
  c.textBaseline = 'alphabetic'
  let nameLeft = 0
  const nameY = 306
  if (opts.armband) {
    const r = 17
    const cx = 30 + r
    c.beginPath()
    c.arc(cx, nameY - 9, r, 0, Math.PI * 2)
    c.fillStyle = opts.armband === 'V' ? 'rgba(255,255,255,.85)' : '#00e0a4'
    c.fill()
    c.fillStyle = '#07110d'
    c.font = '900 22px system-ui, -apple-system, sans-serif'
    c.textAlign = 'center'
    c.fillText(opts.armband, cx, nameY - 1)
    nameLeft = r * 2 + 10
  }
  let size = 30
  c.font = `700 ${size}px system-ui, -apple-system, sans-serif`
  const room = CARD_W - 52 - nameLeft
  while (c.measureText(p.name).width > room && size > 18) {
    size -= 1
    c.font = `700 ${size}px system-ui, -apple-system, sans-serif`
  }
  c.fillStyle = '#fff'
  c.textAlign = 'center'
  c.fillText(p.name, CARD_W / 2 + nameLeft / 2, nameY)

  // Club and price.
  c.fillStyle = 'rgba(255,255,255,.55)'
  c.font = '600 21px system-ui, -apple-system, sans-serif'
  c.fillText(`${p.team} · £${p.price}m`, CARD_W / 2, nameY + 32)

  // Strap — the value-column variant's number, on a bar so it reads as a
  // measurement rather than another stat.
  if (opts.strap) {
    roundRect(c, 40, CARD_H - 62, CARD_W - 80, 38, 12)
    c.fillStyle = 'rgba(255,255,255,.10)'
    c.fill()
    c.fillStyle = skin.num
    c.font = '800 22px system-ui, -apple-system, sans-serif'
    c.fillText(opts.strap, CARD_W / 2, CARD_H - 35)
  }

  c.restore()
  return cv
}
