import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { PageShell } from '../components/PageShell'
import { SectionBanner } from '../components/SectionBanner'
import { PageSkeleton } from '../components/Skeleton'
import { Tabs, type TabDef } from '../components/Tabs'
import { TeamBadge } from '../components/badges'
import { FixtureNames, FixtureRun } from '../components/FixtureChips'
import { ShareFooter } from '../components/ShareFooter'
import { SeasonPlanner } from '../components/SeasonPlanner'
import { SeasonSpine } from '../components/SeasonSpine'
import { SquadLab } from '../components/SquadLab'
import { SquadAnalysis } from '../components/SquadAnalysis'
import { SquadFixtures } from '../components/SquadFixtures'
import { SquadRiskMonitor } from '../components/SquadWatch'
import { buildSeries } from '../lib/squadInsights'
import { SquadCompare } from '../components/SquadCompare'
import { PlanBar } from '../components/PlanBar'
import { Icon } from '../components/Icon'
import { Pitch, PitchCard, BenchSpine, CARD_W } from '../components/Pitch'
import { PlayerCardSheet } from '../components/PlayerCardSheet'
import { DutyBadges, DutyLegend, dutiesOf } from '../components/DutyBadges'
import { SquadRatingSheet } from '../components/SquadRatingSheet'
import { SquadVerdict } from '../components/SquadVerdict'
import { SquadImport, type ImportedSquad } from '../components/SquadImport'
import { useCore } from '../lib/useData'
import { tapHaptic } from '../lib/native'
import { rasterise } from '../lib/capture'
import { SHARE_FORMATS, frameHeight, drawFitted, type FormatId } from '../lib/frames'
import { deliverImage } from '../lib/share'
import { num } from '../lib/rows'
import { useDiffScale } from '../lib/fixtureRuns'
import { usePlans, weeksKey } from '../lib/plans'
import { useAvailability, availBadge, availFor, SEV_COLOUR, type Availability } from '../lib/availability'
import { xpForGw, useXpModel, useMarketOdds, useShotProfiles } from '../lib/xp'
import { bestCaptainByGw } from '../lib/spine'
import { usePlanner } from '../lib/usePlanner'
import { CHIP_LABEL, autoLineup, type Chip, type Pos as PlannerPos } from '../lib/planner'
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
type View = 'build' | 'insights' | 'compare'
/** The right-hand column: the list you sign from, the read on the squad, and
 *  the run it is walking into. */
type Panel = 'market' | 'read' | 'fixtures' | 'risk'

/** Moves a stored plan spends after its opening week. Reads the plan's own
 *  week store; a plan that has never been stepped forward has none. */
function countTransfers(id: string, startGw: number): number {
  try {
    const raw = localStorage.getItem(weeksKey(id))
    if (!raw) return 0
    const weeks = JSON.parse(raw) as Record<string, { transfers?: { in?: number | null }[] }>
    let n = 0
    for (const [gw, w] of Object.entries(weeks)) {
      if (Number(gw) <= startGw) continue
      n += (w.transfers ?? []).filter((t) => t.in != null).length
    }
    return n
  } catch { return 0 }
}

const BUDGET = 100.0
const MAX_PER_CLUB = 3

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
export type Metric = 'rating' | 'price' | 'xp' | 'owned'
const METRICS: { id: Metric; label: string; short: string; hint: string }[] = [
  { id: 'rating', label: 'Rating', short: '★', hint: 'Show each player’s rating' },
  { id: 'price', label: '£', short: '£', hint: 'Show each player’s price' },
  { id: 'xp', label: 'xP', short: 'xP', hint: 'Show projected points for this gameweek' },
  { id: 'owned', label: '%', short: '%', hint: 'Show how many managers own him' },
]

/* The corner toggle, on the grass.
 *
 * It changes one number on fifteen cards, and it used to live in a row above
 * the board — far from what it changes, and costing height on a page whose
 * problem is height. On the pitch it sits beside the cards it rewrites, and
 * the row above the board is one control lighter.
 *
 * Dark glass rather than the page's chip styling: over a lit green pitch, a
 * surface-coloured pill reads as a hole cut in the grass.
 *
 * It steps down on a phone, and the size is measured rather than chosen. At
 * 360 the pitch runs 10–350 and the goalkeeper's card carries its sell ✕ out
 * to 240, which leaves 102px of clear grass in that corner. The desktop pill
 * is 159 with four chips and sat on top of that ✕ — a control covering a
 * control — so below sm the rating chip is a star, which takes the group to
 * 93 and clears by nine pixels on the narrowest phone anyone brings. Every
 * chip keeps its full name in the tooltip and the aria-label either way. */
function MetricChips({ metric, onChange }: { metric: Metric; onChange: (m: Metric) => void }) {
  return (
    <div
      className="flex gap-0.5 rounded-full border border-white/15 p-0.5 backdrop-blur-[2px]"
      style={{ background: 'rgba(6,14,10,.55)' }}
      role="group"
      aria-label="What each card's corner shows"
    >
      {METRICS.map((m) => (
        <button
          key={m.id}
          onClick={() => onChange(m.id)}
          aria-pressed={metric === m.id}
          aria-label={m.hint}
          title={m.hint}
          className={`min-h-6 rounded-full px-1.5 text-[10px] font-bold transition-colors sm:min-h-7 sm:px-2.5 sm:text-[11.5px] ${
            metric === m.id ? 'bg-accent text-accent-contrast' : 'text-white/70 hover:text-white'
          }`}
        >
          <span className="sm:hidden">{m.short}</span>
          <span className="hidden sm:inline">{m.label}</span>
        </button>
      ))}
    </div>
  )
}

/** A column heading that is also the control that sorts the column. */
function SortHead({ label, k, sort, dir, onSort, className = '' }: {
  label: string; k: SortKey; sort: SortKey; dir: SortDir
  onSort: (k: SortKey) => void; className?: string
}) {
  const on = sort === k
  return (
    <button
      onClick={() => onSort(k)}
      title={`Sort by ${label.toLowerCase()}`}
      aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`text-[9px] font-extrabold tracking-[0.1em] whitespace-nowrap uppercase transition-colors ${
        on ? 'text-accent' : 'text-ink-3 hover:text-ink-2'
      } ${className}`}
    >
      {/* The marker goes BEFORE the label, so the label's right edge stays
          flush with the numbers underneath it whether the column is sorted or
          not. Reserving space for it on the right pushed every heading a
          glyph clear of its own column. */}
      {on && <span className="mr-0.5 align-[1px] text-[8px]">{dir === 'asc' ? '▲' : '▼'}</span>}
      {label}
    </button>
  )
}

/* THE LIST SORTS FROM ITS OWN HEADINGS. There was a row of sort tabs above
   the list and a repeated PRICE / XP / RTG caption under every single number
   in it — the same four words restated sixty times, and still no column
   headings. One heading row does both jobs: it names the column once and it
   is the control that sorts it. */
type SortKey = 'name' | 'xp' | 'rating' | 'price' | 'owned'
type SortDir = 'asc' | 'desc'
/** Names read A–Z; every number reads best-first. */
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: 'asc', xp: 'desc', rating: 'desc', price: 'desc', owned: 'desc',
}

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
/** Scroll the page to `y` over a fixed, short duration.
 *
 *  `scrollIntoView({behavior:'smooth'})` picks its own duration and scales it
 *  with distance, so dropping from the pitch to the list below took the best
 *  part of a second and felt like the page was thinking about it. This is a
 *  flat 280ms with an ease-out, so a long jump lands as fast as a short one.
 *  Honours the reduced-motion preference by jumping outright. */
function glideTo(y: number) {
  const from = window.scrollY
  const to = Math.max(0, y)
  const dist = to - from
  if (Math.abs(dist) < 2) return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { window.scrollTo(0, to); return }
  const DUR = 280
  let start: number | null = null
  const step = (t: number) => {
    if (start == null) start = t
    const k = Math.min(1, (t - start) / DUR)
    window.scrollTo(0, from + dist * (1 - Math.pow(1 - k, 3)))
    if (k < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

const PRICE_MIN = 4.0
const PRICE_MAX = 15.5 // a hair above the most expensive player so nobody is filtered out by default

/** Weeks the spine draws at once.

    Twelve — and the route here is worth keeping, because two rounds of it
    were spent solving the wrong problem. The crest looked too small, so the
    count went twelve to ten, then ten to eight was measured as well. Eight
    gives 130px columns while the contents of a cell — a 19px crest and a
    three-character number — need about 40px. Ninety pixels of every cell was
    empty.

    The crest was never short of COLUMNS. It was short of SIZE: it was drawn
    at 11px in a cell that had room for far more, and no number of columns
    removed was ever going to change that. With the crest at 19px and the
    number at 13, twelve columns fit a 1280 laptop at 86x32px each with
    nothing clipped and no horizontal scrollbar — the same badge eight columns
    would have bought, with four more weeks of season beside it. */
const SPINE_WEEKS = 12

export default function SquadBuilder() {
  const { data, error } = useCore()
  const navigate = useNavigate()
  /* The fifteen now belongs to a PLAN, and there can be several. The library
     owns the storage — including migrating whatever the old single-squad key
     held into "Plan 1" — so the page holds no squad of its own. */
  const plans = usePlans()
  const picked = useMemo(() => plans.active?.base ?? [], [plans.active])
  const [pickPos, setPickPos] = useState<Pos>('GKP')
  const [metric, setMetric] = useState<Metric>('rating')
  const [sheetFor, setSheetFor] = useState<RatingRow | null>(null)
  const [sort, setSort] = useState<SortKey>('xp')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  /** Click a heading to sort by it; click it again to turn it round. */
  const sortBy = (k: SortKey) => {
    if (k === sort) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); return }
    setSort(k); setSortDir(DEFAULT_DIR[k])
  }
  /** One club, or all of them. The club you are shopping in is the filter
   *  people reach for first — a fixture swing is a club-wide event — so it
   *  sits in the open rather than behind the Filters button. */
  const [club, setClub] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [note, setNote] = useState<string | null>(null)

  const marketRef = useRef<HTMLDivElement>(null)

  /* Tapping an empty shirt, or selling someone, switches the picker to that
     position. On a wide screen the picker is the right-hand column and you see
     it happen; stacked on a phone it sits below the pitch, so the tap looked
     like it did nothing. Bring the list to the player — but only when it isn't
     already on screen, so the desktop layout never jumps. */
  /* Keep the pitch where it is across a removal.

     Selling a player switches the picker to his position, and that used to be
     all it did — yet the page still moved, by 800px on a phone. Nothing was
     scrolling it: taking a man out changes the height of the read above the
     board, and the browser's own scroll anchoring then dragged the view. You
     often clear two or three players in a row, so being thrown down the page
     after each one made that a fight.

     The reflow arrives over several frames, not one, so a single correction
     measured against a half-finished layout and missed most of the jump. This
     holds the pitch still until the layout stops moving — and gets out of the
     way the moment you scroll yourself.

     Phones only, deliberately. On a two-column desktop the board sits beside
     the read rather than under it, so a removal moves the pitch by a few
     pixels and the compensating scroll is the bigger event: measured at 1440,
     selling a player scrolled the page 37px under a stationary mouse pointer,
     and a pointer that has not moved keeps the hover and hit-test state the
     browser computed before the scroll. The reported symptom was the page
     "thinking the mouse is higher than it is" and the restore button refusing
     the next click — which is exactly that. Nothing is lost by skipping it:
     the desktop jump this was written to absorb is a phone problem. */
  const holdPitch = () => {
    if (window.matchMedia('(min-width: 1024px)').matches) return
    const at = () => document.querySelector('[data-pitch]')?.getBoundingClientRect().top ?? null
    const before = at()
    if (before == null) return
    let frames = 0
    let settled = 0
    let cancelled = false
    const stop = () => { cancelled = true }
    window.addEventListener('wheel', stop, { once: true, passive: true })
    window.addEventListener('touchstart', stop, { once: true, passive: true })
    const tick = () => {
      if (cancelled || frames++ > 40) {
        window.removeEventListener('wheel', stop)
        window.removeEventListener('touchstart', stop)
        return
      }
      const now = at()
      if (now != null && Math.abs(now - before) > 1) { window.scrollBy(0, now - before); settled = 0 }
      else if (++settled > 3) { window.removeEventListener('wheel', stop); window.removeEventListener('touchstart', stop); return }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  const focusMarket = (pos: Pos) => {
    setPickPos(pos)
    setQuery('')
    setNote(null)
    requestAnimationFrame(() => {
      const el = marketRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      // "On screen" is generous on purpose: a desktop that can already see the
      // top of the list should not twitch, only a phone that can't should move.
      const seen = r.top < window.innerHeight * 0.9 && r.bottom > 80
      if (!seen) glideTo(window.scrollY + r.top - 72)
    })
  }
  const [maxPrice, setMaxPrice] = useState(PRICE_MAX)
  const [minRating, setMinRating] = useState(0)
  const [minDim, setMinDim] = useState<Record<string, number>>({})
  const [showFilters, setShowFilters] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [ratingOpen, setRatingOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  /* Arriving from the home page's "Import a screenshot" opens the picker
     straight away. It used to land here on an empty board with the same
     button to press again, which is one tap of nothing between wanting the
     thing and getting it. The state is cleared on arrival so going back and
     forward, or refreshing, doesn't reopen the sheet over a squad. */
  const location = useLocation()
  useEffect(() => {
    if ((location.state as { openImport?: boolean } | null)?.openImport) {
      setImportOpen(true)
      navigate('.', { replace: true, state: null })
    }
  }, [location.state, navigate])
  /* The eleven a screenshot arrived with. Held here rather than in the modal
     because the planner needs it after the modal has gone, and dropped the
     moment the squad stops matching it — see `seed` in usePlanner. */
  const [importedXI, setImportedXI] = useState<{ xi: number[]; bench: number[]; captain: number | null; vice: number | null } | null>(null)
  // Transfers run through the list beside the board: sell from the pitch and
  // the empty place waits to be filled, or pick the player coming in first
  // and choose who makes way for him.
  const [pendingIn, setPendingIn] = useState<RatingRow | null>(null)
  /* Build the squad, or read it. The analysis used to sit in the right-hand
     column under the transfer market, which made a laptop scroll past the
     pitch to reach it and a phone scroll past everything. It is a different
     job from picking, so it gets its own tab rather than more page. */
  const [view, setView] = useState<View>('build')
  /** Which panel the right-hand column is showing. */
  const [panel, setPanel] = useState<Panel>('market')
  /** What the last fork did, until dismissed. */
  const [forked, setForked] = useState<{ name: string; from: string; gw: number } | null>(null)

  const avail = useAvailability()
  // The site's own fixture difficulty — the turn map colours by it, so its
  // greens mean the same thing as the Fixtures page's greens.
  const diffScale = useDiffScale(data)
  const listXpModel = useXpModel()
  const listMarket = useMarketOdds()
  const listProfiles = useShotProfiles()
  const fixtureEase = (data?.fixtureEase ?? []) as FixtureEaseRow[]
  // You build for one gameweek — the next one to be played — and then plan
  // forward from it. Everything on this page is anchored to that number.
  const buildGw = fixtureEase.length ? Math.min(...fixtureEase.map((f) => f.gw)) : (data?.meta?.next_gw ?? 1)

  // Prices and ownership arrive live from useCore, so the budget and the
  // template read are never stale.
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

  // Form streak comes from the season-to-date table, keyed by element.
  const streakByEl = useMemo(() => {
    const m = new Map<number, string>()
    for (const r of data?.seasonToDate ?? []) m.set(Number(r.element), String(r.streak ?? ''))
    return m
  }, [data])
  const nameOfEl = (el: number) => String(byEl.get(el)?.web_name ?? '')

  const persist = (next: number[]) => plans.setBase(next)

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

  const complete = total === 15 && SLOTS.every((s) => countByPos[s.pos] === s.count)
  const valid = complete && spent <= BUDGET + 1e-9

  const planner = usePlanner({
    base: picked, byEl, startGw: buildGw, fixtureEase, seed: importedXI,
    // Each plan keeps its own week decisions; switching plan switches them.
    storeKey: plans.activeId ? weeksKey(plans.activeId) : undefined,
    // Opening-week edits change the fifteen rather than recording a transfer,
    // and the fifteen belongs to the plan.
    onBaseChange: (next) => plans.setBase(next),
  })
  // The board's week drives what the list is for: before the fifteen exists
  // it's an add list, after it's the transfer market for the week on screen.
  const plannerSquad = complete && planner.week ? planner.squad : picked
  // Everything that describes "your squad" reads from the week on screen.
  const liveChosen = useMemo(
    () => plannerSquad.map((el) => byEl.get(el)).filter(Boolean) as RatingRow[],
    [plannerSquad, byEl],
  )
  const liveRated = liveChosen.map(ovOf).filter((v): v is number => v != null)
  const liveScore = liveRated.length ? Math.round(liveRated.reduce((a, b) => a + b, 0) / liveRated.length) : null
  const liveBestXI = useMemo(() => bestElevenScore(liveChosen), [liveChosen])
  const liveGw = complete ? planner.gw : buildGw

  /* The per-player projection series the risk monitor reads. Built here only
     when its tab is open — it walks fifteen players across six weeks and the
     board has no use for it otherwise. */
  const riskGws = useMemo(() => planner.gws.filter((g) => g >= liveGw).slice(0, 6), [planner.gws, liveGw])
  const riskSeries = useMemo(
    () => (panel === 'risk' && complete
      ? buildSeries(liveChosen, riskGws, { fixtureEase, avail, model: listXpModel, market: listMarket, profiles: listProfiles })
      : []),
    [panel, complete, liveChosen, riskGws, fixtureEase, avail, listXpModel, listMarket, listProfiles],
  )

  /* ── the season spine's three inputs ──────────────────────────────────
     Twelve weeks: the half-season the fixtures page settled on as a planning
     unit, and as many columns as a phone carries with a name still legible
     in the cell. */
  /* The window is REMEMBERED, not recomputed from the selection. Deriving it
     from the selected week meant every click re-centred the strip, so the
     column you tapped slid out from under your finger and the one you landed
     on was somewhere else — clicking forward and clicking back both moved the
     week you had just chosen. It only moves when the chosen week is not on
     screen, and then by the least it can. */
  const spineAll = useMemo(() => planner.gws.filter((g) => g >= buildGw), [planner.gws, buildGw])
  const [spineStart, setSpineStart] = useState(0)
  useEffect(() => {
    const i = spineAll.indexOf(planner.gw)
    if (i < 0) return
    setSpineStart((cur) => {
      const max = Math.max(0, spineAll.length - SPINE_WEEKS)
      const from = Math.min(cur, max)
      if (i < from) return i                                  // stepped off the left
      if (i > from + SPINE_WEEKS - 1) return Math.min(i - SPINE_WEEKS + 1, max)
      return from                                             // already in view: hold still
    })
  }, [planner.gw, spineAll])
  const spineGws = useMemo(
    () => spineAll.slice(spineStart, spineStart + SPINE_WEEKS),
    [spineAll, spineStart],
  )
  /* The plan's own decisions for each week in the window.

     The planner only MATERIALISES a week when you visit it — the effect that
     writes state.weeks[gw] runs for the current week and no other — so every
     week you had not stepped through had no XI and no captain, and the grid
     showed neither. You had to click all twelve to light them up, which is
     not a plan, it is a chore.

     So unvisited weeks are derived here the same way the planner will derive
     them when you do arrive: carry the last lineup forward while it is still
     legal for that week's fifteen, else auto-pick the best eleven. Read-only
     — nothing is written, and what you see now is what the planner will
     commit when you get there. */
  const spinePlan = useMemo(() => {
    const xi = new Map<number, number[]>()
    const captain = new Map<number, number | null>()
    const chip = new Map<number, string | null>()
    const movesIn = new Map<number, number>()
    if (!complete) return { xi, captain, chip, movesIn }
    const ratingOf = (el: number) => (num(byEl.get(el) ?? {}, 'season_overall_score') ?? 0) * 20
    const posOf = (el: number) => String(byEl.get(el)?.position ?? 'MID') as PlannerPos
    type Line = { xi: number[]; bench: number[]; captain: number | null }
    let carried: Line | null = null
    for (const g of spineGws) {
      const squad = planner.squadAtGw(g)
      const w = planner.weekAt(g)
      if (w) {
        chip.set(g, w.chip ?? null)
        const n = (w.transfers ?? []).filter((t) => t.in != null).length
        if (n) movesIn.set(g, n)
      }
      const stored: Line | null = w && w.xi?.length === 11
        ? { xi: w.xi, bench: w.bench ?? [], captain: w.captain ?? null }
        : null
      const carryOk: boolean = !!carried && carried.xi.length === 11
        && carried.xi.every((e) => squad.includes(e))
      const auto = () => {
        const a = autoLineup(squad, posOf, ratingOf)
        return { xi: a.xi, bench: a.bench, captain: a.captain } as Line
      }
      const line: Line = stored ?? (carryOk && carried ? carried : auto())
      xi.set(g, line.xi)
      // A stored week can have no captain; fall back to the best of the eleven
      // rather than leaving the armband off the grid entirely.
      captain.set(g, line.captain ?? autoLineup(line.xi, posOf, ratingOf).captain)
      carried = line
    }
    return { xi, captain, chip, movesIn }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spineGws, complete, planner.revision, byEl])

  /* Bar heights, read off the SAME lineups the grid draws.

     They were not, and it showed: the bar totalled the first eleven of the
     squad array with nobody captained, while the grid derived the best legal
     eleven and an armband. Tapping a week swapped one for the other, so the
     number jumped up the moment you looked at it — the plan appearing to
     improve because you clicked on it. One source, so there is nothing left
     to disagree. */
  const spineXp = useMemo(() => {
    const out = new Map<number, number>()
    if (!complete) return out
    for (const g of spineGws) {
      const xi = spinePlan.xi.get(g)
      if (!xi) continue
      const cap = spinePlan.captain.get(g)
      let total = 0
      for (const el of xi) {
        const r = byEl.get(el)
        if (!r) continue
        const v = xpForGw(r, g, fixtureEase, avail, listXpModel, listMarket, listProfiles) ?? 0
        total += el === cap ? v * 2 : v
      }
      out.set(g, total)
    }
    return out
  }, [spineGws, complete, spinePlan, byEl, fixtureEase, avail, listXpModel, listMarket, listProfiles])

  const spineBest = useMemo(
    () => (complete && spineGws.length
      ? bestCaptainByGw(pool, spineGws, fixtureEase, avail, listXpModel, listMarket, listProfiles)
      : undefined),
    [complete, spineGws, pool, fixtureEase, avail, listXpModel, listMarket, listProfiles],
  )

  /* Expected points for the gameweek you are actually picking. Cached because
     the market list re-renders on every keystroke in the search box and the
     projection is not free. */
  const xpCache = useMemo(() => new Map<number, number | null>(), [liveGw, listXpModel, listMarket, avail])
  const xpOf = (r: RatingRow): number | null => {
    const el = Number(r.element)
    if (!xpCache.has(el)) xpCache.set(el, xpForGw(r, liveGw, fixtureEase, avail, listXpModel, listMarket))
    return xpCache.get(el) ?? null
  }
  const unrated = liveChosen.length - liveRated.length
  /** The eleven the lab reads for captaincy — the week's lineup once the
   *  planner is running, and nothing before that. */
  const liveXI = useMemo(
    () => (planner.week?.xi ?? []).map((el) => byEl.get(el)).filter(Boolean) as RatingRow[],
    [planner.week, byEl],
  )
  /** The ticked plans, resolved to squads. A plan whose fifteen is incomplete
   *  still comes through — the comparison says so rather than hiding it, which
   *  is the difference between "not ready" and "not there". */
  const comparing = useMemo(
    () => plans.compare
      .map((id) => plans.plans.find((p) => p.id === id))
      .filter(Boolean)
      .map((p) => ({
        plan: p!,
        squad: p!.base.map((el) => byEl.get(el)).filter(Boolean) as RatingRow[],
        /* Moves the plan actually spends, read from its own stored weeks. The
           opening week is excluded: assembling a first fifteen is building a
           squad, not making transfers, and counting it would penalise every
           plan by fifteen. Used only to break a tie on points — two plans that
           project the same are not equal if one of them paid for it. */
        transfers: countTransfers(p!.id, buildGw),
      })),
    [plans.compare, plans.plans, byEl, buildGw],
  )

  /** Places sold and not yet refilled, and which positions they are. */
  const openPlaces = planner.pendingOut.length
  const openBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const el of planner.pendingOut) {
      const p = String(byEl.get(el)?.position ?? '')
      m.set(p, (m.get(p) ?? 0) + 1)
    }
    return [...m.entries()]
  }, [planner.pendingOut, byEl])

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
      if (club && String(r.team) !== club) return false
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
      if (sort === 'xp') return xpOf(r) ?? -1
      return ovOf(r) ?? -1
    }
    const cmp = sort === 'name'
      ? (a: RatingRow, b: RatingRow) => String(a.web_name).localeCompare(String(b.web_name))
      : (a: RatingRow, b: RatingRow) => key(a) - key(b)
    const sorted = [...rows].sort((a, b) => (sortDir === 'asc' ? cmp(a, b) : -cmp(a, b)))
    // With a player armed, anyone you can't actually sign is noise — keep them
    // in the list (so the reason stays visible) but let the affordable ones
    // rise to the top rather than sitting 40 rows down.
    if (openPlaces > 0) {
      // Whoever you just sold goes to the top, not the bottom. He can't be
      // signed back, so the affordability sort was burying him past the
      // sixty-row cut and he vanished from the list entirely — along with any
      // sign that he'd gone anywhere. Everyone you can actually sign comes
      // next, and the rest after.
      const bucket = (r: RatingRow) =>
        planner.pendingOut.includes(r.element) ? 0 : planner.canFill(r.element) == null ? 1 : 2
      sorted.sort((a, b) => bucket(a) - bucket(b))
    }
    return sorted.slice(0, 60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, pickPos, query, sort, sortDir, club, maxPrice, minRating, minDim, dims, openPlaces, planner.pendingOut, plannerSquad])

  const activeFilters = (maxPrice < PRICE_MAX ? 1 : 0) + (minRating > 0 ? 1 : 0) + dims.filter((d) => (minDim[d.key] ?? 0) > 0).length
  const resetFilters = () => { setMaxPrice(PRICE_MAX); setMinRating(0); setMinDim({}) }
  /** Every club with a rated player, so a promoted side appears without a
   *  code being typed in anywhere. */
  const clubs = useMemo(
    () => [...new Set(pool.map((r) => String(r.team)))].sort((a, b) => teamLabel(a).localeCompare(teamLabel(b))),
    [pool],
  )

  const planBar = (
    <PlanBar
      plans={plans}
      canCompare={plans.compare.length >= 2}
      onCompare={() => setView('compare')}
    />
  )

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

      {/* A fork switches you into a plan that looks identical to the one you
          were in — same fifteen, same weeks behind you — so without a line
          saying so the only evidence is a name in the strip above. It says
          which plan you are now in and what is different about it. */}
      {forked && (
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-accent/45 bg-accent-soft px-3 py-2 text-[12.5px]">
          <Icon name="target" size={14} className="shrink-0 text-accent" />
          <span className="font-semibold text-accent">Forked into “{forked.name}”.</span>
          <span className="text-ink-2">
            Everything up to GW{forked.gw - 1} came with it; GW{forked.gw} onwards is empty, so you can
            take a different route. “{forked.from}” is untouched.
          </span>
          <button onClick={() => setForked(null)} className="ml-auto text-[11px] font-semibold text-ink-3 hover:text-ink">Got it</button>
        </div>
      )}

      {/* THE VIEW AND THE PLAN, ON ONE LINE. Which squad you are looking at
          and which reading of it you want are the two questions that precede
          every other one on this page, and they were answered in two separate
          bands — the library across the top, the tabs under it. Together they
          are one row: tabs on the left, the library filling the rest.

          Below lg the library wraps under the tabs, which is the same order,
          just stacked — a phone cannot hold both across. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Insights only exists once there are fifteen players to read.
            Offering the tab on an empty squad and landing on empty panels is
            worse than not offering it, so it appears when the squad does. */}
        {(complete || plans.compare.length >= 2) && (
          <Tabs
            tabs={[
              { id: 'build', label: 'Squad' },
              ...(complete ? [{ id: 'insights', label: 'Insights' }] : []),
              /* Comparing plans is its own job, not a reading of one squad, so
                 it sits beside Insights rather than inside it. No count in the
                 label — the strip beside it already says how many are ticked,
                 and a number in a tab reads as a badge for something unread. */
              ...(plans.compare.length >= 2 ? [{ id: 'compare', label: 'Compare plans' }] : []),
            ]}
            active={view}
            onChange={(id) => setView(id as View)}
            layoutId="squad-view"
          />
        )}
        {/* basis-full below lg, or it tries to share the line with the tabs
            on a phone and loses: the tabs take 330 of 390, the library is left
            with 44, and the Compare button — which cannot shrink — hangs 85px
            off the right of the document. Measured as a sideways scroll on
            the whole page. From lg there is room for both. */}
        <div className="min-w-0 basis-full lg:flex-1 lg:basis-0">{planBar}</div>
      </div>

      {view === 'compare' && (
        <SquadCompare
          plans={comparing}
          /* Twelve weeks, not six: the compare page owns the horizon now and
             has to be able to offer more than the window it is given. It slices
             this down to whatever the reader picks. */
          gws={planner.gws.filter((g) => g >= liveGw).slice(0, 12)}
          engine={{ fixtureEase, avail, model: listXpModel, market: listMarket, profiles: listProfiles }}
        />
      )}

      {view === 'insights' && (
        <SquadAnalysis
          squad={liveChosen}
          xi={liveXI.length ? liveXI : liveChosen}
          pool={pool}
          gws={planner.gws.filter((g) => g >= liveGw).slice(0, 6)}
          engine={{ fixtureEase, avail, model: listXpModel, market: listMarket, profiles: listProfiles }}
          fixtureEase={fixtureEase}
          diffScale={diffScale}
          bank={Math.max(0, BUDGET - planner.spend)}
          captain={planner.week?.captain ?? null}
          seasonToDate={(data?.seasonToDate ?? null) as never}
          playedGws={Math.max(0, buildGw - 1)}
        />
      )}

      <div hidden={view !== 'build'}>
      {/* The right-hand column is the Squad Lab's column, and it is sized for
          the lab rather than for whatever the pitch left over. It steps up with
          the screen: 400 on a small laptop, where 680 of board plus 680 of
          column simply does not fit; 520 from 1280; 680 from 1400, which is
          where a 1440 screen lands and where the lab's five tiles reach 124px
          each — enough for the longest thing one ever says, a captain's name,
          which needed 103px of the 98 it had. */}
          {/* FULL WIDTH, above the two columns rather than inside the left one.
          It is twelve columns of grid plus a name stub; squeezed into the
          board's column beside a 400–680px panel it had room for nine of
          them, so the instrument that is supposed to show the season could
          not show the season. It answers the question the board below then
          works on — which week am I looking at — so it sits above both.
          Only with a full fifteen: the rows ARE the squad. */}
      {complete && (
        <SeasonSpine
          state={planner.state}
          byEl={byEl}
          fixtureEase={fixtureEase}
          gws={spineGws}
          gw={planner.gw}
          onPickGw={planner.setGw}
          weekXp={spineXp}
          bestCaptain={spineBest}
          xiByGw={spinePlan.xi}
          captainByGw={spinePlan.captain}
          chipByGw={spinePlan.chip}
          movesByGw={spinePlan.movesIn}
          /* One week a step. Half a window jumped the whole strip and you had
             to find your place again; a single column keeps every other week
             where it was and just brings the next one in. */
          onShift={(dir) => setSpineStart((cur) => {
            const max = Math.max(0, spineAll.length - SPINE_WEEKS)
            return Math.min(max, Math.max(0, cur + (dir === 'fwd' ? 1 : -1)))
          })}
          canShift={{
            back: spineStart > 0,
            fwd: spineStart < Math.max(0, spineAll.length - SPINE_WEEKS),
          }}
          avail={avail}
          model={listXpModel}
          market={listMarket}
          profiles={listProfiles}
        />
      )}

      <div className="no-anchor grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_520px] wide:grid-cols-[minmax(0,1fr)_680px] lg:items-start">
        {/* The board — the same object from an empty squad to a full one:
            unfilled places are just empty slots you tap to fill. */}
        <div className="min-w-0">
          <SeasonPlanner
            planner={planner} byEl={byEl} pool={pool} fixtureEase={fixtureEase}
            metric={metric} avail={avail} spineAbove={complete}
            boardOverlay={<MetricChips metric={metric} onChange={setMetric} />}
            /* Share acts on the board — it photographs exactly this — so it
               lives on the board, in the corner opposite the toggle. Same dark
               glass, and gone until there is a squad worth a picture. */
            boardOverlayLeft={total > 0 ? (
              <button
                onClick={() => setShareOpen(true)}
                title="Share this squad as a picture"
                className="inline-flex min-h-6 items-center gap-1 rounded-full border border-white/15 px-2 text-[10px] font-bold text-white/80 backdrop-blur-[2px] transition-colors hover:text-white sm:min-h-7 sm:gap-1.5 sm:px-3 sm:text-[11.5px]"
                style={{ background: 'rgba(6,14,10,.55)' }}
              >
                <Icon name="users" size={12} /> Share
              </button>
            ) : null}
            /* The squad-wide actions, handed to the planner so they can share
               the gameweek's row instead of having one of their own. Share and
               Clear used to sit UNDER the pitch on the theory that you share a
               squad once you've built one — but on a laptop that puts them
               below the fold of the thing they act on, and on a phone it means
               scrolling past fifteen cards to start again.

               What used to open this row — "Your squad — week by week" — has
               gone. The page is titled Squad Builder, the tab under it says
               Squad, and the row itself says which gameweek. A fourth label
               saying the same thing was a line of type between you and the
               team. The metric chips have gone the other way, onto the pitch,
               beside the number they change. */
            toolbar={<>
              {complete && !valid && <span className="text-[13px] font-semibold text-bad">Over budget by £{Math.abs(remaining).toFixed(1)}m</span>}
              {/* Auto pick used to sit in the chip row under the board, which
                  is past fifteen cards on a phone and below the fold on a
                  laptop — a long way from the empty pitch it exists to fill.
                  It is the fastest route to a squad, so it goes first in the
                  row of things you do to the squad as a whole. */}
              <button
                onClick={() => { tapHaptic('medium'); (complete ? planner.autoXI : autoPick)() }}
                title={complete ? 'Pick the best eleven from your fifteen' : 'Fill the rest of your fifteen'}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12px] font-bold text-accent-contrast transition-colors hover:bg-accent-strong"
              >
                <Icon name="bolt" size={13} /> Auto pick
              </button>
              {/* Typing fifteen names in is the reason people build a fantasy
                  squad here and then never come back with their real one. */}
              <button onClick={() => setImportOpen(true)} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-line-mid px-3 text-[12px] font-semibold text-ink transition-colors hover:border-line-strong">
                <Icon name="camera" size={13} /> Import
              </button>
              {/* Share has gone to the board — see boardOverlayLeft above. */}
              {total > 0 && (
                <button onClick={clear} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-line-mid px-3 text-[12px] font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink">
                  <Icon name="x" size={13} /> Clear
                </button>
              )}
            </>}
            /* No fork once the library is full — the button would be there to
               tell you it can't, which is worse than not being there. */
            onFork={plans.full || !plans.activeId ? undefined : (gw) => {
              const from = plans.active?.name ?? 'this plan'
              const made = plans.fork(plans.activeId!, gw)
              if (made) setForked({ name: made.name, from, gw })
            }}
            squadScore={liveScore}
            onOpenSquadRating={() => setRatingOpen(true)}
            partialSquad={picked}
            onRemovePick={remove}
            onPickSlot={(p) => focusMarket(p as Pos)}
            /* Share, Clear and the budget warning now ride in the control row
               above the board — see the comment there. */
            footer={null}
            onSold={(el: number) => { holdPitch(); setPickPos(String(byEl.get(el)?.position ?? 'MID') as Pos); setQuery(''); setPendingIn(null) }}
          />
        </div>

        {/* The read on the squad, then the market you act on it with. The read
            used to sit above the pitch, where it pushed the eleven you are
            picking a long way down a laptop screen — the one thing the page
            exists to show. Beside the board it is level with what it
            describes, and the column below it is where you do something
            about it.

            The market, not the whole column, is what sticks: on a full squad
            the read runs about seven hundred pixels, and a sticky element
            taller than the screen pins at the top with its bottom out of
            reach. So the read scrolls away and the market pins behind it,
            which is the behaviour the market had before the read arrived. */}
        <div ref={marketRef} className="mt-8 min-w-0 scroll-mt-20 lg:mt-0">
          {/* THREE PANELS, ONE AT A TIME. This column used to be a stack: the
              verdict, the Lab, then the market. On a full squad that is about
              1,400 pixels against 660 of board, so two thirds of it was always
              scrolled past — and the market, the one thing here you ACT with,
              was the part at the bottom.

              Each tab answers a different question. Market: who could I sign.
              Analysis: what have I got. Fixtures: what is coming. Risk: what
              could go wrong with it. Market leads
              because it is the only one you do anything in; the other two are
              reading, and reading can wait for you to ask for it.

              All but Players need a fifteen to be about, so before there is
              one there are no tabs at all — just the list. */}
          {complete && (
            <div className="mb-3">
              <Tabs
                tabs={[
                  /* "Players", not "Market" or "Squad" — the first because
                     there is no market at the opening week, where you are
                     picking rather than trading, and the second because the
                     row above already has a tab called Squad and two of them
                     on one screen meaning different things is a puzzle. */
                  { id: 'market', label: 'Players' },
                  { id: 'read', label: 'Analysis' },
                  { id: 'fixtures', label: 'Fixtures' },
                  { id: 'risk', label: 'Risk' },
                ]}
                active={panel}
                onChange={(id) => setPanel(id as Panel)}
                layoutId="squad-panel"
              />
            </div>
          )}

          {complete && panel === 'read' && (
            <div className="mb-4 flex flex-col gap-3">
              <SquadVerdict
                chosen={liveChosen} fixtureEase={fixtureEase} gw={liveGw} avail={avail}
                score={liveScore} bestXI={liveBestXI} onOpen={() => setRatingOpen(true)}
              />
              <SquadLab
                squad={liveChosen} xi={liveXI} pool={pool} fixtureEase={fixtureEase} avail={avail}
                gw={liveGw} gws={planner.gws} bank={BUDGET - planner.spend} freeTransfers={planner.banked}
                unlimitedTransfers={planner.ft === Infinity}
                chipSpentAt={planner.chipSpent}
                onApplyMove={(outEl, inEl) => { planner.doTransfer(outEl, inEl); setPendingIn(null) }}
              />
            </div>
          )}

          {/* The risk monitor was buried in an Insights sub-tab called Watch,
              two clicks from the board it is about. It belongs beside the
              fixtures: both answer "what is coming", one in games and one in
              prices and fitness. */}
          {complete && panel === 'risk' && (
            <div className="mb-4">
              <SquadRiskMonitor
                squad={riskSeries}
                gws={riskGws}
                fixtureEase={fixtureEase}
                avail={avail}
              />
            </div>
          )}

          {complete && panel === 'fixtures' && (
            <div className="mb-4">
              <SquadFixtures
                squad={plannerSquad} xi={planner.week?.xi ?? []} byEl={byEl} fixtureEase={fixtureEase}
                gw={liveGw} onPickGw={(g) => planner.setGw(g)}
              />
            </div>
          )}

          <div hidden={complete && panel !== 'market'} className="lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100vh-6rem)] lg:flex-col">
          <div className="lg:shrink-0">
          <div className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">
            {!complete ? 'Add players' : planner.opening ? `Your fifteen — GW${planner.gw}` : `Transfer market — GW${planner.gw}`}
          </div>

          {complete && openPlaces > 0 && (
            <div className="mb-2 rounded-lg border border-accent/50 bg-accent-soft px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Icon name="coin" size={14} className="shrink-0 text-accent" />
                <span className="font-num text-sm font-bold text-accent">£{(BUDGET - planner.spend).toFixed(1)}m</span>
                <span className="text-sm text-ink">to spend on {openPlaces} {openPlaces === 1 ? 'place' : 'places'}</span>
                <button
                  onClick={() => planner.pendingOut.forEach((el) => planner.undoTransfer(el))}
                  className="ml-auto text-xs font-semibold text-ink-3 hover:text-ink"
                >keep them all</button>
              </div>
              <div className="mt-0.5 pl-6 text-[11px] text-ink-3">
                {openBy.map(([pos, n]) => `${n} ${pos}`).join(' · ')} — sell another to pool more
              </div>
            </div>
          )}

          {/* Position and search on one line. They are the same decision made
              two ways — which players am I looking at — and stacking them cost
              a whole row of the panel for a control four chips wide. */}
          <div className="mb-3 flex items-center gap-2">
            <div className="shrink-0"><Tabs tabs={PICK_TABS} active={pickPos} onChange={(id) => setPickPos(id as Pos)} layoutId="squad-pos" /></div>
            <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-line-mid bg-surface-1 px-2.5">
              <Icon name="search" size={15} className="shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="min-h-10 w-full min-w-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-3 md:text-sm"
              />
              {query && <button aria-label="Clear" onClick={() => setQuery('')} className="shrink-0 text-ink-3 hover:text-ink"><Icon name="x" size={15} /></button>}
            </div>
          </div>
          {/* THE CLUB FILTER, IN THE OPEN. It was behind a Filters button with
              the price and rating sliders, which is the wrong place for it:
              you shop by club — a fixture swing, a new manager, a price rise
              — far more often than you shop by a minimum Def Con score, and a
              filter you cannot see is a filter nobody uses. Crests rather than
              a dropdown, because the crest IS how you think of the club. */}
          <div className="@container mb-3 rounded-xl border border-line bg-surface-1/50 p-2.5">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[10px] font-extrabold tracking-[0.12em] text-ink-3 uppercase">Club</span>
              {club && <span className="text-[11px] text-ink-3">{teamLabel(club)}</span>}
              {club && (
                <button onClick={() => setClub(null)} className="ml-auto text-[11px] font-semibold text-accent hover:underline">
                  Clear
                </button>
              )}
            </div>
            {/* A GRID, NOT A WRAP. Wrapping fitted nineteen crests and put the
                twentieth alone on a line of its own, which reads as a bug. Ten
                to a row narrow, all twenty on one row once there is room for a
                28px cell each — the count is fixed either way, so the shelf is
                always full. */}
            <div className="grid grid-cols-10 gap-1 @[600px]:grid-cols-20">
              {clubs.map((t) => {
                const on = club === t
                return (
                  <button
                    key={t}
                    onClick={() => setClub(on ? null : t)}
                    title={teamLabel(t)}
                    aria-pressed={on}
                    className={`grid aspect-square w-full max-w-[38px] cursor-pointer place-items-center justify-self-center rounded-lg border transition ${
                      on ? 'border-accent bg-accent-selected' : 'border-transparent hover:border-line-strong'
                    } ${club && !on ? 'opacity-45' : ''}`}
                  >
                    <TeamBadge team={t} size={20} />
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowFilters((f) => !f)}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
                activeFilters > 0 ? 'border-accent bg-accent-selected text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
              }`}
            >
              <Icon name="target" size={13} /> Price &amp; rating{activeFilters > 0 ? ` (${activeFilters})` : ''} <span className="text-[10px]">{showFilters ? '▴' : '▾'}</span>
            </button>
            <span className="ml-auto text-[11px] text-ink-3">
              {list.length}{list.length === 60 ? '+' : ''} shown · tap a heading to sort
            </span>
          </div>
          <DutyLegend className="mb-3" />

          {/* FIVE SLIDERS ACROSS, NOT DOWN. Stacked, the open panel ran to
              three hundred pixels and pushed the players — the thing you
              opened the panel to filter — off the bottom of the column. They
              lie across the line now, as many to a row as the column can
              hold, so opening the filters costs one band rather than the
              list. */}
          {showFilters && (
            <div className="@container mb-3 rounded-xl border border-line bg-surface-1/50 p-3">
              <div className="grid gap-x-4 gap-y-2.5 @[380px]:grid-cols-2 @[620px]:grid-cols-3 @[900px]:grid-cols-5">
                <RangeRow label="Max price" kind="max" value={maxPrice} min={PRICE_MIN} max={PRICE_MAX} step={0.5} display={`£${maxPrice.toFixed(1)}m`} onChange={setMaxPrice} />
                <RangeRow label="Min rating" kind="min" value={minRating} min={0} max={100} step={5} display={String(minRating)} onChange={setMinRating} />
                {dims.map((d) => (
                  <RangeRow key={d.key} label={`Min ${d.label}`} kind="min" value={minDim[d.key] ?? 0} min={0} max={100} step={5} display={String(minDim[d.key] ?? 0)} onChange={(v) => setMinDim((m) => ({ ...m, [d.key]: v }))} />
                ))}
              </div>
              {activeFilters > 0 && (
                <button onClick={resetFilters} className="mt-2 text-xs font-semibold text-accent hover:underline">Reset filters</button>
              )}
            </div>
          )}

          {note && <div className="mb-2 rounded-lg bg-bad/10 px-3 py-2 text-sm font-medium text-bad">{note}</div>}
          </div>
          {/* The list takes whatever height the controls above it leave, rather
              than a fixed guess at how tall they are — the guess was 260px and
              the filters, the legend and the money banner between them run to
              three hundred, which pushed the bottom of the list off the screen
              with nothing you could scroll to reach it. */}
          <div className="@container overflow-hidden rounded-xl border border-line lg:min-h-48 lg:flex-1 lg:overflow-y-auto">
            {/* The heading row, and the sort control, and the only place the
                words PRICE, XP and RTG now appear. Sticky, because a list this
                long scrolls its own headings away otherwise. */}
            <div className="sticky top-0 z-[2] flex items-center gap-2 border-b border-line-mid bg-surface-1 px-2.5 py-1.5 @[430px]:gap-2.5 @[430px]:px-3">
              {/* Sits over the info buttons, so every heading lines up with
                  the column it names. */}
              <span className="size-7 shrink-0" />
              <SortHead label="Player" k="name" sort={sort} dir={sortDir} onSort={sortBy} className="min-w-0 flex-1 text-left" />
              <span className="hidden shrink-0 text-[9px] font-extrabold tracking-[0.1em] text-ink-3 @[430px]:inline-block @[600px]:hidden" style={{ width: 3 * 34 + 2 * 2 }}>NEXT 3</span>
              <span className="hidden shrink-0 text-[9px] font-extrabold tracking-[0.1em] text-ink-3 @[600px]:inline-block" style={{ width: 4 * 34 + 3 * 2 }}>NEXT 4</span>
              <SortHead label="Price" k="price" sort={sort} dir={sortDir} onSort={sortBy} className="w-12 shrink-0 text-right" />
              <SortHead label="xP" k="xp" sort={sort} dir={sortDir} onSort={sortBy} className="w-11 shrink-0 text-right" />
              <SortHead label="Rtg" k="rating" sort={sort} dir={sortDir} onSort={sortBy} className="w-9 shrink-0 text-right" />
              <SortHead label="Own" k="owned" sort={sort} dir={sortDir} onSort={sortBy} className="w-11 shrink-0 text-right" />
              <span className="size-8 shrink-0" />
            </div>
            {list.map((r) => {
              // A player on the market is still yours until someone replaces
              // him, so the list has to say so rather than showing him as a
              // free agent.
              const onMarket = complete && planner.pendingOut.includes(r.element)
              const inSquad = plannerSquad.includes(r.element) || onMarket
              // With places open on the pitch, signing straight into one is
              // the whole point — the money from every sale is already pooled.
              const filling = complete && openPlaces > 0
              const why = complete
                ? (filling ? planner.canFill(r.element) : inSquad ? 'Already in your squad' : null)
                : blockReason(r)
              const o = ovOf(r)
              return (
                <div key={r.element} className={`flex items-center gap-2 border-b border-line px-2.5 py-2 last:border-0 @[430px]:gap-2.5 @[430px]:px-3 ${inSquad ? 'bg-surface-2/40' : ''}`}>
                  {/* The same card the pitch opens, from the market. Reading a
                      player you are thinking of signing and reading one you
                      already own is the same act, and it wanted the same card
                      — the name still goes to his full page. First in the row
                      because it is the only cell you reach for BEFORE you have
                      read anything; everything to its right is what you are
                      reading. */}
                  <button
                    onClick={() => setSheetFor(r)}
                    title={`${String(r.web_name)} — rating, form and fixtures`}
                    aria-label={`About ${String(r.web_name)}`}
                    className="grid size-7 shrink-0 place-items-center rounded-full border border-line-mid text-ink-3 transition-colors hover:border-accent hover:text-accent"
                  >
                    <Icon name="info" size={13} />
                  </button>
                  <TeamBadge team={String(r.team)} size={16} />
                  <div className="min-w-0 flex-1">
                    <button className="block w-full text-left" onClick={() => navigate(playerHref(String(r.web_name), num(r, 'code')))}>
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-ink hover:text-accent">{String(r.web_name)}</span>
                        <DutyBadges d={dutiesOf(avail, num(r, 'element'), num(r, 'code'), streakByEl.get(Number(r.element)), nameOfEl)} />
                        {/* "IN SQUAD" is 52px of chip on the line a name has
                            to fit in, and on a phone that is the difference
                            between Donnarumma and Donnaru…. It keeps the words
                            where there is room and becomes a tick where there
                            is not; the row is also tinted either way. */}
                        {inSquad && (
                          <span
                            title={onMarket ? 'Sold this week — not yet replaced' : 'Already in your squad'}
                            className={`shrink-0 rounded px-1 py-0.5 text-[10px] leading-none font-bold ${onMarket ? 'bg-bad/15 text-bad' : 'bg-surface-3 text-ink-3'}`}
                          >
                            <span className="@[430px]:hidden">{onMarket ? '✕' : '✓'}</span>
                            <span className="hidden @[430px]:inline">{onMarket ? 'SOLD' : 'IN SQUAD'}</span>
                          </span>
                        )}
                        {(() => {
                          const f = availBadge(availFor(avail, num(r, 'element'), num(r, 'code')))
                          // Same three colours as the pitch, so a yellow chip
                          // means the same thing in the list as on the board.
                          return f ? (
                            <span
                              title={f.title}
                              className="shrink-0 rounded px-1 py-0.5 text-[10px] leading-none font-extrabold"
                              style={{ background: SEV_COLOUR[f.sev].chip, color: SEV_COLOUR[f.sev].ink }}
                            >{f.label}</span>
                          ) : null
                        })()}
                      </div>
                      {/* Ownership used to live here, in prose, which meant it
                          could not be compared down the list or sorted on. It
                          is a number and it now has a column. */}
                      <div className="truncate text-[11px] text-ink-3">{teamLabel(String(r.team))}</div>
                    </button>
                  </div>
                  {/* THE NEXT FOUR, ON THE SAME LINE. They used to sit under
                      the name, which made every row two-and-a-bit lines tall
                      and put the run — the thing you are comparing signings on
                      — out of column with the price and the projection you are
                      comparing them against. Container-queried rather than
                      breakpointed: this list is a 400px side column at lg, a
                      680px one at 1400, and a full-width phone panel below
                      that, so what matters is how wide the LIST is, not the
                      window. Below 430 of column there is no room and they
                      drop out; the fixtures are on the player's card and on
                      the Fixtures tab either way. */}
                  <span className="hidden shrink-0 @[430px]:inline-flex @[600px]:hidden">
                    <FixtureRun fixtureEase={fixtureEase} team={String(r.team)} n={3} fromGw={liveGw} />
                  </span>
                  <span className="hidden shrink-0 @[600px]:inline-flex">
                    <FixtureRun fixtureEase={fixtureEase} team={String(r.team)} n={4} fromGw={liveGw} />
                  </span>
                  <span className="font-num w-12 shrink-0 text-right text-[13px] font-bold tabular-nums text-ink">£{priceOf(r).toFixed(1)}m</span>
                  <span className="font-num w-11 shrink-0 text-right text-sm font-extrabold tabular-nums text-accent-2">{xpOf(r)?.toFixed(1) ?? '—'}</span>
                  <span className="font-num w-9 shrink-0 text-right text-sm font-semibold tabular-nums text-ink-2">{o ?? '—'}</span>
                  <span className="font-num w-11 shrink-0 text-right text-sm font-semibold tabular-nums text-ink-2">
                    {Math.round(num(r, 'selected_by_percent') ?? 0)}<span className="text-[11px] text-ink-3">%</span>
                  </span>
                  {/* Once he's on the market the sign-him button is dead, and a
                      greyed-out tick just looks broken. The one thing you can
                      actually do with him is take him back. */}
                  {onMarket ? (
                    <button
                      onClick={() => { planner.undoTransfer(r.element); tapHaptic('light') }}
                      title="Keep him — undo the sale"
                      className="grid size-8 shrink-0 place-items-center rounded-lg border border-good/50 text-good transition-colors hover:bg-good/10"
                    >
                      <Icon name="undo" size={15} />
                    </button>
                  ) : !complete && inSquad ? (
                    /* Already picked, and the fifteen isn't finished. The tick
                       used to stay put and go grey, which reads as broken —
                       the button was the one that put him in, so it should be
                       the one that takes him out. Red arrow pointing back at
                       the market, the same direction the player is going. */
                    <button
                      onClick={() => remove(r.element)}
                      title="Take him out of your squad"
                      className="grid size-8 shrink-0 place-items-center rounded-lg border border-bad/55 text-bad transition-colors hover:bg-bad/10"
                    >
                      <Icon name="arrow-right" size={15} className="rotate-180" />
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        if (!complete) { add(r); return }
                        if (filling) { planner.fill(r.element); tapHaptic('medium'); return }
                        setPendingIn(r)
                      }}
                      disabled={!!why}
                      title={why ?? (filling ? 'Sign him into the empty place' : complete ? 'Transfer in' : 'Add to squad')}
                      className={`grid size-8 shrink-0 place-items-center rounded-lg border transition-colors ${
                        why ? 'cursor-not-allowed border-line text-ink-3 opacity-50' : 'border-accent/50 text-accent hover:bg-accent-soft'
                      }`}
                    >
                      {/* A plus, whether you are filling the fifteen or
                          transferring into it. The arrow said "goes that way"
                          and the tick said "done", and neither is what the
                          button does: it adds a player. */}
                      <Icon name="plus" size={16} />
                    </button>
                  )}
                </div>
              )
            })}
            {list.length === 0 && <div className="px-3 py-8 text-center text-sm text-ink-3">No players match these filters.</div>}
          </div>
          </div>
        </div>
      </div>

      </div>

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
          onPick={(outEl) => { planner.doTransfer(outEl, pendingIn.element); setPendingIn(null); tapHaptic('medium') }}
          onClose={() => setPendingIn(null)}
        />
      )}

      {ratingOpen && (
        <SquadRatingSheet
          chosen={liveChosen} pool={pool} squadScore={liveScore} bestXI={liveBestXI}
          fixtureEase={fixtureEase} gw={liveGw} avail={avail} onClose={() => setRatingOpen(false)}
        />
      )}

      {importOpen && (
        <SquadImport
          pool={pool} fixtureEase={fixtureEase} gw={buildGw}
          onApply={(r: ImportedSquad) => {
            setImportOpen(false); setNote(null); tapHaptic('medium')
            setImportedXI(r.lineup)
            persist(r.squad)
          }}
          onClose={() => setImportOpen(false)}
        />
      )}

      <SquadShare
        chosen={liveChosen} fixtureEase={fixtureEase} squadScore={liveScore} unrated={unrated} total={total} gw={liveGw}
        lineup={planner.week ? { xi: planner.week.xi, bench: planner.week.bench } : null}
        captain={planner.week?.captain ?? null} vice={planner.week?.vice ?? null} chip={planner.week?.chip ?? null}
        open={shareOpen} onClose={() => setShareOpen(false)}
      />
    </PageShell>
  )
}

/** The squad's character, on the page rather than behind a button: the three
 *  most telling lines, with the rest a click away. */
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
function SquadBoard({ chosen, fixtureEase, pickPos, onRemove, onPick, onOpen, capture, metric = 'rating', gw, avail, lineup, captain, vice, tripleCap, benchBoost }: {
  chosen: RatingRow[]; fixtureEase: FixtureEaseRow[]; pickPos?: Pos; onRemove?: (el: number) => void; onPick?: (p: Pos) => void; onOpen?: (r: RatingRow) => void; capture?: boolean
  metric?: Metric; gw?: number; avail?: Availability
  /** The lineup as actually picked — who starts and who sits. Without it the
   *  board re-derives a best XI, which is right while the squad is being
   *  built and wrong once you have made a substitution: the shared picture
   *  showed the computer's eleven rather than yours. */
  lineup?: { xi: number[]; bench: number[] } | null
  captain?: number | null
  vice?: number | null
  tripleCap?: boolean
  benchBoost?: boolean
}) {
  const derived = pickEleven(chosen)
  const byEl = useMemo(() => new Map(chosen.map((r) => [r.element as number, r])), [chosen])
  const pick = (els: number[]) => els.map((e) => byEl.get(e)).filter(Boolean) as RatingRow[]
  const useGiven = !!lineup && lineup.xi.length === 11
  const xi = useGiven ? pick(lineup!.xi) : derived.xi
  /* Keeper first, always. pickEleven orders its own bench that way, but a
     lineup handed in from the planner arrives in whatever order the user's
     substitutions left it — which is how the share image ended up with the
     goalkeeper on the right-hand end of the bench. FPL puts him first and so
     does every reader's expectation. */
  const bench = useGiven
    ? pick(lineup!.bench).sort((a, b) => Number(b.position === 'GKP') - Number(a.position === 'GKP'))
    : derived.bench
  const form = useGiven
    ? { GKP: 1, DEF: xi.filter((r) => r.position === 'DEF').length, MID: xi.filter((r) => r.position === 'MID').length, FWD: xi.filter((r) => r.position === 'FWD').length }
    : derived.form
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
        armband={r.element === captain ? (tripleCap ? '3×' : 'C') : r.element === vice ? 'V' : null}
        fixtures={<FixtureNames fixtureEase={fixtureEase} team={String(r.team)} n={capture ? 1 : 3} fromGw={gw} />}
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
      className={`${CARD_W} grid min-h-[76px] place-items-center rounded-lg border-2 border-dashed text-[10px] font-medium transition-colors sm:min-h-[92px] sm:text-[10px] ${
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

  const benchRow = capture && !bench.length ? null : (
    <>
      {bench.map(card)}
      {!capture && benchNeed.map((pos, i) => slot(pos, `b${pos}${i}`))}
    </>
  )
  return (
    <>
      <Pitch maxWidth={capture ? undefined : 860}>
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
      {/* The same spine the board uses, so a shared boost looks like the one
          you were just looking at rather than a second design for it. */}
      {benchRow && <BenchSpine boosted={benchBoost} maxWidth={capture ? undefined : 860}>{benchRow}</BenchSpine>}
    </>
  )
}

/** Share / download the squad as a branded PNG (rasterised client-side). */
function SquadShare({ chosen, fixtureEase, squadScore, unrated, total, gw, lineup, captain, vice, chip, open, onClose }: {
  chosen: RatingRow[]; fixtureEase: FixtureEaseRow[]; squadScore: number | null; unrated: number; total: number; gw: number
  /** The week as planned — lineup, armbands and chip. All of it comes from the
   *  planner rather than the squad you first built, so a transfer, a
   *  substitution or a chip shows up in the picture. */
  lineup?: { xi: number[]; bench: number[] } | null
  captain?: number | null
  vice?: number | null
  chip?: Chip | null
  open: boolean; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  // Same shapes as every other export. This modal used to offer none: it wrote
  // the card out at whatever aspect the card happened to be, which is a shape
  // no network wants, so a squad was the one thing on the site you could not
  // post without cropping it yourself.
  const [fmt, setFmt] = useState<FormatId>('post')
  /** The finished PNG, shown only when nothing automatic could deliver it. */
  const [shot, setShot] = useState<string | null>(null)
  /** The rendered image, made BEFORE the reader asks for it. See below. */
  const [ready, setReady] = useState<Blob | null>(null)

  /* Render as soon as the sheet opens, and again whenever the shape changes.
     Not an optimisation — the difference between working and not.

     iOS hands `navigator.share()` a *transient* user activation, and this card
     takes several seconds to draw. Rendering on the tap meant the share was
     requested long after the tap that authorised it, so iOS refused: it worked
     when the render happened to be quick and failed the rest of the time,
     which is exactly the one-in-six it was reported as.

     So the work happens while the reader is looking at the preview and
     choosing a size, and the button becomes a share and nothing else. */
  useEffect(() => {
    if (!open || total === 0) return
    let dead = false
    setReady(null); setMsg(''); setShot(null); setBusy(true)
    const t = setTimeout(async () => {
      try {
        if (!ref.current) return
        const spec = SHARE_FORMATS.find((f) => f.id === fmt)!
        const shotCanvas = await rasterise(ref.current, true, spec.w)
        // Framed, not branded. The card already carries the wordmark, the
        // gameweek, the squad rating and the footer, so all it needs is the
        // right shape around it — running it through the panel exporter's
        // chrome would print the brand on it twice.
        const out = document.createElement('canvas')
        const pad = Math.round(spec.w * 0.03)
        out.width = spec.w
        out.height = frameHeight(spec, shotCanvas, pad * 2, pad)
        const ctx = out.getContext('2d')!
        ctx.fillStyle = '#0a0b0e'
        ctx.fillRect(0, 0, out.width, out.height)
        drawFitted(ctx, shotCanvas, { x: pad, y: pad, w: out.width - pad * 2, h: out.height - pad * 2 })
        const blob: Blob | null = await new Promise((res) => out.toBlob(res, 'image/png'))
        if (dead) return
        if (!blob) throw new Error('render failed')
        setReady(blob)
      } catch {
        if (!dead) setMsg('Could not render the image on this device — try a screenshot instead.')
      } finally {
        if (!dead) setBusy(false)
      }
      // One frame of daylight so the sheet paints before the main thread is
      // taken for a second or two.
    }, 120)
    return () => { dead = true; clearTimeout(t) }
  }, [open, fmt, total, gw, chip, captain, vice])

  if (!open) return null

  /** Pure delivery. Nothing slow happens between the tap and the share. */
  const save = async () => {
    if (!ready) return
    setMsg(''); setShot(null)
    try {
      const how = await deliverImage(ready, `fpl-analyser-squad-${fmt}.png`, 'My FPL squad — FPL Analyser')
      // Dismissing the share sheet is a decision, not a fault, and says nothing.
      if (how === 'saved') setMsg('This browser has no share sheet — the image has been saved to your downloads instead.')
      if (how === 'needs-longpress') {
        setShot(URL.createObjectURL(ready))
        setMsg('Press and hold the image to save or share it.')
      }
    } catch {
      setMsg('Could not share the image — press and hold the picture below to save it instead.')
      setShot(URL.createObjectURL(ready))
    }
  }
  const btn = 'inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line-mid px-4 text-sm font-semibold text-ink transition-colors hover:border-line-strong'

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full max-w-[560px]" onClick={(e) => e.stopPropagation()}>
        {/* The share card is always drawn on the same near-black, whatever
            theme the app is in — so it sets its own ink rather than reading
            theme tokens, which the rasteriser resolves unreliably. */}
        <div ref={ref} className="rounded-3xl bg-[#0a0b0e] p-4" style={{ color: '#f4efe3' }}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="font-brand text-lg leading-none font-normal tracking-[0.08em] whitespace-nowrap">FPL <span style={{ color: '#c9a227' }}>Analyser</span></div>
              {/* Gameweek and chip ride beside the wordmark rather than under
                  it — one line of brand, one row of what this picture is. */}
              <span className="rounded-md px-2 py-1 text-[11px] font-extrabold tracking-[0.12em] whitespace-nowrap" style={{ background: 'rgba(201,162,39,.16)', color: '#ead188' }}>GW{gw}</span>
              {chip && (
                <span className="rounded-md px-2 py-1 text-[11px] font-extrabold tracking-[0.08em] whitespace-nowrap" style={{ background: '#c9a227', color: '#14100a' }}>{CHIP_LABEL[chip]}</span>
              )}
            </div>
            <div className="flex gap-4 text-center">
              <div><div className="font-display text-2xl leading-none tabular-nums" style={{ color: '#c9a227' }}>{squadScore ?? '—'}</div><div className="text-[10px] tracking-[0.1em] whitespace-nowrap uppercase" style={{ color: '#8a8172' }}>Squad rating</div></div>
            </div>
          </div>
          <SquadBoard
            chosen={chosen} fixtureEase={fixtureEase} capture gw={gw}
            lineup={lineup} captain={captain} vice={vice} tripleCap={chip === 'triple-captain'} benchBoost={chip === 'bench-boost'}
          />
          {unrated > 0 && <div className="mt-2 text-center text-[10px]" style={{ color: '#8a8172' }}>{unrated} player{unrated > 1 ? 's' : ''} new to the league (unrated)</div>}
          <ShareFooter />
        </div>
        {shot && (
          <div className="mt-3">
            <img src={shot} alt="Your squad, ready to save" className="w-full rounded-xl border border-line-mid" />
          </div>
        )}
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {SHARE_FORMATS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFmt(f.id)}
              className={`min-h-8 rounded-full border px-3 text-[12px] font-semibold transition-colors ${
                fmt === f.id ? 'border-accent bg-accent-selected text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong'
              }`}
            >
              {f.label} <span className="font-normal">{f.hint}</span>
            </button>
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap justify-center gap-2">
          <button onClick={save} disabled={!ready} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-strong disabled:opacity-60">{ready ? '↗ Share image' : busy ? 'Preparing…' : '↗ Share image'}</button>
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
