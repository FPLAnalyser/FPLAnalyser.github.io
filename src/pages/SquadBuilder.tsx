import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, PageShell } from '../components/PageShell'
import { PageSkeleton } from '../components/Skeleton'
import { Tabs, type TabDef } from '../components/Tabs'
import { TeamBadge, PositionIcon } from '../components/badges'
import { FixtureChips } from '../components/FixtureChips'
import { Icon } from '../components/Icon'
import { StarRating } from '../components/StarRating'
import { useCore } from '../lib/useData'
import { num } from '../lib/rows'
import { teamLabel } from '../lib/util'
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
const PRICE_MAX = 15.0

export default function SquadBuilder() {
  const { data, error } = useCore()
  const navigate = useNavigate()
  const [picked, setPicked] = useState<number[]>(() => {
    try { const s = localStorage.getItem(STORE_KEY); return s ? JSON.parse(s) : [] } catch { return [] }
  })
  const [pickPos, setPickPos] = useState<Pos>('GKP')
  const [sort, setSort] = useState<SortKey>('rating')
  const [query, setQuery] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [maxPrice, setMaxPrice] = useState(PRICE_MAX)
  const [minRating, setMinRating] = useState(0)
  const [minDim, setMinDim] = useState<Record<string, number>>({})
  const [showFilters, setShowFilters] = useState(false)

  const fixtureEase = (data?.fixtureEase ?? []) as FixtureEaseRow[]

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
    persist([...picked, r.element])
  }
  const remove = (el: number) => { setNote(null); persist(picked.filter((x) => x !== el)) }
  const clear = () => { setNote(null); persist([]) }

  // Squad rating: average of rated players (unrated shown separately).
  const rated = chosen.map(ovOf).filter((v): v is number => v != null)
  const squadScore = rated.length ? Math.round(rated.reduce((a, b) => a + b, 0) / rated.length) : null
  const unrated = chosen.length - rated.length
  const bestXI = useMemo(() => bestElevenScore(chosen), [chosen])

  const complete = total === 15 && SLOTS.every((s) => countByPos[s.pos] === s.count)
  const valid = complete && spent <= BUDGET + 1e-9

  // Auto-pick a strong, valid squad within budget (greedy by rating with a
  // minimum-price reservation for the slots still to fill).
  const autoPick = () => {
    setNote(null)
    persist(autoBuild(pool))
  }

  // The filtered, sorted picker list.
  const dims = DIMS[pickPos]
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = pool.filter((r) => {
      if (r.position !== pickPos) return false
      if (q && !String(r.web_name).toLowerCase().includes(q)) return false
      if (priceOf(r) > maxPrice + 1e-9) return false
      if (minRating > 0 && (ovOf(r) ?? 0) < minRating) return false
      for (const d of dims) {
        const th = minDim[d.key] ?? 0
        if (th > 0 && (dim100(r, d.key) ?? 0) < th) return false
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
        <PageHeader title="Squad Builder" subtitle="Build a 15-man squad within £100m and rate it" />
        <PageSkeleton error={error} />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader title="Squad Builder" subtitle="Pick a full 15 within £100m — 2 GK, 5 DEF, 5 MID, 3 FWD, max 3 per club — and we’ll rate it" />

      {/* Summary bar */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Budget left" value={`£${remaining.toFixed(1)}m`} tone={remaining < 0 ? 'bad' : 'ink'} sub={`of £${BUDGET.toFixed(0)}m`} />
        <Stat label="Players" value={`${total}/15`} tone={total === 15 ? 'good' : 'ink'} sub={`£${spent.toFixed(1)}m spent`} />
        <Stat label="Squad rating" value={squadScore == null ? '—' : String(squadScore)} tone="accent" sub={unrated ? `${unrated} unrated` : 'avg of 15'} />
        <Stat label="Best XI" value={bestXI == null ? '—' : String(bestXI)} tone="accent" sub="top starting 11" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={autoPick} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-strong">
          <Icon name="bolt" size={14} /> Auto-pick best value
        </button>
        {total > 0 && (
          <button onClick={clear} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line-mid px-3.5 text-sm font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink">
            <Icon name="x" size={14} /> Clear
          </button>
        )}
        {valid && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-good/12 px-3 py-1 text-sm font-semibold text-good">
            <Icon name="check" size={14} /> Valid squad
          </span>
        )}
        {complete && !valid && <span className="text-sm font-medium text-bad">Over budget by £{Math.abs(remaining).toFixed(1)}m</span>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        {/* Squad slots */}
        <div>
          <div className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Your squad</div>
          <div className="flex flex-col gap-3">
            {SLOTS.map(({ pos, count }) => {
              const inPos = chosen.filter((r) => r.position === pos)
              return (
                <div key={pos} className="rounded-xl border border-line bg-surface-1/50 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
                    <PositionIcon pos={pos} size={13} /> {POS_LABEL[pos]}
                    <span className="text-ink-3">{inPos.length}/{count}</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {inPos.map((r) => (
                      <div key={r.element} className="flex items-center gap-2.5 rounded-lg bg-surface-2/50 px-2.5 py-1.5">
                        <TeamBadge team={String(r.team)} size={16} />
                        <div className="min-w-0 flex-1">
                          <button className="block w-full text-left" onClick={() => navigate(`/player?name=${encodeURIComponent(String(r.web_name))}`)}>
                            <div className="truncate text-sm font-medium text-ink hover:text-accent">{String(r.web_name)}</div>
                            <div className="text-[11px] text-ink-3">{teamLabel(String(r.team))} · £{priceOf(r).toFixed(1)}m</div>
                          </button>
                          <div className="mt-1"><FixtureChips fixtureEase={fixtureEase} team={String(r.team)} n={4} /></div>
                        </div>
                        <StarRating value={num(r, 'season_overall_score')} size={12} />
                        <button aria-label="Remove" onClick={() => remove(r.element)} className="shrink-0 text-ink-3 transition-colors hover:text-bad"><Icon name="x" size={15} /></button>
                      </div>
                    ))}
                    {Array.from({ length: Math.max(0, count - inPos.length) }).map((_, i) => (
                      <button
                        key={`e${i}`}
                        onClick={() => { setPickPos(pos); setNote(null) }}
                        className={`flex items-center gap-2 rounded-lg border border-dashed px-2.5 py-2 text-left text-sm transition-colors ${
                          pickPos === pos ? 'border-accent/60 text-accent' : 'border-line-mid text-ink-3 hover:border-line-strong hover:text-ink-2'
                        }`}
                      >
                        <Icon name="search" size={13} /> Add a {pos === 'GKP' ? 'goalkeeper' : pos === 'DEF' ? 'defender' : pos === 'MID' ? 'midfielder' : 'forward'}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Player picker */}
        <div>
          <div className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Add players</div>
          <div className="mb-3"><Tabs tabs={PICK_TABS} active={pickPos} onChange={(id) => setPickPos(id as Pos)} layoutId="squad-pos" /></div>
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-line-mid bg-surface-1 px-3">
            <Icon name="search" size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${POS_LABEL[pickPos].toLowerCase()}…`}
              className="min-h-11 w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-3 md:text-sm"
            />
            {query && <button aria-label="Clear" onClick={() => setQuery('')} className="text-ink-3 hover:text-ink"><Icon name="x" size={15} /></button>}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase">Sort</span>
            <Tabs tabs={SORT_TABS} active={sort} onChange={(id) => setSort(id as SortKey)} layoutId="squad-sort" />
            <button
              onClick={() => setShowFilters((s) => !s)}
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
          <div className="overflow-hidden rounded-xl border border-line">
            {list.map((r) => {
              const why = blockReason(r)
              const o = ovOf(r)
              return (
                <div key={r.element} className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-0">
                  <TeamBadge team={String(r.team)} size={16} />
                  <div className="min-w-0 flex-1">
                    <button className="block w-full text-left" onClick={() => navigate(`/player?name=${encodeURIComponent(String(r.web_name))}`)}>
                      <div className="truncate text-sm font-medium text-ink hover:text-accent">{String(r.web_name)}</div>
                      <div className="text-[11px] text-ink-3">{teamLabel(String(r.team))} · £{priceOf(r).toFixed(1)}m · {Math.round(num(r, 'selected_by_percent') ?? 0)}% owned</div>
                    </button>
                    <div className="mt-1"><FixtureChips fixtureEase={fixtureEase} team={String(r.team)} n={4} /></div>
                  </div>
                  <span className="w-9 shrink-0 text-right font-num text-sm font-semibold tabular-nums text-ink-2">{o ?? '—'}</span>
                  <button
                    onClick={() => add(r)}
                    disabled={!!why}
                    title={why ?? 'Add to squad'}
                    className={`grid size-8 shrink-0 place-items-center rounded-lg border transition-colors ${
                      why ? 'cursor-not-allowed border-line text-ink-3 opacity-50' : 'border-accent/50 text-accent hover:bg-accent-soft'
                    }`}
                  >
                    <Icon name="check" size={15} />
                  </button>
                </div>
              )
            })}
            {list.length === 0 && <div className="px-3 py-8 text-center text-sm text-ink-3">No players match these filters.</div>}
          </div>
        </div>
      </div>
    </PageShell>
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

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ink' | 'good' | 'bad' | 'accent' }) {
  const color = tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : tone === 'accent' ? 'text-accent' : 'text-ink'
  return (
    <div className="rounded-xl border border-line bg-surface-1/60 p-3 text-center">
      <div className={`font-display text-2xl leading-none tabular-nums ${color}`}>{value}</div>
      <div className="mt-1 text-[10px] font-semibold tracking-[0.1em] text-ink-2 uppercase">{label}</div>
      {sub && <div className="text-[10px] text-ink-3">{sub}</div>}
    </div>
  )
}

/** Best legal starting XI rating (1 GK; DEF 3–5; MID 2–5; FWD 1–3; 11 total),
 *  maximising the sum of player ratings, returned as a 0–100 average. */
function bestElevenScore(squad: RatingRow[]): number | null {
  const byPos = (p: Pos) => squad
    .filter((r) => r.position === p)
    .map(ovOf)
    .filter((v): v is number => v != null)
    .sort((a, b) => b - a)
  const gk = byPos('GKP')
  const def = byPos('DEF')
  const mid = byPos('MID')
  const fwd = byPos('FWD')
  if (!gk.length || def.length < 3 || mid.length < 2 || !fwd.length) return null
  const topN = (arr: number[], n: number) => arr.slice(0, n).reduce((a, b) => a + b, 0)
  let best = -1
  for (let d = 3; d <= 5; d++) {
    for (let m = 2; m <= 5; m++) {
      const f = 10 - d - m
      if (f < 1 || f > 3) continue
      if (def.length < d || mid.length < m || fwd.length < f) continue
      const sum = gk[0] + topN(def, d) + topN(mid, m) + topN(fwd, f)
      if (sum > best) best = sum
    }
  }
  return best < 0 ? null : Math.round(best / 11)
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
