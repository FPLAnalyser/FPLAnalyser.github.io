import { useMemo, useState, useEffect } from 'react'
import { BrandMark } from './BrandMark'
import { PlayerPhoto } from './PlayerPhoto'
import { num } from '../lib/rows'
import type { CoreData, RatingRow } from '../lib/types'

// The Gameweek cover: the weekly briefing as a magazine front page, generated
// from the model — headline captain story plus differential and value cover
// lines. Shows once per gameweek (localStorage), tap anywhere to dismiss.

const SEEN_KEY = 'fpl_cover_seen_gw'

function surname(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1]
}

export function GameweekCover({ data }: { data: CoreData }) {
  const nextGw = data.meta?.next_gw ?? null

  const [open, setOpen] = useState(() => {
    if (nextGw == null) return false
    try { return localStorage.getItem(SEEN_KEY) !== String(nextGw) } catch { return false }
  })

  const picks = useMemo(() => {
    const rated = (data.ratings as RatingRow[]).filter(
      (p) => num(p, 'season_ok') !== 0 && p.season_ok !== false && num(p, 'season_overall_score') != null,
    )
    if (!rated.length) return null
    const nextFix = (team: string) => (data.fixtureEase || []).filter((f) => f.team === team).sort((a, b) => a.gw - b.gw)[0]
    const rating = (p: RatingRow) => (num(p, 'season_overall_score') ?? 0) * 20
    const fixFactor = (p: RatingRow) => { const f = nextFix(String(p.team)); return f ? (6 - f.fdr) / 5 : 0.6 }
    const att = rated.filter((p) => p.position === 'MID' || p.position === 'FWD')
    const captain = [...att].sort((a, b) => rating(b) * fixFactor(b) - rating(a) * fixFactor(a))[0]
    const diff = [...rated].filter((p) => (num(p, 'selected_by_percent') ?? 100) < 10).sort((a, b) => rating(b) - rating(a))[0]
    const value = [...rated].filter((p) => (num(p, 'price') ?? 0) > 0).sort((a, b) => rating(b) / (num(b, 'price') ?? 1) - rating(a) / (num(a, 'price') ?? 1))[0]
    const fixLabel = (p: RatingRow) => { const f = nextFix(String(p.team)); return f ? `${f.venue === 'H' ? 'vs' : '@'} ${f.opponent}` : '' }
    return { captain, diff, value, rating, fixLabel }
  }, [data])

  const dismiss = () => {
    try { localStorage.setItem(SEEN_KEY, String(nextGw)) } catch { /* ignore */ }
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') dismiss() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open || nextGw == null || !picks?.captain) return null
  const { captain, diff, value, rating, fixLabel } = picks

  const CoverLine = ({ label, p, note }: { label: string; p?: RatingRow; note?: string }) => {
    if (!p) return null
    return (
      <div className="max-w-[240px]">
        <div className="mb-1 text-[10px] font-extrabold tracking-[0.18em] text-accent-2 uppercase">{label}</div>
        <div className="text-sm font-semibold text-[#e9e4d8]">
          {String(p.web_name)} {fixLabel(p)}
          {note && <span className="mt-0.5 block text-xs font-normal text-[#b9b2a4]">{note}</span>}
        </div>
      </div>
    )
  }

  return (
    <div
      className="story-overlay cursor-pointer"
      onClick={dismiss}
      role="dialog"
      aria-label={`Gameweek ${nextGw} cover — tap to continue`}
    >
      {/* ambient ground: gold aura on black + captain photo lower-right */}
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(90% 60% at 70% 20%, rgba(201,162,39,.14), transparent 60%)' }} />
      <div className="pointer-events-none absolute right-0 bottom-0 max-h-[70vh] overflow-hidden opacity-90">
        <PlayerPhoto
          code={num(captain, 'code')}
          element={num(captain, 'element')}
          hero
          className="max-h-[70vh] w-auto object-contain object-bottom drop-shadow-[0_10px_50px_rgba(0,0,0,0.8)]"
          placeholder={null}
        />
      </div>
      <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,.92) 8%, rgba(0,0,0,.4) 45%, transparent 75%)' }} />

      {/* masthead */}
      <div className="relative z-10 flex items-center justify-between border-b border-white/10 px-5 py-4 md:px-8">
        <span className="flex items-center gap-2.5">
          <BrandMark className="h-9 w-9 md:h-11 md:w-11" />
          <span className="font-brand text-sm font-normal tracking-[0.14em] md:text-base"><span className="metallic-num">FPL</span> <span className="text-ink">ANALYSER</span></span>
        </span>
        <span className="text-[10px] font-bold tracking-[0.22em] text-accent-2 uppercase">The Gameweek · GW{nextGw}</span>
      </div>

      {/* headline + cover lines */}
      <div className="relative z-10 mt-auto p-5 pb-8 md:p-8 md:pb-12">
        <div className="story-rise mb-2 text-[11px] font-extrabold tracking-[0.26em] text-accent-2 uppercase" style={{ animationDelay: '.1s' }}>
          This week's big call
        </div>
        <h2 className="story-rise font-cond max-w-[14ch] text-5xl leading-[0.92] font-extrabold text-white uppercase md:text-7xl" style={{ animationDelay: '.2s' }}>
          The <span className="metallic-num">{surname(String(captain.web_name))}</span> question.
        </h2>
        <div className="story-rise mt-6 flex flex-wrap gap-x-8 gap-y-4" style={{ animationDelay: '.35s' }}>
          <CoverLine label="Captain" p={captain} note={`${Math.round(rating(captain))} rated — the model's pick`} />
          <CoverLine label="Differential" p={diff} note={diff ? `${Math.round(num(diff, 'selected_by_percent') ?? 0)}% owned` : undefined} />
          <CoverLine label="Value" p={value} note={value ? `£${num(value, 'price')}m — best rating per million` : undefined} />
        </div>
        <div className="story-rise mt-7 text-xs font-semibold tracking-[0.14em] text-ink-3 uppercase" style={{ animationDelay: '.5s' }}>
          Tap anywhere to enter
        </div>
      </div>
    </div>
  )
}
