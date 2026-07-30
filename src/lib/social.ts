/* ════════════════════════════════════════════════════════════════════════
   The accounts every shared image carries.

   Both of them, on every image, whatever the format — a picture that gets
   reposted should say where it came from and where to find more, and which
   network it happens to land on isn't something the exporter can know.
   ════════════════════════════════════════════════════════════════════════ */

export const BRAND = 'FPL Analyser'
/** Where the picture came from, without the scheme — nobody types https://,
 *  and every character spent on it is a character not spent on the name.
 *
 *  This is the one thing on the footer that has a job to do. A handle asks
 *  someone to follow an account; the address is how a person who liked the
 *  picture actually arrives at the thing that made it, and most of them will
 *  read it and type it rather than tap anything. So it sits under the brand at
 *  full strength, not tucked in with the accounts. */
export const SITE_URL = 'fplanalyser.co.uk'
export const X_HANDLE = '@FPLAnalyser'
export const IG_HANDLE = 'fpl_analyser'


/** The X mark, on a 24×24 grid. */
export const X_MARK_PATH =
  'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'

/** Rounded rectangle, spelled out rather than relying on `roundRect` — it is
 *  recent enough that a slightly older phone would throw instead of drawing. */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Draw the X mark with its top-left at (x, y), `size` px square. */
export function drawXMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colour: string) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  ctx.fillStyle = colour
  ctx.fill(new Path2D(X_MARK_PATH))
  ctx.restore()
}

/** Draw the Instagram glyph with its top-left at (x, y), `size` px square. */
export function drawInstagramMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colour: string) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  ctx.strokeStyle = colour
  ctx.fillStyle = colour
  ctx.lineWidth = 2.2
  roundRectPath(ctx, 2.2, 2.2, 19.6, 19.6, 5.6)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(12, 12, 4.9, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(17.6, 6.4, 1.35, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
