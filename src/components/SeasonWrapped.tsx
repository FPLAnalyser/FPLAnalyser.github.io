import { useMemo, useState, useEffect } from 'react'
import { Icon } from './Icon'

// Season Wrapped: a personal end-of-season story built from FPL entry history
// — full-screen slides (points & rank, best gameweek, bench pain, chips).
// The gate button only renders once all 38 gameweeks are played, so it stays
// hidden pre-season and mid-season.

interface HistoryEvent {
  event: number
  points: number
  total_points: number
  overall_rank: number | null
  points_on_bench: number
}

interface Slide {
  kicker: string
  color: string
  headline: React.ReactNode
  sub: string
}

const TOTAL_PLAYERS_APPROX = 11_000_000

export function SeasonWrapped({ history, teamName }: { history: unknown; teamName?: string }) {
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(0)

  const events = ((history as { current?: HistoryEvent[] } | null)?.current ?? []) as HistoryEvent[]
  const chips = ((history as { chips?: { name: string; event: number }[] } | null)?.chips ?? [])
  const complete = events.length >= 38

  const slides = useMemo<Slide[]>(() => {
    if (!complete) return []
    const last = events[events.length - 1]
    const best = [...events].sort((a, b) => b.points - a.points)[0]
    const benchTotal = events.reduce((s, e) => s + (e.points_on_bench || 0), 0)
    const benchWorst = [...events].sort((a, b) => b.points_on_bench - a.points_on_bench)[0]
    const rank = last.overall_rank
    const pctile = rank ? Math.max(1, Math.round((rank / TOTAL_PLAYERS_APPROX) * 100)) : null
    const out: Slide[] = [
      {
        kicker: 'Your season',
        color: 'gold',
        headline: (
          <>
            {last.total_points.toLocaleString('en-GB')} points.
            {rank != null && (
              <>
                <br />
                <em>Rank {rank.toLocaleString('en-GB')}.</em>
              </>
            )}
          </>
        ),
        sub: pctile != null ? `That puts ${teamName ?? 'your team'} in roughly the top ${pctile}% of the world.` : `${teamName ?? 'Your team'}, over 38 gameweeks.`,
      },
      {
        kicker: 'Your best week',
        color: 'good',
        headline: (
          <>
            <em>{best.points} points</em> in GW{best.event}
          </>
        ),
        sub: 'Your highest single-gameweek score of the season.',
      },
      {
        kicker: 'The one that hurt',
        color: 'bad',
        headline: (
          <>
            <em>{benchTotal} points</em> left on your bench
          </>
        ),
        sub: `GW${benchWorst.event} was the worst of it — ${benchWorst.points_on_bench} points watching from the sidelines.`,
      },
    ]
    if (chips.length) {
      out.push({
        kicker: 'Chips played',
        color: 'gold',
        headline: <em>{chips.length} chips</em>,
        sub: chips.map((c) => `${c.name} (GW${c.event})`).join(' · '),
      })
    }
    return out
  }, [complete, events, chips, teamName])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
      if (e.key === 'ArrowRight') setIdx((i) => Math.min(i + 1, slides.length - 1))
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, slides.length])

  if (!complete || !slides.length) return null

  const COLOR: Record<string, { glow: string; text: string }> = {
    gold: { glow: 'rgba(201,162,39,.32)', text: 'var(--accent-2)' },
    good: { glow: 'rgba(61,220,122,.22)', text: '#7fe7a8' },
    bad: { glow: 'rgba(240,115,111,.2)', text: '#f0a09c' },
  }
  const s = slides[idx]
  const c = COLOR[s.color] ?? COLOR.gold

  return (
    <>
      <button
        onClick={() => { setIdx(0); setOpen(true) }}
        className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-5 font-semibold text-accent-contrast transition-colors hover:bg-accent-strong"
      >
        <Icon name="trophy" size={16} /> Your Season, Wrapped
      </button>

      {open && (
        <div className="story-overlay" role="dialog" aria-label="Season Wrapped">
          <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(90% 70% at 50% 0%, ${c.glow}, transparent 60%)` }} />

          <div className="relative z-10 flex items-center justify-between px-5 py-4 md:px-8">
            <span className="text-sm font-extrabold tracking-wide"><span className="metallic-num">FPL</span> <span className="text-ink">ANALYSER</span></span>
            <button onClick={() => setOpen(false)} aria-label="Close" className="px-2 text-2xl leading-none text-ink-3 hover:text-ink">×</button>
          </div>

          <div key={idx} className="relative z-10 mt-auto p-6 pb-10 md:p-10 md:pb-14">
            <div className="story-rise mb-2 text-[11px] font-extrabold tracking-[0.26em] uppercase" style={{ color: c.text, animationDelay: '.05s' }}>{s.kicker}</div>
            <h2
              className="story-rise font-cond wrapped-h max-w-[16ch] text-5xl leading-[0.95] font-extrabold text-white uppercase md:text-7xl"
              style={{ animationDelay: '.15s', ['--wrapped-em' as string]: c.text }}
            >
              {s.headline}
            </h2>
            <p className="story-rise mt-4 max-w-[46ch] text-base text-white/75" style={{ animationDelay: '.3s' }}>{s.sub}</p>
          </div>

          {/* nav: dots + tap zones */}
          <div className="relative z-10 flex items-center justify-center gap-2 pb-6">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                aria-label={`Slide ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-6 bg-accent' : 'w-1.5 bg-white/25'}`}
              />
            ))}
          </div>
          <button className="absolute inset-y-0 left-0 z-20 w-1/3" aria-label="Previous" onClick={() => setIdx((i) => Math.max(i - 1, 0))} />
          <button className="absolute inset-y-0 right-0 z-20 w-1/3" aria-label="Next" onClick={() => setIdx((i) => (i + 1 < slides.length ? i + 1 : (setOpen(false), i)))} />
        </div>
      )}
    </>
  )
}
