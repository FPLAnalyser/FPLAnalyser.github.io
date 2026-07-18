import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * ⓘ tooltip: opens on hover (desktop) and tap (touch), clamped to the viewport.
 * Replaces the legacy CSS `.tooltip-wrap` + app.js positionTooltip/tap-toggle.
 * Content renders in a portal so it never clips inside overflow containers.
 */
export function InfoTip({ text, children, size = 14 }: { text: ReactNode; children?: ReactNode; size?: number }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !boxRef.current) return
    const a = anchorRef.current.getBoundingClientRect()
    const b = boxRef.current.getBoundingClientRect()
    const margin = 8
    let left = a.left + a.width / 2 - b.width / 2
    left = Math.max(margin, Math.min(left, window.innerWidth - b.width - margin))
    let top = a.top - b.height - 8
    if (top < margin) top = a.bottom + 8 // flip below if no room above
    setPos({ top, left })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    const onDocClick = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('click', onDocClick)
    }
  }, [open])

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label="More info"
        className="inline-grid size-4 place-items-center rounded-full border border-line-mid text-[9px] font-bold text-ink-2 transition-colors hover:border-accent hover:text-accent"
        style={{ width: size, height: size }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        {children ?? 'i'}
      </button>
      {open &&
        createPortal(
          <div
            ref={boxRef}
            role="tooltip"
            className="pointer-events-none fixed z-[300] max-w-[240px] rounded-md border border-line-mid bg-surface-3 px-3 py-2 text-xs leading-snug text-ink shadow-float"
            style={{ top: pos.top, left: pos.left }}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  )
}
