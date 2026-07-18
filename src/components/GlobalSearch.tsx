import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Icon } from './Icon'
import { TeamBadge, PositionIcon } from './badges'
import { useCore } from '../lib/useData'
import { norm, teamFullNames } from '../lib/util'
import type { RatingRow } from '../lib/types'

type PlayerItem = { kind: 'player'; label: string; name: string; team: string; pos: string }
type TeamItem = { kind: 'team'; label: string; code: string }
type Item = PlayerItem | TeamItem

/** Build a combined player + team index once per data load. */
function useSearchIndex(): { players: PlayerItem[]; teams: TeamItem[] } {
  const { data } = useCore()
  return useMemo(() => {
    const ratings = (data?.ratings ?? []) as RatingRow[]
    const players: PlayerItem[] = []
    const teams: TeamItem[] = []
    const seen = new Set<string>()
    for (const p of ratings) {
      if (!p.web_name) continue
      players.push({ kind: 'player', label: String(p.web_name), name: String(p.web_name), team: String(p.team ?? ''), pos: String(p.position ?? '') })
      const t = String(p.team ?? '')
      if (t && !seen.has(t)) {
        seen.add(t)
        teams.push({ kind: 'team', label: teamFullNames[t] || t, code: t })
      }
    }
    teams.sort((a, b) => a.label.localeCompare(b.label))
    return { players, teams }
  }, [data])
}

function itemHref(it: Item): string {
  return it.kind === 'player'
    ? `/player?name=${encodeURIComponent(it.name)}`
    : `/teams?team=${encodeURIComponent(it.code)}`
}

/**
 * Combined players + teams search with a results dropdown. `variant="bar"` is the
 * inline top-bar field (desktop); `variant="overlay"` fills the screen for the
 * mobile search sheet. Selecting a result navigates to the deep-linked page.
 */
export function GlobalSearch({
  variant = 'bar',
  autoFocus = false,
  onClose,
}: {
  variant?: 'bar' | 'overlay'
  autoFocus?: boolean
  onClose?: () => void
}) {
  const navigate = useNavigate()
  const { players, teams } = useSearchIndex()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    if (variant !== 'bar') return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [variant])

  const matches = useMemo(() => {
    const nq = norm(q.trim())
    if (!nq) return [] as Item[]
    const t = teams.filter((it) => norm(it.label).includes(nq) || norm(it.code).includes(nq)).slice(0, 3)
    const p = players.filter((it) => norm(it.label).includes(nq)).slice(0, 8 - t.length)
    return [...t, ...p]
  }, [q, players, teams])

  const pick = (it: Item) => {
    setQ('')
    setOpen(false)
    onClose?.()
    navigate(itemHref(it))
    window.scrollTo(0, 0)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); onClose?.(); return }
    if (!matches.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(matches[active]) }
  }

  const overlay = variant === 'overlay'
  const showResults = (open || overlay) && matches.length > 0

  const results = (
    <div className={overlay
      ? 'mt-2 overflow-y-auto'
      : 'absolute z-40 mt-1.5 w-full overflow-hidden rounded-xl border border-line-mid bg-surface-2 shadow-float'}>
      {matches.map((it, i) => (
        <button
          key={`${it.kind}-${it.label}-${i}`}
          type="button"
          onClick={() => pick(it)}
          onMouseEnter={() => setActive(i)}
          className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
            overlay ? 'rounded-lg' : ''
          } ${i === active ? 'bg-surface-3 text-ink' : 'text-ink-2'}`}
        >
          {it.kind === 'team' ? <TeamBadge team={it.code} size={18} /> : <PositionIcon pos={it.pos} size={15} />}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{it.label}</span>
          {it.kind === 'player' ? (
            <span className="flex items-center gap-1.5 text-xs text-ink-3">
              <TeamBadge team={it.team} size={13} />
              {it.team}
            </span>
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">Team</span>
          )}
        </button>
      ))}
    </div>
  )

  const field = (
    <div ref={wrapRef} className={overlay ? 'relative' : 'relative w-full'}>
      <div className={`flex items-center gap-2 rounded-xl border border-line-mid bg-surface-1 px-3 ${overlay ? 'shadow-float' : ''}`}>
        <span className="text-ink-3"><Icon name="search" size={16} /></span>
        <input
          ref={inputRef}
          type="text"
          value={q}
          placeholder="Search players & teams…"
          autoComplete="off"
          className="min-h-11 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {overlay && (
          <button type="button" aria-label="Close search" className="p-1 text-ink-3 hover:text-ink" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        )}
        {!overlay && q && (
          <button type="button" aria-label="Clear" className="p-1 text-ink-3 hover:text-ink" onClick={() => { setQ(''); inputRef.current?.focus() }}>
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
      {showResults && results}
      {overlay && q.trim() && !matches.length && (
        <p className="mt-6 text-center text-sm text-ink-3">No players or teams match “{q.trim()}”.</p>
      )}
    </div>
  )

  if (!overlay) return field
  return field
}

/** Mobile full-screen search sheet, triggered from the top bar / bottom nav. */
export function SearchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduced = useReducedMotion()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[200] bg-surface-1/95 backdrop-blur-xl"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduced ? undefined : { opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="mx-auto max-w-lg px-4 pt-4"
            initial={reduced ? false : { y: -12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduced ? undefined : { y: -12, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <GlobalSearch variant="overlay" autoFocus onClose={onClose} />
            <p className="mt-3 px-1 text-xs text-ink-3">Jump to any player or team.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
