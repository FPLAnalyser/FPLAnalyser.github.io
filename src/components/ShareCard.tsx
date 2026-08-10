import { useRef, useState } from 'react'
import { RatingCard } from './RatingCard'
import { ShareFooter } from './ShareFooter'
import { deliverImage } from '../lib/share'
import { rasterise } from '../lib/capture'
import { playerHref } from '../lib/util'
import { num } from '../lib/rows'
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
  /** The finished PNG, shown only when nothing automatic could deliver it. */
  const [shot, setShot] = useState<string | null>(null)
  const url = `${location.origin}${location.pathname}#${playerHref(String(r.web_name), num(r, 'code'))}`

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
    setShot(null)
    try {
      // Through `rasterise` like every other export, rather than reaching for
      // the rasteriser directly. Calling html2canvas here meant this card was
      // the one picture on the site that never got capture mode — no images
      // settled, no chrome hidden, and, once the engine changed, still drawn
      // by the old one. A second copy of a pipeline is a second copy that gets
      // left behind.
      const canvas = await rasterise(cardRef.current, true, 1080)
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/png'))
      if (!blob) throw new Error('render failed')
      const shareName = `${String(r.web_name).replace(/\s+/g, '-')}-fpl-analyser.png`
      // Closing the share sheet used to land in the catch below and offer the
      // reader a link instead, as though the picture had failed.
      const how = await deliverImage(blob, shareName, `${r.web_name} — FPL Analyser`)
      if (how === 'needs-longpress') {
        setShot(URL.createObjectURL(blob))
        setMsg('Press and hold the image to save or share it.')
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
            <div ref={cardRef} className="bg-[#0a0b0e]">
              <RatingCard r={r} fixtureEase={fixtureEase} />
              <ShareFooter />
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {/* One picture button. `save` already hands the PNG to the OS
                  share sheet where there is one and downloads it where there
                  isn't, so "Save" and "Share" were the same action twice. */}
              <button onClick={save} disabled={busy} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-strong disabled:opacity-60">
                {busy ? 'Rendering…' : '↗ Share image'}
              </button>
              <button onClick={shareLink} className={btn}>↗ Share link</button>
              <button onClick={copy} className={btn}>⧉ Copy link</button>
              <button onClick={() => setOpen(false)} className={btn}>Close</button>
            </div>
            {shot && <img src={shot} alt="Ready to save" className="mt-3 w-full rounded-xl border border-line-mid" />}
            {msg && <div className="mt-2 text-center text-xs break-all text-ink-2">{msg}</div>}
          </div>
        </div>
      )}
    </>
  )
}
