import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { deliverImage } from '../lib/share'
import { rasterise } from '../lib/capture'
import { SHARE_FORMATS, frameHeight, drawFitted, type ShareFormat, type FormatId } from '../lib/frames'
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

/** Draw the captured panel onto a branded canvas of the chosen aspect. */
function brand(source: HTMLCanvasElement, fmt: ShareFormat, title: string, dark: boolean): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = fmt.w
  const pad0 = Math.round(fmt.w * 0.045)
  // Title band plus footer band — what Full has to add to the content's own
  // height, and what a fixed format takes away from it.
  const chrome = pad0 + 34 + Math.round(fmt.w * 0.028) + Math.round(fmt.w * 0.095) + pad0
  out.height = frameHeight(fmt, source, chrome, pad0)
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
  drawFitted(ctx, source, { x: pad, y: top, w: availW, h: availH })

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
  const [fmt, setFmt] = useState<FormatId>('post')
  /** The finished PNG, shown only when nothing automatic could deliver it. */
  const [shot, setShot] = useState<string | null>(null)

  useEffect(() => {
    if (!open) setMsg('')
  }, [open])

  const run = async (mode: 'share' | 'download') => {
    if (!ref.current) return
    setBusy(true)
    setMsg('')
    setShot(null)
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
      const spec = SHARE_FORMATS.find((f) => f.id === fmt)!
      // Laid out at the format's own width, and captured at a scale that
      // reaches the frame natively — so the export is the same picture on a
      // phone and a laptop, and is never a bitmap stretched to fit.
      const shot = await rasterise(ref.current, dark, spec.w)
      const canvas = brand(shot, spec, title, dark)
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/png'))
      if (!blob) throw new Error('render failed')
      const name = `${filename ?? title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${fmt}.png`

      void mode
      const how = await deliverImage(blob, name, `${title} — ${SITE_NAME}`)
      // Closing the share sheet is a decision, not a fault, and it used to be
      // reported as "could not render the image" beside an image that had
      // rendered perfectly. Nothing is said now.
      if (how === 'saved') setMsg('This browser has no share sheet — the image has been saved to your downloads instead.')
      // Nothing automatic worked, so show the picture and let them hold it.
      // Silence here is the failure mode that reads as a dead button.
      else if (how === 'needs-longpress') { setShot(URL.createObjectURL(blob)); setMsg('Press and hold the image to save or share it.') }
      else setOpen(false)
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
        {SHARE_FORMATS.map((f) => (
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
      {shot && <img src={shot} alt="Ready to save" className="mt-2 w-full rounded-lg border border-line-mid" />}
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
