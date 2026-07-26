import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { PageShell } from '../components/PageShell'
import { SectionBanner } from '../components/SectionBanner'
import { PageSkeleton } from '../components/Skeleton'
import { Tabs, type TabDef } from '../components/Tabs'
import { TeamBadge } from '../components/badges'
import { FixtureChips, FixtureNames } from '../components/FixtureChips'
import { ShareFooter } from '../components/ShareFooter'
import { SeasonPlanner } from '../components/SeasonPlanner'
import { Icon } from '../components/Icon'
import { Pitch, PitchCard, CARD_W } from '../components/Pitch'
import { PlayerCardSheet } from '../components/PlayerCardSheet'
import { SquadRatingSheet, squadNarrative } from '../components/SquadRatingSheet'
import { useCore } from '../lib/useData'
import { tapHaptic, shareImageNative } from '../lib/native'
import { rasterise } from '../lib/capture'
import { num } from '../lib/rows'
import { useAvailability, availBadge, availFor, type Availability } from '../lib/availability'
import { xpForGw, useXpModel, useMarketOdds } from '../lib/xp'
import { usePlanner } from '../lib/usePlanner'
import { teamLabel, playerHref } from '../lib/util'
import type { FixtureEaseRow, RatingRow } from '../lib/types'

type Pos = 'GKP' | 'DEF' | 'MID' | 'FWD'
const SLOTS: { pos: Pos; count: number }[] = [
  { pos: 'GKP', count: 2 },
  { pos: 'DEF', count: 5 },
  { pos: 'MID', count: 5 },
  { pos: 'FWD', count: 3 },
]
const NEED: Record<Pos, number> = { GKP: 2, DEF: 5, MID: 5, FWD: 3 }
const POS_LABEL: Record<Pos, string> = { GKP: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards' }
const BUDGET = 100.0
const MAX_PER_CLUB = 3
const STORE_KEY = 'fpl_squad_build'

const ovOf = (r: RatingRow): number | null => {
  const s = num(r, 'season_overall_score')
  return s == null ? null : Math.round(Math.max(0, Math.min(100, s * 20)))
}
const priceOf = (r: RatingRow): number => num(r, 'price') ?? 0

const PICK_TABS: TabDef[] = [
  { id: 'GKP', label: 'GKP' },
  { id: 'DEF', label: 'DEF' },
  { id: 'MID', label: 'MID' },
  { id: 'FWD', label: 'FWD' },
]
/** What the corner of every card shows: the rating, the price, or projected
 *  points for the gameweek being viewed. */
export type Metric = 'rating' | 'price' | 'xp'
const METRICS: { id: Metric; label: string }[] = [
  { id: 'rating', label: 'Rating' },
  { id: 'price', label: '£' },
  { id: 'xp', label: 'xP' },
]

function MetricChips({ metric, onChange }: { metric: Metric; onChange: (m: Metric) => void }) {
  return (
    <div className="flex gap-1.5">
      {METRICS.map((m) => (
        <button
          key={m.id}
          onClick={() => onChange(m.id)}
          className={`min-h-8 rounded-full border px-3 text-[12px] font-semibold transition-colors ${
            metric === m.id ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

type SortKey = 'rating' | 'price' | 'value' | 'owned'
const SORT_TABS: TabDef[] = [
  { id: 'rating', label: 'Rating' },
  { id: 'value', label: 'Value' },
  { id: 'price', label: 'Price' },
  { id: 'owned', label: 'Owned' },
]

// Position-relevant rating dimensions to filter by (the pipeline stores these
// on a 0–5 scale; the sliders work in 0–100 like every rating on the site).
const DIMS: Record<Pos, { key: string; label: string }[]> = {
  GKP: [{ key: 'season_save_score_norm', label: 'Shot Stop' }, { key: 'season_cs_score_norm', label: 'Clean Sheet' }],
  DEF: [{ key: 'season_cs_score_norm', label: 'Clean Sheet' }, { key: 'season_dc_score_norm', label: 'Def Con' }, { key: 'season_goal_score_norm', label: 'Threat' }],
  MID: [{ key: 'season_goal_score_norm', label: 'Goal' }, { key: 'season_creative_score_norm', label: 'Creativity' }, { key: 'season_dc_score_norm', label: 'Def Con' }],
  FWD: [{ key: 'season_goal_score_norm', label: 'Goal' }, { key: 'season_creative_score_norm', label: 'Creativity' }],
}
const dim100 = (r: RatingRow, key: string): number | null => {
  const v = num(r, key)
  return v == null ? null : Math.round(Math.max(0, Math.min(100, v * 20)))
}
const PRICE_MIN = 4.0
const PRICE_MAX = 15.5 // a hair above the most expensive player so nobody is filtered out by default

export default function SquadBuilder() {
  const { data, error } = useCore()
  const navigate = useNavigate()
  const [picked, setPicked] = useState<number[]>(() => {
    try { const s = localStorage.getItem(STORE_KEY); return s ? JSON.parse(s) : [] } catch { return [] }
  })
  const [pickPos, setPickPos] = useState<Pos>('GKP')
  const [metric, setMetric] = useState<Metric>('rating')
  const [sheetFor, setSheetFor] = useState<RatingRow | null>(null)
  const [sort, setSort] = useState<SortKey>('rating')
  const [query, setQuery] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [maxPrice, setMaxPrice] = useState(PRICE_MAX)
  const [minRating, setMinRating] = useState(0)
  const [minDim, setMinDim] = useState<Record<string, number>>({})
  const [showFilters, setShowFilters] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [ratingOpen, setRatingOpen] = useState(false)
  // Transfers run through the list beside the board: either arm the player
  // leaving (tap him on the pitch) or pick the player coming in and choose
  // who he replaces.
  const [armedOut, setArmedOut] = useState<number | null>(null)
  const [pendingIn, setPendingIn] = useState<RatingRow | null>(null)

  const avail = useAvailability()
  const fixtureEase = (data?.fixtureEase ?? []) as FixtureEaseRow[]
  // You build for one gameweek — the next one to be played — and then plan
  // forward from it. Everything on this page is anchored to that number.
  const buildGw = fixtureEase.length ? Math.min(...fixtureEase.map((f) => f.gw)) : (data?.meta?.next_gw ?? 1)

  const pool = useMemo(
    () => ((data?.ratings ?? []) as RatingRow[]).filter(
      (r) => r.element != null && r.price != null && ['GKP', 'DEF', 'MID', 'FWD'].includes(String(r.position)),
    ),
    [data],
  )
  const byEl = useMemo(() => {
    const m = new Map<number, RatingRow>()
    for (const r of pool) m.set(r.element, r)
    return m
  }, [pool])

  const persist = (next: number[]) => {
    setPicked(next)
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  const chosen = useMemo(() => picked.map((el) => byEl.get(el)).filter(Boolean) as RatingRow[], [picked, byEl])
  const spent = useMemo(() => chosen.reduce((s, r) => s + priceOf(r), 0), [chosen])
  const remaining = +(BUDGET - spent).toFixed(1)
  const countByPos = useMemo(() => {
    const c: Record<Pos, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 }
    for (const r of chosen) c[r.position as Pos]++
    return c
  }, [chosen])
  const clubCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of chosen) m.set(String(r.team), (m.get(String(r.team)) ?? 0) + 1)
    return m
  }, [chosen])
  const total = chosen.length

  // Why a given player can't be added right now (null = addable).
  const blockReason = (r: RatingRow): string | null => {
    if (picked.includes(r.element)) return 'Already in your squad'
    const pos = r.position as Pos
    if (countByPos[pos] >= NEED[pos]) return `${POS_LABEL[pos]} are full (${NEED[pos]})`
    if ((clubCount.get(String(r.team)) ?? 0) >= MAX_PER_CLUB) return `Max ${MAX_PER_CLUB} from ${teamLabel(String(r.team))}`
    if (priceOf(r) > remaining + 1e-9) return `£${priceOf(r).toFixed(1)}m over budget`
    return null
  }

  const add = (r: RatingRow) => {
    const why = blockReason(r)
    if (why) { setNote(why); return }
    setNote(null)
    tapHaptic('light')
    persist([...picked, r.element])
  }
  const remove = (el: number) => { setNote(null); tapHaptic('light'); persist(picked.filter((x) => x !== el)) }
  const clear = () => { setNote(null); persist([]) }

  // Squad rating: average of rated players (unrated shown separately).
  // NOTE: `live` below re-points this at the planner's squad for the week on
  // screen, so selling a player drops him out of the narrative immediately.
  const rated = chosen.map(ovOf).filter((v): v is number => v != null)
  const squadScore = rated.length ? Math.round(rated.reduce((a, b) => a + b, 0) / rated.length) : null
  const unrated = chosen.length - rated.length
  const bestXI = useMemo(() => bestElevenScore(chosen), [chosen])

  const complete = total === 15 && SLOTS.every((s) => countByPos[s.pos] === s.count)
  const valid = complete && spent <= BUDGET + 1e-9

  const planner = usePlanner({ base: picked, byEl, startGw: buildGw, fixtureEase })
  // The board's week drives what the list is for: before the fifteen exists
  // it's an add list, after it's the transfer market for the week on screen.
  const plannerSquad = complete && planner.week ? planner.squad : picked
  const armedRow = armedOut != null ? byEl.get(armedOut) ?? null : null
  // Everything that describes "your squad" reads from the week on screen.
  const liveChosen = useMemo(
    () => plannerSquad.map((el) => byEl.get(el)).filter(Boolean) as RatingRow[],
    [plannerSquad, byEl],
  )
  const liveRated = liveChosen.map(ovOf).filter((v): v is number => v != null)
  const liveScore = liveRated.length ? Math.round(liveRated.reduce((a, b) => a + b, 0) / liveRated.length) : null
  const liveBestXI = useMemo(() => bestElevenScore(liveChosen), [liveChosen])
  const liveGw = complete ? planner.gw : buildGw

  // Auto-pick a strong, valid squad within budget (greedy by rating with a
  // minimum-price reservation for the slots still to fill).
  const autoPick = () => {
    setNote(null)
    tapHaptic('medium')
    persist(autoBuild(pool))
  }

  // The filtered, sorted picker list.
  const dims = DIMS[pickPos]
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = pool.filter((r) => {
      // A search matches any player in the game, regardless of the active
      // position tab; with no search we browse just the selected position.
      if (q) {
        if (!String(r.web_name).toLowerCase().includes(q)) return false
      } else if (r.position !== pickPos) {
        return false
      }
      if (priceOf(r) > maxPrice + 1e-9) return false
      if (minRating > 0 && (ovOf(r) ?? 0) < minRating) return false
      if (!q) {
        for (const d of dims) {
          const th = minDim[d.key] ?? 0
          if (th > 0 && (dim100(r, d.key) ?? 0) < th) return false
        }
      }
      return true
    })
    const key = (r: RatingRow) => {
      if (sort === 'price') return priceOf(r)
      if (sort === 'owned') return num(r, 'selected_by_percent') ?? 0
      if (sort === 'value') { const o = ovOf(r); return o == null ? -1 : o / Math.max(priceOf(r), 0.1) }
      return ovOf(r) ?? -1
    }
    return [...rows].sort((a, b) => key(b) - key(a)).slice(0, 60)
  }, [pool, pickPos, query, sort, maxPrice, minRating, minDim, dims])

  const activeFilters = (maxPrice < PRICE_MAX ? 1 : 0) + (minRating > 0 ? 1 : 0) + dims.filter((d) => (minDim[d.key] ?? 0) > 0).length
  const resetFilters = () => { setMaxPrice(PRICE_MAX); setMinRating(0); setMinDim({}) }

  if (!data) {
    return (
      <PageShell>
        <SectionBanner imgKey="squad" title="Squad Builder" subtitle="Build a 15-man squad within £100m and rate it" />
        <PageSkeleton error={error} />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <SectionBanner imgKey="squad" title="Squad Builder" subtitle={`Pick your Gameweek ${buildGw} fifteen within £100m, then step forward week by week — transfers, captain and chips`} />

      <>
      {/* Share and clear sit beside the board; auto pick lives on the board
          itself, and a "valid squad" badge only repeated what 15/15 says. */}
      {total > 0 && (
        <div className="mx-auto mb-3 flex max-w-[660px] flex-wrap items-center gap-2">
          <button onClick={() => setShareOpen(true)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line-mid px-3.5 text-sm font-medium text-ink transition-colors hover:border-line-strong">
            <Icon name="trend-up" size={14} /> Share / download
          </button>
          <button onClick={clear} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line-mid px-3.5 text-sm font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink">
            <Icon name="x" size={14} /> Clear
          </button>
          {complete && !valid && <span className="text-sm font-medium text-bad">Over budget by £{Math.abs(remaining).toFixed(1)}m</span>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        {/* The board — the same object from an empty squad to a full one:
            unfilled places are just empty slots you tap to fill. */}
        <div className="min-w-0">
          <div className="mx-auto mb-2 flex max-w-[660px] flex-wrap items-center gap-2">
            <div className="text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Your squad — week by week</div>
            <div className="ml-auto"><MetricChips metric={metric} onChange={setMetric} /></div>
          </div>
          <SeasonPlanner
            planner={planner} byEl={byEl} pool={pool} fixtureEase={fixtureEase}
            metric={metric} avail={avail}
            armedOut={armedOut}
            squadScore={liveScore}
            onOpenSquadRating={() => setRatingOpen(true)}
            partialSquad={picked}
            onPickSlot={(p) => { setPickPos(p as Pos); setQuery(''); setNote(null) }}
            onAutoPick={complete ? planner.autoXI : autoPick}
            read={<SquadRead chosen={liveChosen} fixtureEase={fixtureEase} gw={liveGw} avail={avail} onOpen={() => setRatingOpen(true)} />}
            onArmTransfer={(el) => { setArmedOut(el); setPendingIn(null); setPickPos(String(byEl.get(el)?.position ?? 'MID') as Pos); setQuery('') }}
          />
        </div>

        {/* Player list — always here, whether you're building or transferring */}
        <div className="mt-8 min-w-0 lg:mt-0 lg:sticky lg:top-20">
          <div className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">
            {complete ? `Transfer market — GW${planner.gw}` : 'Add players'}
          </div>

          {complete && armedRow && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm">
              <Icon name="users" size={14} className="text-bad" />
              <span className="min-w-0 flex-1 truncate text-ink">Replacing <span className="font-semibold">{String(armedRow.web_name)}</span></span>
              <button onClick={() => setArmedOut(null)} className="text-xs font-semibold text-ink-3 hover:text-ink">cancel</button>
            </div>
          )}

          <div className="mb-3"><Tabs tabs={PICK_TABS} active={pickPos} onChange={(id) => setPickPos(id as Pos)} layoutId="squad-pos" /></div>
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-line-mid bg-surface-1 px-3">
            <Icon name="search" size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search players…"
              className="min-h-11 w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-3 md:text-sm"
            />
            {query && <button aria-label="Clear" onClick={() => setQuery('')} className="text-ink-3 hover:text-ink"><Icon name="x" size={15} /></button>}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase">Sort</span>
            <Tabs tabs={SORT_TABS} active={sort} onChange={(id) => setSort(id as SortKey)} layoutId="squad-sort" />
            <button
              onClick={() => setShowFilters((f) => !f)}
              className={`ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
                activeFilters > 0 ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
              }`}
            >
              <Icon name="target" size={13} /> Filters{activeFilters > 0 ? ` (${activeFilters})` : ''} <span className="text-[10px]">{showFilters ? '▴' : '▾'}</span>
            </button>
          </div>

          {showFilters && (
            <div className="mb-3 flex flex-col gap-3 rounded-xl border border-line bg-surface-1/50 p-3.5">
              <RangeRow label="Max price" kind="max" value={maxPrice} min={PRICE_MIN} max={PRICE_MAX} step={0.5} display={`£${maxPrice.toFixed(1)}m`} onChange={setMaxPrice} />
              <RangeRow label="Min rating" kind="min" value={minRating} min={0} max={100} step={5} display={String(minRating)} onChange={setMinRating} />
              {dims.map((d) => (
                <RangeRow key={d.key} label={`Min ${d.label}`} kind="min" value={minDim[d.key] ?? 0} min={0} max={100} step={5} display={String(minDim[d.key] ?? 0)} onChange={(v) => setMinDim((m) => ({ ...m, [d.key]: v }))} />
              ))}
              {activeFilters > 0 && (
                <button onClick={resetFilters} className="self-start text-xs font-semibold text-accent hover:underline">Reset filters</button>
              )}
            </div>
          )}

          {note && <div className="mb-2 rounded-lg bg-bad/10 px-3 py-2 text-sm font-medium text-bad">{note}</div>}
          <div className="overflow-hidden rounded-xl border border-line lg:max-h-[calc(100vh-260px)] lg:overflow-y-auto">
            {list.map((r) => {
              const inSquad = plannerSquad.includes(r.element)
              const why = complete
                ? (armedOut != null ? planner.canReplace(armedOut, r.element) : inSquad ? 'Already in your squad' : null)
                : blockReason(r)
              const o = ovOf(r)
              return (
                <div key={r.element} className={`flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-0 ${inSquad ? 'bg-surface-2/40' : ''}`}>
                  <TeamBadge team={String(r.team)} size={16} />
                  <div className="min-w-0 flex-1">
                    <button className="block w-full text-left" onClick={() => navigate(playerHref(String(r.web_name), num(r, 'code')))}>
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-ink hover:text-accent">{String(r.web_name)}</span>
                        {inSquad && <span className="shrink-0 rounded bg-surface-3 px-1 py-0.5 text-[8.5px] leading-none font-bold text-ink-3">IN SQUAD</span>}
                        {(() => {
                          const f = availBadge(availFor(avail, num(r, 'element'), num(r, 'code')))
                          return f ? <span title={f.title} className={`shrink-0 rounded px-1 py-0.5 text-[8.5px] leading-none font-extrabold ${f.tone === 'bad' ? 'bg-bad text-white' : 'bg-warn text-black'}`}>{f.label}</span> : null
                        })()}
                      </div>
                      <div className="text-[11px] text-ink-3">{teamLabel(String(r.team))} · £{priceOf(r).toFixed(1)}m · {Math.round(num(r, 'selected_by_percent') ?? 0)}% owned</div>
                    </button>
                    <div className="mt-1"><FixtureChips fixtureEase={fixtureEase} team={String(r.team)} n={4} /></div>
                  </div>
                  <span className="w-9 shrink-0 text-right font-num text-sm font-semibold tabular-nums text-ink-2">{o ?? '—'}</span>
                  <button
                    onClick={() => {
                      if (!complete) { add(r); return }
                      if (armedOut != null) { planner.doTransfer(armedOut, r.element); setArmedOut(null); tapHaptic('medium'); return }
                      setPendingIn(r)
                    }}
                    disabled={!!why}
                    title={why ?? (complete ? 'Transfer in' : 'Add to squad')}
                    className={`grid size-8 shrink-0 place-items-center rounded-lg border transition-colors ${
                      why ? 'cursor-not-allowed border-line text-ink-3 opacity-50' : 'border-accent/50 text-accent hover:bg-accent-soft'
                    }`}
                  >
                    <Icon name={complete ? 'arrow-right' : 'check'} size={15} />
                  </button>
                </div>
              )
            })}
            {list.length === 0 && <div className="px-3 py-8 text-center text-sm text-ink-3">No players match these filters.</div>}
          </div>
        </div>
      </div>

      </>

      {sheetFor && (
        <PlayerCardSheet
          player={sheetFor}
          pool={pool}
          fixtureEase={fixtureEase}
          onClose={() => setSheetFor(null)}
          onSwap={(out, incoming) => { remove(out.element); add(incoming) }}
        />
      )}

      {pendingIn && complete && (
        <ReplaceChooser
          incoming={pendingIn}
          squad={plannerSquad.map((el) => byEl.get(el)).filter(Boolean) as RatingRow[]}
          canReplace={(outEl) => planner.canReplace(outEl, pendingIn.element)}
          onPick={(outEl) => { planner.doTransfer(outEl, pendingIn.element); setPendingIn(null); setArmedOut(null); tapHaptic('medium') }}
          onClose={() => setPendingIn(null)}
        />
      )}

      {ratingOpen && (
        <SquadRatingSheet
          chosen={liveChosen} pool={pool} squadScore={liveScore} bestXI={liveBestXI}
          fixtureEase={fixtureEase} gw={liveGw} avail={avail} onClose={() => setRatingOpen(false)}
        />
      )}

      <SquadShare chosen={chosen} fixtureEase={fixtureEase} squadScore={squadScore} bestXI={bestXI} spent={spent} unrated={unrated} total={total} gw={buildGw} open={shareOpen} onClose={() => setShareOpen(false)} />
    </PageShell>
  )
}

/** The squad's character, on the page rather than behind a button: the three
 *  most telling lines, with the rest a click away. */
function SquadRead({ chosen, fixtureEase, gw, avail, onOpen }: {
  chosen: RatingRow[]; fixtureEase: FixtureEaseRow[]; gw: number; avail: Availability; onOpen: () => void
}) {
  const lines = useMemo(() => squadNarrative(chosen, fixtureEase, gw, avail), [chosen, fixtureEase, gw, avail])
  if (!lines.length) return null
  // Warnings first — a risk you haven't seen is worth more than a strength
  // you already know about.
  const order = { warn: 0, good: 1, flat: 2 } as Record<string, number>
  const top = [...lines].sort((a, b) => order[a.tone] - order[b.tone]).slice(0, 3)
  const dot = { good: 'bg-good', warn: 'bg-warn', flat: 'bg-ink-3' } as Record<string, string>
  return (
    <div className="mt-3 rounded-2xl border border-line bg-surface-1/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">The read on your squad</span>
        <button onClick={onOpen} className="ml-auto text-xs font-semibold text-accent hover:underline">Full breakdown →</button>
      </div>
      <div className="flex flex-col gap-2">
        {top.map((l, i) => (
          <button key={i} onClick={onOpen} className="flex gap-2 text-left transition-colors hover:opacity-80">
            <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${dot[l.tone]}`} />
            <span className="min-w-0 text-sm">
              <span className="font-semibold text-ink">{l.head}</span>
              <span className="text-ink-2"> — {l.body}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** "Who makes way?" — the other half of a transfer when you start from the
 *  player coming in. Only same-position squad members can answer, so those
 *  are the only ones offered, each with the reason it can't be them if so. */
function ReplaceChooser({ incoming, squad, canReplace, onPick, onClose }: {
  incoming: RatingRow
  squad: RatingRow[]
  canReplace: (outEl: number) => string | null
  onPick: (outEl: number) => void
  onClose: () => void
}) {
  const options = squad.filter((r) => r.position === incoming.position)
  return createPortal(
    <div className="fixed inset-0 z-[220] flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center" onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface-1 p-2" onClick={(e) => e.stopPropagation()}>
        <div className="px-3 py-2">
          <div className="text-sm font-bold text-ink">Bring in {String(incoming.web_name)}</div>
          <div className="text-xs text-ink-3">Who makes way? Only your {String(incoming.position)}s can.</div>
        </div>
        <div className="max-h-[55vh] overflow-y-auto border-t border-line">
          {options.map((r) => {
            const why = canReplace(r.element)
            return (
              <button
                key={r.element}
                disabled={!!why}
                onClick={() => onPick(r.element)}
                title={why ?? undefined}
                className="flex w-full items-center gap-2.5 border-b border-line px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-surface-2/60 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
              >
                <TeamBadge team={String(r.team)} size={16} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{String(r.web_name)}</div>
                  <div className="truncate text-[11px] text-ink-3">{teamLabel(String(r.team))} · £{priceOf(r).toFixed(1)}m{why ? ` · ${why}` : ''}</div>
                </div>
                <span className="font-num w-9 shrink-0 text-right text-sm font-semibold tabular-nums text-ink-2">{ovOf(r) ?? '—'}</span>
              </button>
            )
          })}
          {options.length === 0 && <div className="px-3 py-6 text-center text-sm text-ink-3">No {String(incoming.position)}s in your squad.</div>}
        </div>
        <button className="mt-1 w-full rounded-xl px-4 py-3 text-center text-sm font-semibold text-ink-3" onClick={onClose}>Cancel</button>
      </div>
    </div>,
    document.body,
  )
}

/** Split a squad into a starting XI and a four-man bench.
 *
 *  The formation is the legal shape (DEF 3–5, MID 2–5, FWD 1–3) that maximises
 *  the total rating of the eleven; while the squad is still short it falls back
 *  to 4-4-2 so the pitch has a stable shape to fill in. Within each position the
 *  best-rated go on the pitch and the rest sit on the bench, keeper first —
 *  which is exactly how FPL orders a bench. */
function pickEleven(squad: RatingRow[]): { form: Record<Pos, number>; xi: RatingRow[]; bench: RatingRow[] } {
  const sorted = (p: Pos) => squad.filter((r) => r.position === p).sort((a, b) => (ovOf(b) ?? -1) - (ovOf(a) ?? -1))
  const by: Record<Pos, RatingRow[]> = { GKP: sorted('GKP'), DEF: sorted('DEF'), MID: sorted('MID'), FWD: sorted('FWD') }
  const sumTop = (arr: RatingRow[], n: number) => arr.slice(0, n).reduce((a, r) => a + (ovOf(r) ?? 0), 0)

  let form: Record<Pos, number> = { GKP: 1, DEF: 4, MID: 4, FWD: 2 }
  if (by.GKP.length && by.DEF.length >= 3 && by.MID.length >= 2 && by.FWD.length >= 1) {
    let bestSum = -1
    for (let d = 3; d <= 5; d++) {
      for (let m = 2; m <= 5; m++) {
        const f = 10 - d - m
        if (f < 1 || f > 3) continue
        if (by.DEF.length < d || by.MID.length < m || by.FWD.length < f) continue
        const sum = (ovOf(by.GKP[0]) ?? 0) + sumTop(by.DEF, d) + sumTop(by.MID, m) + sumTop(by.FWD, f)
        if (sum > bestSum) { bestSum = sum; form = { GKP: 1, DEF: d, MID: m, FWD: f } }
      }
    }
  }

  const xi: RatingRow[] = []
  const subs: RatingRow[] = []
  for (const { pos } of SLOTS) {
    by[pos].forEach((r, i) => (i < form[pos] ? xi : subs).push(r))
  }
  const bench = [...subs.filter((r) => r.position === 'GKP'), ...subs.filter((r) => r.position !== 'GKP')]
  return { form, xi, bench }
}

/** The squad laid out on a pitch: the starting XI in formation, the bench in a
 *  band across the foot of the pitch. Interactive by default (remove ✕ + empty
 *  slots that jump the picker to that position); `capture` mode drops those for
 *  a clean shareable image. */
function SquadBoard({ chosen, fixtureEase, pickPos, onRemove, onPick, onOpen, capture, metric = 'rating', gw, avail }: {
  chosen: RatingRow[]; fixtureEase: FixtureEaseRow[]; pickPos?: Pos; onRemove?: (el: number) => void; onPick?: (p: Pos) => void; onOpen?: (r: RatingRow) => void; capture?: boolean
  metric?: Metric; gw?: number; avail?: Availability
}) {
  const { form, xi, bench } = pickEleven(chosen)
  const xpModel = useXpModel()
  const market = useMarketOdds()

  // The corner figure under the active metric. The tier (card metal) always
  // comes from the rating, so switching to £ or xP recolours nothing.
  const cornerFor = (r: RatingRow): string | null => {
    if (metric === 'price') return num(r, 'price') != null ? `£${num(r, 'price')}` : null
    if (metric === 'xp' && gw != null) {
      const v = xpForGw(r, gw, fixtureEase, avail, xpModel, market)
      return v == null ? '—' : v.toFixed(1)
    }
    return null
  }

  const card = (r: RatingRow) => (
    <div key={r.element} className={`relative ${CARD_W}`}>
      <PitchCard
        rating={num(r, 'season_overall_score') != null ? Math.round((num(r, 'season_overall_score') as number) * 20) : null}
        cornerText={cornerFor(r)}
        name={String(r.web_name)}
        team={String(r.team)}
        price={num(r, 'price')}
        code={num(r, 'code')}
        element={num(r, 'element')}
        flag={avail ? availBadge(availFor(avail, num(r, 'element'), num(r, 'code'))) : null}
        fixtures={<FixtureNames fixtureEase={fixtureEase} team={String(r.team)} n={3} />}
        onClick={capture ? undefined : () => onOpen?.(r)}
      />
      {onRemove && !capture && (
        <button aria-label={`Remove ${r.web_name}`} onClick={() => onRemove(r.element)} className="absolute -top-1.5 -right-1.5 z-10 grid size-5 place-items-center rounded-full border border-line bg-surface-1 text-ink-2 shadow-lg transition-colors hover:border-bad hover:text-bad sm:-top-2 sm:-right-2 sm:size-7">
          <Icon name="x" size={11} />
        </button>
      )}
    </div>
  )

  const slot = (pos: Pos, key: string) => (
    <button
      key={key}
      onClick={() => onPick?.(pos)}
      className={`${CARD_W} grid min-h-[76px] place-items-center rounded-lg border-2 border-dashed text-[9.5px] font-medium transition-colors sm:min-h-[92px] sm:text-[10px] ${
        pickPos === pos ? 'border-accent/70 text-accent' : 'border-white/20 text-white/75 hover:border-white/45 hover:text-white'
      }`}
    >
      <span className="flex flex-col items-center gap-1"><Icon name="search" size={14} /> Add {pos}</span>
    </button>
  )

  // Bench capacity per position is whatever the formation leaves over.
  const benchNeed: Pos[] = []
  for (const { pos, count } of SLOTS) {
    const short = count - form[pos] - bench.filter((r) => r.position === pos).length
    for (let i = 0; i < short; i++) benchNeed.push(pos)
  }

  return (
    <Pitch
      maxWidth={capture ? undefined : 760}
      footer={
        capture && !bench.length ? undefined : (
          <div className="flex justify-center gap-1 sm:gap-2">
            {bench.map(card)}
            {!capture && benchNeed.map((pos, i) => slot(pos, `b${pos}${i}`))}
          </div>
        )
      }
    >
      <div className="relative flex flex-col gap-2 sm:gap-3 md:gap-4">
        {SLOTS.map(({ pos }) => {
          const players = xi.filter((r) => r.position === pos)
          if (capture && !players.length) return null
          const empties = capture ? 0 : Math.max(0, form[pos] - players.length)
          return (
            <div key={pos} className="flex justify-center gap-1 sm:gap-2">
              {players.map(card)}
              {Array.from({ length: empties }).map((_, i) => slot(pos, `${pos}${i}`))}
            </div>
          )
        })}
      </div>
    </Pitch>
  )
}

/** Share / download the squad as a branded PNG (rasterised client-side). */
function SquadShare({ chosen, fixtureEase, squadScore, bestXI, spent, unrated, total, gw, open, onClose }: {
  chosen: RatingRow[]; fixtureEase: FixtureEaseRow[]; squadScore: number | null; bestXI: number | null; spent: number; unrated: number; total: number; gw: number; open: boolean; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  if (!open) return null

  const save = async () => {
    if (!ref.current) return
    setBusy(true); setMsg('')
    try {
      const canvas = await rasterise(ref.current, true)
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/png'))
      if (!blob) throw new Error('render failed')
      // Native: hand the PNG to the OS share sheet via Capacitor.
      if (await shareImageNative(blob, 'fpl-analyser-squad.png', 'My FPL squad — FPL Analyser')) return
      const file = new File([blob], 'fpl-analyser-squad.png', { type: 'image/png' })
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean }
      if (nav.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: 'My FPL squad — FPL Analyser' })
      } else {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); URL.revokeObjectURL(a.href)
      }
    } catch {
      setMsg('Could not render the image on this device — try a screenshot instead.')
    } finally {
      setBusy(false)
    }
  }
  const btn = 'inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line-mid px-4 text-sm font-semibold text-ink transition-colors hover:border-line-strong'

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full max-w-[560px]" onClick={(e) => e.stopPropagation()}>
        {/* The share card is always drawn on the same near-black, whatever
            theme the app is in — so it sets its own ink rather than reading
            theme tokens, which the rasteriser resolves unreliably. */}
        <div ref={ref} className="rounded-3xl bg-[#0c0b09] p-4" style={{ color: '#f4efe3' }}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="font-display text-lg leading-none whitespace-nowrap">FPL <span style={{ color: '#c9a227' }}>Analyser</span><div className="mt-1 text-[10px] font-semibold tracking-[0.14em] uppercase" style={{ color: '#8a8172' }}>My GW{gw} Squad</div></div>
            <div className="flex gap-4 text-center">
              <div><div className="font-display text-2xl leading-none tabular-nums" style={{ color: '#c9a227' }}>{squadScore ?? '—'}</div><div className="text-[9px] tracking-[0.1em] whitespace-nowrap uppercase" style={{ color: '#8a8172' }}>Squad</div></div>
              <div><div className="font-display text-2xl leading-none tabular-nums" style={{ color: '#c9a227' }}>{bestXI ?? '—'}</div><div className="text-[9px] tracking-[0.1em] whitespace-nowrap uppercase" style={{ color: '#8a8172' }}>Best XI</div></div>
              <div><div className="font-display text-2xl leading-none tabular-nums">£{spent.toFixed(1)}</div><div className="text-[9px] tracking-[0.1em] whitespace-nowrap uppercase" style={{ color: '#8a8172' }}>Spend</div></div>
            </div>
          </div>
          <SquadBoard chosen={chosen} fixtureEase={fixtureEase} capture />
          {unrated > 0 && <div className="mt-2 text-center text-[10px]" style={{ color: '#8a8172' }}>{unrated} player{unrated > 1 ? 's' : ''} new to the league (unrated)</div>}
          <ShareFooter />
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button onClick={save} disabled={busy || total === 0} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-strong disabled:opacity-60">{busy ? 'Rendering…' : '⭳ Save image'}</button>
          <button onClick={onClose} className={btn}>Close</button>
        </div>
        {msg && <div className="mt-2 text-center text-xs text-ink-2">{msg}</div>}
      </div>
    </div>
  )
}

function RangeRow({ label, kind, value, min, max, step, display, onChange }: {
  label: string; kind: 'min' | 'max'; value: number; min: number; max: number; step: number; display: string; onChange: (v: number) => void
}) {
  const off = kind === 'min' ? value <= min : value >= max
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-ink-2">{label}</span>
        <span className={`font-num tabular-nums ${off ? 'text-ink-3' : 'font-semibold text-accent'}`}>{off ? 'Any' : display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-accent"
      />
    </div>
  )
}

/** Best legal starting XI rating, as a 0–100 average. Reads the same eleven the
 *  pitch shows, so the headline number and the shirts never disagree. */
function bestElevenScore(squad: RatingRow[]): number | null {
  const { xi } = pickEleven(squad)
  if (xi.length < 11) return null
  return Math.round(xi.reduce((a, r) => a + (ovOf(r) ?? 0), 0) / 11)
}

/** Auto-build the best-value squad: start from the cheapest legal 15, then
 *  repeatedly apply the single same-position upgrade with the best rating gain
 *  per extra pound that still fits the budget. This maximises total squad
 *  quality for £100m — a strong, balanced, fully-playable side rather than a
 *  couple of premiums padded out with bench fodder. */
function autoBuild(pool: RatingRow[]): number[] {
  const ovN = (r: RatingRow) => ovOf(r) ?? 0
  const need: Record<Pos, number> = { ...NEED }
  const byPos: Record<Pos, RatingRow[]> = { GKP: [], DEF: [], MID: [], FWD: [] }
  for (const r of pool) byPos[r.position as Pos].push(r)

  // 1. Cheapest legal squad (respecting the 3-per-club cap).
  const picked: RatingRow[] = []
  const pset = new Set<number>()
  const club = new Map<string, number>()
  let spent = 0
  for (const r of [...pool].sort((a, b) => priceOf(a) - priceOf(b))) {
    const p = r.position as Pos
    if (need[p] <= 0) continue
    if ((club.get(String(r.team)) ?? 0) >= MAX_PER_CLUB) continue
    picked.push(r); pset.add(r.element); spent += priceOf(r); need[p]--
    club.set(String(r.team), (club.get(String(r.team)) ?? 0) + 1)
    if (picked.length === 15) break
  }
  if (picked.length < 15) return picked.map((r) => r.element)

  const clubCount = (team: string, exclEl: number) =>
    picked.reduce((n, r) => n + (String(r.team) === team && r.element !== exclEl ? 1 : 0), 0)

  // 2. Hill-climb upgrades until no affordable improvement remains.
  for (let guard = 0; guard < 500; guard++) {
    const rem = BUDGET - spent
    let best: { i: number; y: RatingRow; cost: number } | null = null
    let bestScore = 0
    for (let i = 0; i < picked.length; i++) {
      const x = picked[i]
      const p = x.position as Pos
      for (const y of byPos[p]) {
        if (pset.has(y.element)) continue
        const dov = ovN(y) - ovN(x)
        if (dov <= 0) continue
        const dcost = priceOf(y) - priceOf(x)
        if (dcost > rem + 1e-9) continue
        if (String(y.team) !== String(x.team) && clubCount(String(y.team), x.element) >= MAX_PER_CLUB) continue
        const score = dcost > 1e-9 ? dov / dcost : dov * 1000 // free/cheaper upgrades first
        if (score > bestScore) { bestScore = score; best = { i, y, cost: dcost } }
      }
    }
    if (!best) break
    const x = picked[best.i]
    pset.delete(x.element); pset.add(best.y.element)
    picked[best.i] = best.y; spent += best.cost
  }
  return picked.map((r) => r.element)
}
