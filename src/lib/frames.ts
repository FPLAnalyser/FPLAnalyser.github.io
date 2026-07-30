/* ════════════════════════════════════════════════════════════════════════
   The shapes a share image comes in, and the arithmetic for fitting a
   captured panel into one.

   Shared, because there are two kinds of exportable thing on this site and
   they were drifting apart. Panels wrapped in <Exportable> — a captain
   podium, a fixture card, a leaderboard — get a title and a footer drawn
   around them. The squad card draws its own wordmark, gameweek and footer,
   because it is a poster rather than a slice of a page. Same frames, one set
   of numbers, different chrome.
   ════════════════════════════════════════════════════════════════════════ */

export type FormatId = 'post' | 'square' | 'wide' | 'story' | 'full'

export interface ShareFormat {
  id: FormatId
  label: string
  hint: string
  w: number
  /** Null takes the height from the content — see `frameHeight`. */
  h: number | null
}

/** What the networks actually accept.
 *
 *  Instagram's feed will not show anything taller than 4:5 and crops the rest;
 *  X gives a portrait post far more timeline height than a 16:9 one. So 4:5 is
 *  the default — the best in-feed size on both, and the one picture that can
 *  be posted anywhere without being recomposed. */
export const SHARE_FORMATS: readonly ShareFormat[] = [
  { id: 'post', label: 'Post', hint: '4:5', w: 1080, h: 1350 },
  { id: 'square', label: 'Square', hint: '1:1', w: 1080, h: 1080 },
  { id: 'wide', label: 'Wide', hint: '16:9', w: 1600, h: 900 },
  { id: 'story', label: 'Story', hint: '9:16', w: 1080, h: 1920 },
  { id: 'full', label: 'Full', hint: 'tall', w: 1080, h: null },
]

/** 9:16 is the tallest shape any network shows whole. Past it a picture is not
 *  "detailed", it is unpostable — so Full stops there and the content scales. */
const TALLEST = 16 / 9

/** How tall the finished image is.
 *
 *  For a fixed format, the format. For Full, whatever the content needs once
 *  the chrome has taken its share, capped. `chrome` is the vertical space the
 *  caller will draw into — zero for something that brands itself. */
export function frameHeight(fmt: ShareFormat, source: HTMLCanvasElement, chrome: number, pad: number): number {
  if (fmt.h != null) return fmt.h
  // Ceil, not round: the height reserved for the panel has to be at least the
  // height the panel gets drawn at, or the fit test fails by half a pixel.
  const wanted = Math.ceil((source.height / source.width) * (fmt.w - pad * 2)) + chrome
  return Math.min(wanted, Math.round(fmt.w * TALLEST))
}

/** Draw the panel into a box, centred, scaled to fit BOTH axes. Never crops.
 *
 *  A picture smaller than you hoped is a picture. A picture with the number cut
 *  in half is a mistake somebody screenshots and replies to. */
export function drawFitted(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  box: { x: number; y: number; w: number; h: number },
): void {
  const scale = Math.min(box.w / source.width, box.h / source.height)
  const dw = source.width * scale
  const dh = source.height * scale
  ctx.drawImage(source, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh)
}
