import { useEffect, useRef, useState } from 'react'
import { useSeason } from '../lib/season'

/** Season selector. Shows the active season; when more than one exists it opens
 *  a menu to switch, which reloads onto that data.
 *
 *  Lives in the page footer rather than the nav. It was in the header cluster
 *  taking 77px from a row that has none to spare below 1440 — measured, the nav
 *  links already overflow at 1280 — and it is a control for reading last
 *  season's archive, not something anyone reaches for on the way to a squad.
 *  The menu opens UPWARD for the same reason: there is nothing below it. */
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
        className="flex min-h-8 items-center gap-1 rounded-md border border-line-mid px-2 text-[12px] font-semibold whitespace-nowrap text-ink-2 transition-colors hover:text-ink"
        aria-label={`Season: ${label}`}
        title={multi ? 'Change season' : `Season ${label}`}
      >
        <span className="tabular-nums">{label}</span>
        {multi && <span className="text-[10px] text-ink-3">▾</span>}
      </button>
      {open && multi && (
        <div className="absolute bottom-full left-0 z-[120] mb-1.5 w-36 overflow-hidden rounded-lg border border-line-mid bg-surface-2 shadow-float">
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
