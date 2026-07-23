import { useRef, useState } from 'react'
import { RatingCard } from './RatingCard'
import type { FixtureEaseRow, RatingRow } from '../lib/types'

/**
 * Share a player's rating card. Opens a modal with the card and actions:
 * save/share as a PNG (rasterised client-side) or copy a deep link. Image
 * export degrades gracefully — if the cross-origin photo can't be rendered the
 * card still exports without it, and any hard failure falls back to the link.
 */
export function ShareCard({ r, fixtureEase }: { r: RatingRow; fixtureEase?: FixtureEaseRow[] }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const cardRef = useRef<HTMLDivElement>(null)
  const url = `${location.origin}${location.pathname}#/player?name=${encodeURIComponent(String(r.web_name))}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setMsg('Link copied to clipboard.')
    } catch {
      setMsg(url)
    }
  }

  const save = async () => {
    if (!cardRef.current) return
    setBusy(true)
    setMsg('')
    try {
      const { default: html2canvas } = await import('html2canvas-pro')
      const canvas = await html2canvas(cardRef.current, { backgroundColor: '#0c0b09', scale: 2, useCORS: true, logging: false })
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/png'))
      if (!blob) throw new Error('render failed')
      const file = new File([blob], `${String(r.web_name).replace(/\s+/g, '-')}-fpl-analyser.png`, { type: 'image/png' })
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean }
      if (nav.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: `${r.web_name} — FPL Analyser` })
      } else {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = file.name
        a.click()
        URL.revokeObjectURL(a.href)
      }
    } catch {
      setMsg('Could not render the image here — copied the link instead.')
      copy()
    } finally {
      setBusy(false)
    }
  }

  const shareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: `${r.web_name} — FPL Analyser`, text: `${r.web_name} · ${r.position} — see the full rating on FPL Analyser`, url })
      } catch {
        /* cancelled */
      }
    } else {
      copy()
    }
  }

  const btn = 'inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line-mid px-4 text-sm font-semibold text-ink transition-colors hover:border-line-strong'

  return (
    <>
      <button onClick={() => { setOpen(true); setMsg('') }} className={btn}>↗ Share card</button>
      {open && (
        <div className="fixed inset-0 z-[200] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setOpen(false)} role="dialog" aria-modal="true">
          <div className="w-full max-w-[360px]" onClick={(e) => e.stopPropagation()}>
            <div ref={cardRef}>
              <RatingCard r={r} fixtureEase={fixtureEase} />
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button onClick={save} disabled={busy} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-strong disabled:opacity-60">
                {busy ? 'Rendering…' : '⭳ Save image'}
              </button>
              <button onClick={shareLink} className={btn}>↗ Share</button>
              <button onClick={copy} className={btn}>⧉ Copy link</button>
              <button onClick={() => setOpen(false)} className={btn}>Close</button>
            </div>
            {msg && <div className="mt-2 text-center text-xs break-all text-ink-2">{msg}</div>}
          </div>
        </div>
      )}
    </>
  )
}
