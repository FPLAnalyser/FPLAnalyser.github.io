import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { shareImageNative } from '../lib/native'
import { rasterise } from '../lib/capture'
import { BRAND, SITE_URL, X_HANDLE, IG_HANDLE, drawXMark, drawInstagramMark } from '../lib/social'

/* ════════════════════════════════════════════════════════════════════════
   Share anything: wrap a table or chart in <Exportable> and it gains a
   quiet "Share" button that rasterises the panel to a branded PNG — sized
   for Twitter/X or Instagram — with the site name and the author's handle
   burned in, so a screenshot that travels always carries its source.
   ════════════════════════════════════════════════════════════════════════ */

/** Fixed branding. Every export carries the site name and BOTH accounts,
 * whatever shape it was exported at — the exporter cannot know which network
 * a picture ends up on, and a repost should still say where to find more.
 * A visitor sharing our analysis cannot rewrite the credit, by design. */
const SITE_NAME = BRAND

type Format = 'post' | 'square' | 'wide' | 'story' | 'full'

/** The shapes worth exporting, and the layout width each one is drawn at.
 *
 *  `render` is the viewport the panel is laid out in before it is photographed
 *  (see `stage` in capture.ts). It is the whole reason these look designed
 *  rather than cropped: a tall frame renders the panel narrow so it stacks and
 *  fills the height, a wide frame renders it wide so it becomes a row. The site
 *  is already responsive — the exporter just picks which response it wants.
 *
 *  The sizes are what the networks actually accept, which is not what the old
 *  list claimed. Instagram's feed will not show anything taller than 4:5 and
 *  crops the rest; X gives a portrait post far more timeline height than a
 *  16:9 one. So 4:5 is the default — it is the best in-feed size on both, and
 *  the one picture that can be posted anywhere without being recomposed. */
const FORMATS: { id: Format; label: string; hint: string; w: number; h: number | null; render: number }[] = [
  { id: 'post', label: 'Post', hint: '4:5', w: 1080, h: 1350, render: 560 },
  { id: 'square', label: 'Square', hint: '1:1', w: 1080, h: 1080, render: 700 },
  { id: 'wide', label: 'Wide', hint: '16:9', w: 1600, h: 900, render: 1200 },
  { id: 'story', label: 'Story', hint: '9:16', w: 1080, h: 1920, render: 520 },
  // Height from the content, so nothing is ever shrunk to fit a shape it does
  // not have. Capped at 9:16 in `brand` — past that a picture stops being
  // postable anywhere and becomes a screenshot of a screenshot.
  { id: 'full', label: 'Full', hint: 'tall', w: 1080, h: null, render: 620 },
]

/** The hole the panel gets, once the title and the footer have taken theirs.
 *
 *  Kept next to `brand`, which does the same arithmetic to place the panel —
 *  they have to agree, or the exporter lays the content out for a shape it is
 *  then drawn into at a different one. Null for a format whose height comes
 *  from the content, since that one fits by construction. */
function contentAspect(fmt: (typeof FORMATS)[number]): number | undefined {
  if (fmt.h == null) return undefined
  const pad = Math.round(fmt.w * 0.045)
  const top = pad + 34 + Math.round(fmt.w * 0.028)
  const footH = Math.round(fmt.w * 0.095)
  return (fmt.w - pad * 2) / (fmt.h - top - footH - pad)
}

/** Draw the captured panel onto a branded canvas of the chosen aspect. */
function brand(source: HTMLCanvasElement, fmt: (typeof FORMATS)[number], title: string, dark: boolean): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = fmt.w
  // Full: chrome + the panel at full width, so nothing is ever shrunk.
  const autoPad = Math.round(fmt.w * 0.045)
  const autoChrome = autoPad + 34 + Math.round(fmt.w * 0.028) + Math.round(fmt.w * 0.095) + autoPad
  // Ceil, not round. The height reserved for the panel has to be at least the
  // height the panel will be drawn at; rounding down by half a pixel used to
  // make the fit test fail.
  const wanted = fmt.h ?? Math.ceil((source.height / source.width) * (fmt.w - autoPad * 2)) + autoChrome
  // 9:16 is the tallest shape any network will show whole. Past it the picture
  // is not "detailed", it is unpostable, so Full stops there and the content
  // scales instead.
  out.height = Math.min(wanted, Math.round(fmt.w * (16 / 9)))
  const ctx = out.getContext('2d')!
  const bg = dark ? '#0c0b09' : '#faf8f3'
  const ink = dark ? '#f4efe3' : '#1b1712'

  ctx.fillStyle = bg
  ctx.fillRect(0, 0, out.width, out.height)

  // Header: title left, wordmark right.
  const pad = Math.round(out.width * 0.045)
  const headY = pad + 34
  ctx.fillStyle = ink
  ctx.font = `700 ${Math.round(out.width * 0.028)}px ui-sans-serif, system-ui, sans-serif`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(title, pad, headY)
  ctx.fillStyle = '#c9a227'
  ctx.font = `400 ${Math.round(out.width * 0.023)}px Montserrat, ui-sans-serif, system-ui, sans-serif`
  ctx.textAlign = 'right'
  ctx.fillText(SITE_NAME, out.width - pad, headY)
  ctx.textAlign = 'left'

  // Panel, centred and scaled to fit between header and footer.
  const top = headY + Math.round(out.width * 0.028)
  const footH = Math.round(out.width * 0.095)
  const availW = out.width - pad * 2
  const availH = out.height - top - footH - pad
  // Fit inside the frame on BOTH axes. Never crop.
  //
  // This used to fill the width and then, if the result was too tall, draw the
  // top of the panel at full size and fade the cut. It read as a deliberate
  // "there's more where this came from" and was in fact a bug that threw the
  // content away: the captain podium is three players, and every fixed format
  // exported one of them plus half of Haaland's expected points, the digits
  // sliced through the middle by a gradient. The fixture card expands itself
  // before capture precisely so the projected points make the picture — and
  // then the 16:9 crop removed them again.
  //
  // A picture that is smaller than you hoped is a picture. A picture with the
  // number cut in half is a mistake somebody screenshots and replies to.
  const scale = Math.min(availW / source.width, availH / source.height)
  const dw = source.width * scale
  const dh = source.height * scale
  ctx.drawImage(source, pad + (availW - dw) / 2, top + (availH - dh) / 2, dw, dh)

  // Footer: brand on the left, both accounts on the right, over a hairline.
  ctx.strokeStyle = dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.12)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(pad, out.height - footH)
  ctx.lineTo(out.width - pad, out.height - footH)
  ctx.stroke()

  const mid = out.height - footH / 2
  const handleSize = Math.round(out.width * 0.023)
  const iconSize = Math.round(out.width * 0.027)
  const gap = Math.round(out.width * 0.009)   // icon to its handle
  const between = Math.round(out.width * 0.028) // one account to the next

  // Wordmark and address stacked on the left. The address is the only thing
  // in this footer with a job beyond credit: a handle asks for a follow, an
  // address is how someone who liked the picture reaches the thing that made
  // it — and most people read it off the image and type it rather than
  // tapping anything. So it gets its own line at full ink, not a slot in
  // among the accounts.
  const lead = Math.round(out.width * 0.017)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = `400 ${Math.round(out.width * 0.027)}px Montserrat, ui-sans-serif, system-ui, sans-serif`
  ctx.fillStyle = '#c9a227'
  ctx.fillText(SITE_NAME, pad, mid - lead)
  ctx.font = `700 ${Math.round(out.width * 0.023)}px ui-sans-serif, system-ui, sans-serif`
  ctx.fillStyle = ink
  ctx.fillText(SITE_URL, pad, mid + lead)

  // Measured, then laid out right-to-left, so both accounts sit against the
  // right margin however wide the frame is.
  ctx.font = `700 ${handleSize}px ui-sans-serif, system-ui, sans-serif`
  const xW = ctx.measureText(X_HANDLE).width
  const igW = ctx.measureText(IG_HANDLE).width
  const total = iconSize + gap + xW + between + iconSize + gap + igW
  let cursor = out.width - pad - total

  drawXMark(ctx, cursor, mid - iconSize / 2, iconSize, ink)
  cursor += iconSize + gap
  ctx.fillStyle = ink
  ctx.fillText(X_HANDLE, cursor, mid)
  cursor += xW + between
  drawInstagramMark(ctx, cursor, mid - iconSize / 2, iconSize, ink)
  cursor += iconSize + gap
  ctx.fillText(IG_HANDLE, cursor, mid)

  ctx.textBaseline = 'alphabetic'
  return out
}

export function Exportable({ title, filename, children, className, toolbar, variant = 'row', beforeCapture, afterCapture }: {
  title: string
  filename?: string
  children: ReactNode
  className?: string
  /** Controls to sit on the same line as the Share button. Without this the
   *  button gets a row of its own, which on a crowded panel is a whole line
   *  of height spent on one small control. */
  toolbar?: ReactNode
  /** `corner` puts the trigger inside the panel's top-right instead of on a
   *  row above it, and floats the format chooser over the panel rather than
   *  pushing it down. For a grid of small cards — a round of fixtures — a row
   *  per card is a row of chrome per card, and the layout is the content. */
  variant?: 'row' | 'corner'
  /** Put the panel into the state worth photographing, and put it back after.
   *
   *  A fixture card is collapsed by default, so the obvious implementation
   *  shared a picture of a header — the projected goals and nothing else,
   *  while the expected points and the team news that make it worth sending
   *  sat behind a tap. The panel opens itself for the capture instead. */
  beforeCapture?: () => void
  afterCapture?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  // 4:5 by default: the one shape that posts whole to an X timeline and an
  // Instagram feed without either of them recomposing it.
  const [fmt, setFmt] = useState<Format>('post')

  useEffect(() => {
    if (!open) setMsg('')
  }, [open])

  const run = async (mode: 'share' | 'download') => {
    if (!ref.current) return
    setBusy(true)
    setMsg('')
    beforeCapture?.()
    // Two frames: one for React to commit the state the hook just set, one for
    // the browser to lay it out. Without the wait html2canvas measures the card
    // as it was — collapsed — and the expansion never makes the picture.
    if (beforeCapture) await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    try {
      // The theme lives on data-mode, not a class — checking for a `.light`
      // class that never existed meant every export was framed as dark, so a
      // reader in light mode got their pale panel mounted on black with cream
      // titles over it.
      const dark = document.documentElement.dataset.mode !== 'light'
      const spec = FORMATS.find((f) => f.id === fmt)!
      // Laid out at the format's own width, and captured at a scale that
      // reaches the frame natively — so the export is the same picture on a
      // phone and a laptop, and is never a bitmap stretched to fit.
      const shot = await rasterise(ref.current, dark, spec.render, spec.w, contentAspect(spec))
      const canvas = brand(shot, spec, title, dark)
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/png'))
      if (!blob) throw new Error('render failed')
      const name = `${filename ?? title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${fmt}.png`

      if (mode === 'share') {
        if (await shareImageNative(blob, name, `${title} — ${SITE_NAME}`)) { setOpen(false); return }
        const file = new File([blob], name, { type: 'image/png' })
        const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean }
        if (nav.canShare?.({ files: [file] }) && navigator.share) {
          await navigator.share({ files: [file], title: `${title} — ${SITE_NAME}` })
          setOpen(false)
          return
        }
        setMsg('This browser has no share sheet — the image has been saved to your downloads instead.')
      }
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      setMsg('Could not render the image on this device — try a screenshot instead.')
    } finally {
      afterCapture?.()
      setBusy(false)
    }
  }

  /* The chooser is the same in both variants; only where it sits changes. */
  const chooser = (
    <>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFmt(f.id)}
            className={`min-h-8 rounded-full border px-3 text-[12px] font-semibold transition-colors ${
              fmt === f.id ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong'
            }`}
          >
            {f.label} <span className="font-normal">{f.hint}</span>
          </button>
        ))}
      </div>
      {/* One action. "Share" and "Download" were the same picture reached two
          ways, and on a phone — where almost all of this is read — the share
          sheet already offers Save Image as one of its options. Where a
          browser has no share sheet at all the file still downloads; it just
          isn't a decision the reader has to make first. */}
      <button
        onClick={() => run('share')}
        disabled={busy}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-accent bg-accent-soft px-3.5 text-[13px] font-semibold text-accent disabled:opacity-60"
      >
        <Icon name="users" size={13} /> {busy ? 'Rendering…' : 'Share image'}
      </button>
      {msg && <p className="mt-2 text-xs text-warn">{msg}</p>}
    </>
  )

  if (variant === 'corner') {
    return (
      <div className={`relative ${className ?? ''}`}>
        {/* data-no-capture on both, or the picture of the panel has the
            control that made it sitting in the corner. */}
        <button
          data-no-capture
          onClick={() => setOpen((o) => !o)}
          // 32px square: the smallest thing a thumb can reliably find, and the
          // most a fixture card's corner can give up.
          className={`absolute top-2 right-2 z-[4] inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
            open ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid bg-surface-1/80 text-ink-3 hover:border-line-strong hover:text-ink'
          }`}
          aria-expanded={open}
          aria-label={`Share ${title}`}
          title={`Share ${title}`}
        >
          <Icon name="users" size={13} />
        </button>
        {open && (
          <div data-no-capture className="absolute top-11 right-2 z-[5] w-[248px] rounded-xl border border-line bg-surface-1 p-3 shadow-xl">
            {chooser}
          </div>
        )}
        <div ref={ref}>{children}</div>
      </div>
    )
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      {/* No wrapping: the point of the toolbar is to save a row, and a row
          that wraps costs the one it was meant to save. On a phone the word
          "Share" drops and the icon carries it. */}
      <div data-no-capture className="mb-1.5 flex items-center gap-1.5">
        {toolbar}
        <button
          onClick={() => setOpen((o) => !o)}
          className="ml-auto inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line-mid px-2.5 text-[12px] font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
          aria-expanded={open}
          aria-label={`Share ${title}`}
        >
          <Icon name="users" size={13} /> <span className="hidden min-[360px]:inline">Share</span>
        </button>
      </div>

      {open && <div data-no-capture className="mb-3 rounded-xl border border-line bg-surface-1 p-3">{chooser}</div>}

      <div ref={ref}>{children}</div>
    </div>
  )
}
