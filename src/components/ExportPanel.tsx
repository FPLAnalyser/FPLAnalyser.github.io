import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { shareImageNative } from '../lib/native'
import { rasterise } from '../lib/capture'

/* ════════════════════════════════════════════════════════════════════════
   Share anything: wrap a table or chart in <Exportable> and it gains a
   quiet "Share" button that rasterises the panel to a branded PNG — sized
   for Twitter/X or Instagram — with the site name and the author's handle
   burned in, so a screenshot that travels always carries its source.
   ════════════════════════════════════════════════════════════════════════ */

/** Fixed branding. Every export carries the site name and the account for
 * the chosen platform — a visitor sharing our analysis cannot rewrite the
 * credit, by design. */
const SITE_NAME = 'FPL Analyser'

type Format = 'auto' | 'wide' | 'square' | 'story'
const FORMATS: { id: Format; label: string; hint: string; w: number; h: number | null; handle: string }[] = [
  // Auto shapes the image to the content — the right default, because a tall
  // table forced into 16:9 renders as an unreadable stamp in a sea of black.
  { id: 'auto', label: 'Fit content', hint: 'auto', w: 1600, h: null, handle: '@FPLAnalyser' },
  { id: 'wide', label: 'Twitter / X', hint: '16:9', w: 1600, h: 900, handle: '@FPLAnalyser' },
  { id: 'square', label: 'Instagram', hint: '1:1', w: 1080, h: 1080, handle: '@fpl_analyser' },
  { id: 'story', label: 'Story', hint: '9:16', w: 1080, h: 1920, handle: '@fpl_analyser' },
]

/** Draw the captured panel onto a branded canvas of the chosen aspect. */
function brand(source: HTMLCanvasElement, fmt: (typeof FORMATS)[number], title: string, handle: string, dark: boolean): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = fmt.w
  // Auto: chrome + the panel at full width, so nothing is ever shrunk.
  const autoPad = Math.round(fmt.w * 0.045)
  const autoChrome = autoPad + 34 + Math.round(fmt.w * 0.028) + Math.round(fmt.w * 0.07) + autoPad
  out.height = fmt.h ?? Math.round((source.height / source.width) * (fmt.w - autoPad * 2)) + autoChrome
  const ctx = out.getContext('2d')!
  const bg = dark ? '#0c0b09' : '#faf8f3'
  const ink = dark ? '#f4efe3' : '#1b1712'
  const dim = dark ? '#8d8577' : '#6f6759'

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
  ctx.font = `800 ${Math.round(out.width * 0.022)}px ui-sans-serif, system-ui, sans-serif`
  ctx.textAlign = 'right'
  ctx.fillText(SITE_NAME, out.width - pad, headY)
  ctx.textAlign = 'left'

  // Panel, centred and scaled to fit between header and footer.
  const top = headY + Math.round(out.width * 0.028)
  const footH = Math.round(out.width * 0.07)
  const availW = out.width - pad * 2
  const availH = out.height - top - footH - pad
  // Fill the frame's width so the content stays legible. If that makes it
  // taller than the frame (a long table in a 16:9 crop), show the top of the
  // panel at full size rather than shrinking the whole thing to a stamp.
  const scale = availW / source.width
  const dw = availW
  const dh = source.height * scale
  if (dh <= availH) {
    ctx.drawImage(source, pad + (availW - dw) / 2, top + (availH - dh) / 2, dw, dh)
  } else {
    const srcH = Math.round(availH / scale) // source pixels that fit the frame
    ctx.drawImage(source, 0, 0, source.width, srcH, pad, top, dw, availH)
    // Fade the cut edge so it reads as "continues", not "broken".
    const grad = ctx.createLinearGradient(0, top + availH - 90, 0, top + availH)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(1, bg)
    ctx.fillStyle = grad
    ctx.fillRect(pad, top + availH - 90, dw, 90)
  }

  // Footer: handle + hairline.
  ctx.strokeStyle = dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.12)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(pad, out.height - footH)
  ctx.lineTo(out.width - pad, out.height - footH)
  ctx.stroke()
  ctx.fillStyle = dim
  ctx.font = `600 ${Math.round(out.width * 0.018)}px ui-sans-serif, system-ui, sans-serif`
  if (handle) ctx.fillText(handle.startsWith('@') ? handle : `@${handle}`, pad, out.height - footH / 2 + 8)
  ctx.textAlign = 'right'
  ctx.fillText('Data · Insight · Points', out.width - pad, out.height - footH / 2 + 8)
  ctx.textAlign = 'left'
  return out
}

export function Exportable({ title, filename, children, className, toolbar }: {
  title: string
  filename?: string
  children: ReactNode
  className?: string
  /** Controls to sit on the same line as the Share button. Without this the
   *  button gets a row of its own, which on a crowded panel is a whole line
   *  of height spent on one small control. */
  toolbar?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [fmt, setFmt] = useState<Format>('auto')

  useEffect(() => {
    if (!open) setMsg('')
  }, [open])

  const run = async (mode: 'share' | 'download') => {
    if (!ref.current) return
    setBusy(true)
    setMsg('')
    try {
      const dark = !document.documentElement.classList.contains('light')
      const shot = await rasterise(ref.current, dark)
      const spec = FORMATS.find((f) => f.id === fmt)!
      const canvas = brand(shot, spec, title, spec.handle, dark)
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
        setMsg('Sharing isn’t available in this browser — the image has downloaded instead.')
      }
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      setMsg('Could not render the image on this device — try a screenshot instead.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      {/* No wrapping: the point of the toolbar is to save a row, and a row
          that wraps costs the one it was meant to save. On a phone the word
          "Share" drops and the icon carries it. */}
      <div className="mb-1.5 flex items-center gap-1.5">
        {toolbar}
        <button
          onClick={() => setOpen((o) => !o)}
          className="ml-auto inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line-mid px-2.5 text-[12px] font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
          aria-expanded={open}
          aria-label="Share"
        >
          <Icon name="users" size={13} /> <span className="hidden min-[360px]:inline">Share</span>
        </button>
      </div>

      {open && (
        <div className="mb-3 rounded-xl border border-line bg-surface-1 p-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFmt(f.id)}
                className={`min-h-8 rounded-full border px-3 text-[12px] font-semibold transition-colors ${
                  fmt === f.id ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong'
                }`}
              >
                {f.label} <span className="opacity-60">{f.hint}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => run('share')}
              disabled={busy}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-accent bg-accent-soft px-3.5 text-[13px] font-semibold text-accent disabled:opacity-60"
            >
              <Icon name="users" size={13} /> {busy ? 'Rendering…' : 'Share image'}
            </button>
            <button
              onClick={() => run('download')}
              disabled={busy}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line-mid px-3.5 text-[13px] font-semibold text-ink-2 disabled:opacity-60"
            >
              <Icon name="check" size={13} /> Download PNG
            </button>
          </div>
          {msg && <p className="mt-2 text-xs text-warn">{msg}</p>}
        </div>
      )}

      <div ref={ref}>{children}</div>
    </div>
  )
}
