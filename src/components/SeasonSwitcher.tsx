import { useEffect, useRef, useState } from 'react'
import { useSeason } from '../lib/season'

/** Compact season selector for the nav. Shows the active season; when more than
 *  one season exists it opens a menu to switch (which reloads onto that data). */
export function SeasonSwitcher() {
  const { season, seasons, setSeason } = useSeason()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

  const cur = seasons.find((s) => s.id === season)
  const label = cur?.label ?? season.replace('-', '/')
  const multi = seasons.length > 1

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => multi && setOpen((o) => !o)}
        className="flex min-h-9 items-center gap-1 rounded-md border border-line-mid px-2.5 text-xs font-semibold whitespace-nowrap text-ink-2 transition-colors hover:text-ink"
        aria-label={`Season: ${label}`}
        title={multi ? 'Change season' : `Season ${label}`}
      >
        <span className="tabular-nums">{label}</span>
        {multi && <span className="text-[9px] text-ink-3">▾</span>}
      </button>
      {open && multi && (
        <div className="absolute right-0 z-[120] mt-1.5 w-36 overflow-hidden rounded-lg border border-line-mid bg-surface-2 shadow-float">
          <div className="border-b border-line px-3 py-1.5 text-[10px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Season</div>
          {seasons.map((s) => (
            <button
              key={s.id}
              onClick={() => { setSeason(s.id); setOpen(false) }}
              className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors ${s.id === season ? 'text-accent' : 'text-ink-2 hover:bg-surface-3 hover:text-ink'}`}
            >
              {s.label}
              {s.id === season && <span className="text-accent">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
