import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { shareImageNative } from '../lib/native'

/* ════════════════════════════════════════════════════════════════════════
   Share anything: wrap a table or chart in <Exportable> and it gains a
   quiet "Share" button that rasterises the panel to a branded PNG — sized
   for Twitter/X or Instagram — with the site name and the author's handle
   burned in, so a screenshot that travels always carries its source.
   ════════════════════════════════════════════════════════════════════════ */

/** The by-line. Site name is a placeholder until the brand is finalised;
 * the handle is whatever the user sets once, stored locally. */
const SITE_NAME = 'FPL Analyser'
const HANDLE_KEY = 'fpl_share_handle'

export function getHandle(): string {
  try {
    return localStorage.getItem(HANDLE_KEY) ?? ''
  } catch {
    return ''
  }
}
export function setHandle(v: string) {
  try {
    localStorage.setItem(HANDLE_KEY, v)
  } catch {
    /* private mode — the byline just falls back to the site name */
  }
}

type Format = 'wide' | 'square' | 'story'
const FORMATS: { id: Format; label: string; hint: string; w: number; h: number | null }[] = [
  { id: 'wide', label: 'Twitter / X', hint: '16:9', w: 1600, h: 900 },
  { id: 'square', label: 'Instagram', hint: '1:1', w: 1080, h: 1080 },
  { id: 'story', label: 'Story', hint: '9:16', w: 1080, h: 1920 },
]

/** Draw the captured panel onto a branded canvas of the chosen aspect. */
function brand(source: HTMLCanvasElement, fmt: (typeof FORMATS)[number], title: string, handle: string, dark: boolean): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = fmt.w
  out.height = fmt.h ?? Math.round((source.height / source.width) * fmt.w) + 220
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
  const scale = Math.min(availW / source.width, availH / source.height)
  const dw = source.width * scale
  const dh = source.height * scale
  ctx.drawImage(source, pad + (availW - dw) / 2, top + (availH - dh) / 2, dw, dh)

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

export function Exportable({ title, filename, children, className }: {
  title: string
  filename?: string
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [handle, setHandleState] = useState(getHandle())
  const [fmt, setFmt] = useState<Format>('wide')

  useEffect(() => {
    if (!open) setMsg('')
  }, [open])

  const run = async (mode: 'share' | 'download') => {
    if (!ref.current) return
    setBusy(true)
    setMsg('')
    try {
      const dark = !document.documentElement.classList.contains('light')
      const { default: html2canvas } = await import('html2canvas-pro')
      const shot = await html2canvas(ref.current, {
        backgroundColor: dark ? '#0c0b09' : '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
      })
      const spec = FORMATS.find((f) => f.id === fmt)!
      const canvas = brand(shot, spec, title, handle, dark)
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
      <div className="mb-1.5 flex justify-end">
        <button
          onClick={() => setOpen((o) => !o)}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-line-mid px-2.5 text-[12px] font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
          aria-expanded={open}
        >
          <Icon name="users" size={13} /> Share
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
          <label className="mb-2 block">
            <span className="mb-1 block text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Your handle (appears on every export)</span>
            <input
              value={handle}
              onChange={(e) => { setHandleState(e.target.value); setHandle(e.target.value) }}
              placeholder="@yourname"
              className="min-h-9 w-full max-w-xs rounded-lg border border-line-mid bg-surface-2 px-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
            />
          </label>
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
