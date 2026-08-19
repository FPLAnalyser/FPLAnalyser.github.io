import { PITCH_W, PITCH_L } from './squad'

/* The grass, painted once to a canvas and used as the ground plane's map.

   The 2D pitch draws its markings as an SVG with a 300x406 viewBox and
   hand-placed boxes. That geometry is tuned for a portrait card board, not for
   something you look across at eye level, and in perspective the wrong
   proportions are obvious — a 62-deep penalty area on a 406-long pitch is
   nearly a third of the half. So these are the real ones, in metres, on a
   68x100 field: 40.32 x 16.5 penalty area, 18.32 x 5.5 goal area, 9.15 centre
   circle, spot at 11. Same white, same mown stripes, correct shapes. */

/** Metres of surround outside the touchline, so the pitch has a border to sit
 *  in rather than ending at the paint. */
const SURROUND = 5
const TEX_W = 1100
const PX = TEX_W / (PITCH_W + SURROUND * 2)
const TEX_H = Math.round((PITCH_L + SURROUND * 2) * PX)

/** Pitch metres -> canvas pixels. x runs -34..34, z runs -50..50. */
const px = (x: number) => (x + PITCH_W / 2 + SURROUND) * PX
const pz = (z: number) => (z + PITCH_L / 2 + SURROUND) * PX

export const PITCH_TEX_W = PITCH_W + SURROUND * 2
export const PITCH_TEX_L = PITCH_L + SURROUND * 2

export function paintPitch(): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = TEX_W
  cv.height = TEX_H
  const c = cv.getContext('2d')!

  // Base green, darkening downfield the way the 2D board's does.
  const g = c.createLinearGradient(0, 0, 0, TEX_H)
  g.addColorStop(0, '#1b7a3a')
  g.addColorStop(0.45, '#15682f')
  g.addColorStop(1, '#125c29')
  c.fillStyle = g
  c.fillRect(0, 0, TEX_W, TEX_H)

  // Mown stripes across the width, 14 bands like the 2D pitch. Alternating
  // light-on / light-off rather than two greens, so they survive being lit.
  const bands = 14
  const bh = TEX_H / bands
  for (let i = 0; i < bands; i++) {
    c.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,.045)' : 'rgba(0,0,0,.05)'
    c.fillRect(0, i * bh, TEX_W, bh)
  }

  // A soft light from the near touchline, which is what stops a flat-lit
  // plane reading as a green rectangle.
  const rg = c.createRadialGradient(TEX_W / 2, 0, 0, TEX_W / 2, 0, TEX_H * 0.8)
  rg.addColorStop(0, 'rgba(255,255,255,.10)')
  rg.addColorStop(1, 'rgba(255,255,255,0)')
  c.fillStyle = rg
  c.fillRect(0, 0, TEX_W, TEX_H)

  // Surround, just outside the touchline — a darker apron so the paint reads
  // as the edge of a field rather than the edge of the texture.
  c.fillStyle = 'rgba(0,0,0,.16)'
  c.fillRect(0, 0, TEX_W, pz(-PITCH_L / 2))
  c.fillRect(0, pz(PITCH_L / 2), TEX_W, TEX_H - pz(PITCH_L / 2))
  c.fillRect(0, 0, px(-PITCH_W / 2), TEX_H)
  c.fillRect(px(PITCH_W / 2), 0, TEX_W - px(PITCH_W / 2), TEX_H)

  // Markings.
  c.strokeStyle = 'rgba(255,255,255,.62)'
  c.lineWidth = 0.24 * PX
  c.lineCap = 'butt'

  const rect = (x: number, z: number, w: number, l: number) =>
    c.strokeRect(px(x), pz(z), w * PX, l * PX)

  // Touchlines and goal lines.
  rect(-PITCH_W / 2, -PITCH_L / 2, PITCH_W, PITCH_L)

  // Halfway line.
  c.beginPath()
  c.moveTo(px(-PITCH_W / 2), pz(0))
  c.lineTo(px(PITCH_W / 2), pz(0))
  c.stroke()

  // Centre circle and spot.
  c.beginPath()
  c.arc(px(0), pz(0), 9.15 * PX, 0, Math.PI * 2)
  c.stroke()
  c.beginPath()
  c.arc(px(0), pz(0), 0.35 * PX, 0, Math.PI * 2)
  c.fillStyle = 'rgba(255,255,255,.62)'
  c.fill()

  // Both ends: penalty area, goal area, spot, D, and the goal frame.
  for (const end of [-1, 1] as const) {
    const goalZ = (PITCH_L / 2) * end
    const pa = 16.5 * -end
    const ga = 5.5 * -end
    rect(-40.32 / 2, Math.min(goalZ, goalZ + pa), 40.32, 16.5)
    rect(-18.32 / 2, Math.min(goalZ, goalZ + ga), 18.32, 5.5)

    const spotZ = goalZ + 11 * -end
    c.beginPath()
    c.arc(px(0), pz(spotZ), 0.35 * PX, 0, Math.PI * 2)
    c.fill()

    // The D: the part of the 9.15 circle about the spot that falls outside
    // the penalty area. Drawn by clipping to the field beyond the box line.
    c.save()
    c.beginPath()
    const boxEdge = goalZ + 16.5 * -end
    if (end === -1) c.rect(0, pz(boxEdge), TEX_W, TEX_H)
    else c.rect(0, 0, TEX_W, pz(boxEdge))
    c.clip()
    c.beginPath()
    c.arc(px(0), pz(spotZ), 9.15 * PX, 0, Math.PI * 2)
    c.stroke()
    c.restore()

    // Corner arcs.
    for (const side of [-1, 1] as const) {
      c.beginPath()
      c.arc(px((PITCH_W / 2) * side), pz(goalZ), 1 * PX, 0, Math.PI * 2)
      c.stroke()
    }
  }

  return cv
}
