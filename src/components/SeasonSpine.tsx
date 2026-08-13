import { useMemo, useState } from 'react'
import { str } from '../lib/rows'
import { TeamBadge } from './badges'
import {
  buildSlots, orderSlots, handovers, memberAt, spineCell, weekRisk, formatCell, toneOf,
  MODE_LABEL, MODE_NOTE, type SpineMode, type Slot, type Tone,
} from '../lib/spine'
import type { Availability } from '../lib/availability'
import type { XpModel, MarketOdds, ShotProfiles } from '../lib/xp'
import type { PlannerState } from '../lib/planner'
import type { FixtureEaseRow, RatingRow } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   The season spine.

   The gameweek bars and the plan grid are ONE object, which is the whole
   idea: the bars are the grid's top row, so expanding does not swap views —
   it reveals the rows that were always underneath, on columns that never
   move. A week you tap on the bars is the week the squad below is showing,
   and it is the same column you then read down.

   Two things carry the transfer grammar, and both were argued down to this
   from something louder. A handover straddles the seam: the leaver's last
   cell takes a red RIGHT edge, the arrival a green LEFT one, so the two meet
   at the boundary and the move reads as one gesture, out then in. And every
   cell is dark glass with the difficulty in its TEXT rather than its fill,
   because a grid of filled colour chips left the green edge nothing to stand
   out against — the marker that matters most was the one that drowned.
   ════════════════════════════════════════════════════════════════════════ */

const MODES: SpineMode[] = ['fix', 'xp', 'cs', 'gi', 'dc']

/** Tallest bar, in pixels. At 46 the chart was a rumour — a 20% difference
 *  between two weeks was nine pixels, which is not a difference anyone can
 *  see. The column is the primary instrument on the page and is sized like
 *  one. */
const BAR_H = 104

/** Chips as managers name them. Slicing the first two letters off the id gave
 *  "wi" for a wildcard, which is not a thing anyone calls it. */
const CHIP_SHORT: Record<string, string> = {
  wildcard: 'WC', 'bench-boost': 'BB', 'triple-captain': 'TC', 'free-hit': 'FH',
}

/** Difficulty as ink. d3 is lifted off the mid-grey it shares with the
 *  chrome, or a run of average fixtures reads as a run of empty cells. */
const FDR_INK: Record<number, string> = {
  1: 'text-[#2fbf6e]', 2: 'text-[#7fd39b]', 3: 'text-[#9aa6b5]',
  4: 'text-[#e8907f]', 5: 'text-[#e05b52]',
}

/** Value as ink. Red is a week to worry about, gold a week to build around,
 *  and the bands behind it live in spine.ts so every view agrees what "good"
 *  means. Deliberately the same red-to-green direction the difficulty ramp
 *  uses: both are answering "is this a good week", so they should not read
 *  in opposite directions. */
const TONE_INK: Record<Tone, string> = {
  none: 'text-ink-3/60',
  bad: 'text-[#e05b52]',
  weak: 'text-[#e8a15b]',
  ok: 'text-ink-2',
  good: 'text-[#7fd39b]',
  elite: 'text-[#fff3c4] [text-shadow:0_0_7px_rgba(234,209,136,.6)]',
}

export function SeasonSpine({
  state, byEl, fixtureEase, gws, gw, onPickGw, weekXp, bestCaptain,
  xiByGw, captainByGw, chipByGw, movesByGw, onShift, canShift, avail, model, market, profiles,
}: {
  state: PlannerState
  byEl: Map<number, RatingRow>
  fixtureEase: FixtureEaseRow[]
  /** The weeks the spine draws, ascending. */
  gws: number[]
  gw: number
  onPickGw: (gw: number) => void
  /** Projected points for the squad each week — the bar heights. */
  weekXp: Map<number, number>
  /** Whose armband is the best in the game that week, if anyone's. */
  bestCaptain?: Map<number, { element: number; xp: number }>
  /** The plan's own decisions, week by week: who starts, who wears the
   *  armband, which chip is played and how many moves were made. Without
   *  these the grid shows a squad but not a PLAN. */
  xiByGw?: Map<number, number[]>
  captainByGw?: Map<number, number | null>
  chipByGw?: Map<number, string | null>
  movesByGw?: Map<number, number>
  /** Scroll the window a few weeks without changing the selected gameweek. */
  onShift?: (dir: 'back' | 'fwd') => void
  canShift?: { back: boolean; fwd: boolean }
  avail?: Availability
  model: XpModel | null
  market: MarketOdds | null
  profiles: ShotProfiles | null
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<SpineMode>('fix')
  const [names, setNames] = useState(true)
  /* Fifteen rows of twelve numbers is a lot to read a single man out of, so
     tapping a row pins him and drops everything else back. Tap again to
     release. Held as the SLOT index, not the player: a slot that changes
     hands is still the row you were reading. */
  const [focus, setFocus] = useState<number | null>(null)

  // Ordered FIRST, then handovers, because a handover is keyed on the slot's
  // index — read them off the unordered array and every seam lands on the
  // wrong row.
  const slots = useMemo(() => orderSlots(buildSlots(state), byEl), [state, byEl])
  const moves = useMemo(() => handovers(slots), [slots])

  const top = Math.max(...gws.map((g) => weekXp.get(g) ?? 0), 1)
  const risk = useMemo(
    () => new Map(gws.map((g) => [g, weekRisk(slots.map((s) => memberAt(s, g)), g, byEl, fixtureEase)])),
    [gws, slots, byEl, fixtureEase],
  )

  // Does the squad hold the game's best captain? A badge on the week, not a
  // recommendation — an absent C is itself information: a thin armband week.
  const holdsBest = useMemo(() => {
    const out = new Set<number>()
    if (!bestCaptain) return out
    for (const g of gws) {
      const best = bestCaptain.get(g)
      if (!best) continue
      if (slots.some((s) => memberAt(s, g) === best.element)) out.add(g)
    }
    return out
  }, [bestCaptain, gws, slots])

  const cols = `minmax(0,9.5rem) repeat(${gws.length}, minmax(4.4rem, 1fr))`

  return (
    <section className="mb-3 overflow-hidden rounded-2xl border border-line bg-bg-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line px-3 py-2">
        <h2 className="text-[12.5px] font-extrabold tracking-tight text-ink">Your season</h2>
        {/* Walking the window without moving the selected week. Tapping a bar
            changes which week the board shows; these only change which twelve
            weeks you are looking at, which is a different question and needs
            its own control. */}
        {onShift && (
          <span className="flex items-center gap-0.5">
            <Step dir="back" disabled={!canShift?.back} onClick={() => onShift('back')} />
            <span className="min-w-[3.4rem] text-center text-[11px] font-bold text-ink-3 tabular-nums">
              GW{gws[0]}&ndash;{gws[gws.length - 1]}
            </span>
            <Step dir="fwd" disabled={!canShift?.fwd} onClick={() => onShift('fwd')} />
          </span>
        )}
        <span className="truncate text-[11.5px] text-ink-3">
          {open ? 'every man, every week' : 'projected, week by week'}
        </span>
        {open && (
          <span className="ml-auto flex gap-0.5 rounded-full border border-line bg-surface-2 p-0.5">
            {MODES.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-pressed={m === mode}
                className={`rounded-full px-2.5 py-1 text-[10.5px] ${
                  m === mode ? 'bg-accent font-extrabold text-accent-contrast' : 'text-ink-3'
                }`}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
            <button
              onClick={() => setNames((v) => !v)}
              aria-pressed={names}
              className={`ml-0.5 rounded-r-full border-l border-line px-2.5 py-1 text-[10.5px] ${
                names ? 'text-good' : 'text-ink-3'
              }`}
            >
              Names
            </button>
          </span>
        )}
      </div>

      <div className="overflow-x-auto pt-2 pb-1.5">
        <div className="grid min-w-max gap-[3px] pr-3" style={{ gridTemplateColumns: cols }}>
          <span className="sticky left-0 z-[3] flex items-center bg-bg-0 pr-2 pl-3 text-[9px] font-extrabold tracking-[0.11em] text-ink-3 uppercase">
            Points
          </span>
          {gws.map((g) => {
            const xp = weekXp.get(g) ?? 0
            const rk = risk.get(g)
            const on = g === gw
            return (
              <button
                key={g}
                onClick={() => onPickGw(g)}
                aria-pressed={on}
                className={`relative flex min-h-11 flex-col justify-end gap-[3px] rounded-md px-0.5 pt-5 pb-0.5 transition ${
                  on ? 'bg-accent/15 ring-1 ring-accent/45 ring-inset' : 'hover:bg-white/5'
                }`}
              >
                {/* What HAPPENS that week, above the number: the moves made
                    and the chip played. The bars showed a projection with no
                    hint of the plan that produced it. */}
                {(chipByGw?.get(g) || (movesByGw?.get(g) ?? 0) > 0) && (
                  <span className="absolute top-0.5 left-1/2 flex -translate-x-1/2 gap-1 whitespace-nowrap">
                    {(movesByGw?.get(g) ?? 0) > 0 && (
                      <i className="rounded border border-good/45 bg-good/15 px-1 text-[8.5px] font-extrabold text-good not-italic">
                        {movesByGw?.get(g)} in
                      </i>
                    )}
                    {chipByGw?.get(g) && (
                      <i className="rounded border border-accent/55 bg-accent/20 px-1 text-[8.5px] font-extrabold text-accent-2 not-italic">
                        {CHIP_SHORT[String(chipByGw.get(g))] ?? '?'}
                      </i>
                    )}
                  </span>
                )}
                <span className={`text-center text-[12.5px] font-extrabold tabular-nums ${on ? 'text-accent-2' : 'text-ink-2'}`}>
                  {xp.toFixed(1)}
                </span>
                <span
                  className={`rounded-t-[3px] border border-b-0 ${
                    on ? 'border-transparent bg-accent' : 'border-accent/40 bg-accent/25'
                  }`}
                  style={{ height: `${Math.max(6, (xp / top) * BAR_H)}px` }}
                />
                {/* Diverging: easy grows from the left, hard from the right,
                    and they can meet but never cross — fifteen is fifteen. */}
                {rk && rk.total > 0 && (
                  <span className="flex h-[5px] justify-between rounded-sm bg-surface-3">
                    <i className="block h-full rounded-sm bg-good" style={{ width: `${(rk.easy / rk.total) * 100}%` }} />
                    <i className="block h-full rounded-sm bg-bad/80" style={{ width: `${(rk.hard / rk.total) * 100}%` }} />
                  </span>
                )}
                <span className={`pb-px text-center text-[11px] font-semibold ${on ? 'font-extrabold text-accent' : 'text-ink-3'}`}>
                  GW{g}
                  {holdsBest.has(g) && (
                    <i
                      title="Your squad holds the best captain in the game this week"
                      className="ml-0.5 inline-block rounded-full bg-accent px-[3px] align-[1px] text-[7.5px] font-extrabold text-accent-contrast not-italic"
                    >
                      C
                    </i>
                  )}
                </span>
              </button>
            )
          })}
        </div>

        {open && (
          <div className="mt-2 grid min-w-max gap-[3px] pr-3" style={{ gridTemplateColumns: cols }}>
            {slots.map((slot, i) => (
              <SlotRow
                key={i}
                slot={slot}
                index={i}
                gws={gws}
                gw={gw}
                mode={mode}
                names={names}
                moves={moves}
                focus={focus}
                onFocus={(n) => setFocus((cur) => (cur === n ? null : n))}
                xiByGw={xiByGw}
                captainByGw={captainByGw}
                byEl={byEl}
                fixtureEase={fixtureEase}
                avail={avail}
                model={model}
                market={market}
                profiles={profiles}
              />
            ))}
          </div>
        )}
      </div>

      {/* A key, because none of this is self-evident. The diverging bar and
          the armband badge were both shipped with nothing on the page saying
          what they meant, which makes them decoration rather than data. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <i className="h-[5px] w-4 rounded-sm bg-good" />easy fixtures that week
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-[5px] w-4 rounded-sm bg-bad/80" />hard ones, and blanks
        </span>
        <span className="flex items-center gap-1.5">
          <i className="rounded-full bg-accent px-[3px] text-[7.5px] font-extrabold text-accent-contrast not-italic">C</i>
          you own the best captain in the game
        </span>
        {open && (
          <>
            <span>ABC home · abc away</span>
            <span>difficulty is the text colour</span>
            <span className="text-good">▸ green edge in</span>
            <span className="text-bad">red edge out</span>
            <span className="text-ink-2">{MODE_LABEL[mode]} — {MODE_NOTE[mode]}</span>
            <span>tap a name to read one man on his own</span>
            <span>dimmed = benched that week</span>
            <span className="flex items-center gap-1">
              <i className="rounded-full bg-accent px-[3px] text-[7px] font-extrabold text-accent-contrast not-italic">C</i>
              your captain
            </span>
          </>
        )}
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-center gap-2.5 border-t border-line text-[12.5px] font-semibold text-ink-2 transition hover:bg-white/5 hover:text-ink"
      >
        <span className="h-[3px] w-7 rounded-sm bg-line-strong" />
        {open ? 'Close the plan' : 'Pull down for the whole plan'}
        <span className="h-[3px] w-7 rounded-sm bg-line-strong" />
      </button>
    </section>
  )
}

function Step({ dir, disabled, onClick }: { dir: 'back' | 'fwd'; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === 'back' ? 'Earlier gameweeks' : 'Later gameweeks'}
      className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-ink-2 transition hover:border-accent/60 hover:text-ink disabled:opacity-30 disabled:hover:border-line disabled:hover:text-ink-2"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d={dir === 'back' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
      </svg>
    </button>
  )
}

/* ── one slot, across the window ─────────────────────────────────────── */

function SlotRow({
  slot, index, gws, gw, mode, names, moves, focus, onFocus, xiByGw, captainByGw,
  byEl, fixtureEase, avail, model, market, profiles,
}: {
  slot: Slot
  index: number
  gws: number[]
  gw: number
  mode: SpineMode
  names: boolean
  moves: ReturnType<typeof handovers>
  focus: number | null
  onFocus: (i: number) => void
  xiByGw?: Map<number, number[]>
  captainByGw?: Map<number, number | null>
  byEl: Map<number, RatingRow>
  fixtureEase: FixtureEaseRow[]
  avail?: Availability
  model: XpModel | null
  market: MarketOdds | null
  profiles: ShotProfiles | null
}) {
  const nameOf = (el: number | null) => (el == null ? '—' : str(byEl.get(el) ?? {}, 'web_name') || '—')
  const focused = focus === index
  // Nothing pinned: every row reads normally. Something pinned: this row is
  // either the subject or the background.
  const muted = focus != null && !focused
  const here = moves.filter((m) => m.slot === index && gws.includes(m.gw))
  /* The name column follows the SELECTED week. A slot that changes hands is
     mostly its second owner by the end of the window, so labelling the row
     with whoever held it in August left a grid of Senesi cells under the name
     Burns — the stub has to say who this row is now. */
  const holder = memberAt(slot, gw)
  const first = holder != null ? byEl.get(holder) : undefined

  return (
    <>
      {/* The name band, ABOVE the row it labels: the leaver in red over his
          last fixture, the arrival in green over his first, meeting at the
          seam exactly as the cell edges do. Below the row it was ambiguous —
          two rows either side and nothing saying which one changed. Any chain
          is just more pairs on one band, so a wildcard costs one thin row per
          slot instead of a row per player. */}
      {names && here.length > 0 && (
        <span className="relative col-start-2 -col-end-1 h-[12px]">
          {here.map((m) => {
            const at = gws.indexOf(m.gw)
            return (
              <span key={m.gw}>
                {at > 0 && (
                  <span
                    className="absolute top-0 text-[9.5px] font-bold whitespace-nowrap text-bad"
                    style={{ right: `${((gws.length - at) / gws.length) * 100}%` }}
                  >
                    {nameOf(m.out)} ◂
                  </span>
                )}
                <span
                  className="absolute top-0 text-[9.5px] font-bold whitespace-nowrap text-good"
                  style={{ left: `${(at / gws.length) * 100}%` }}
                >
                  ▸ {nameOf(m.in)}
                </span>
              </span>
            )
          })}
        </span>
      )}
      <button
        onClick={() => onFocus(index)}
        aria-pressed={focused}
        title={focused ? 'Show the rest of the squad again' : 'Show only this player'}
        className={`sticky left-0 z-[3] flex min-w-0 items-center gap-1.5 rounded-l-md bg-bg-0 py-px pr-2 pl-3 text-left text-[12.5px] whitespace-nowrap transition ${
          focused ? 'text-accent-2' : 'text-ink-2 hover:text-ink'
        }`}
      >
        <span className={`rounded-sm border px-[3px] py-px text-[9.5px] font-extrabold tracking-[0.07em] ${
          focused ? 'border-accent/60 text-accent' : 'border-line text-ink-3'
        }`}>
          {first ? String(first.position) : '—'}
        </span>
        <span className="min-w-0 overflow-hidden text-ellipsis">{nameOf(holder)}</span>
      </button>
      {gws.map((g) => {
        const el = memberAt(slot, g)
        const r = el != null ? byEl.get(el) : undefined
        const cell = spineCell(r, g, mode, fixtureEase, avail, model, market, profiles)
        const arriving = here.some((m) => m.gw === g)
        const leaving = here.some((m) => m.gw === g + 1)
        // Who is actually playing that week, and who is wearing the armband.
        const xi = xiByGw?.get(g)
        /* Benched weeks fade — except on the row you have pinned. You pinned
           him to read him, and the weeks he is on the bench are exactly the
           ones you are checking. */
        const benched = !focused && el != null && xi != null && xi.length > 0 && !xi.includes(el)
        const isCap = el != null && captainByGw?.get(g) === el
        const tone = toneOf(mode, cell.value, r ? String(r.position) : undefined)
        /* Only one crest, and only where there is a number rather than a
           fixture: a double gameweek would want two and there is not room, so
           it keeps the first and the tooltip still names both. */
        const crest = mode !== 'fix' && !cell.blank && !cell.na && cell.value != null
          ? cell.opponents[0] ?? null
          : null
        const text = cell.na ? 'NA'
          : mode === 'fix' ? (cell.fixture || '—')
          : formatCell(mode, cell.value)
        const ink = cell.na ? 'text-ink-3/70'
          : mode === 'fix' ? (FDR_INK[cell.fdr] ?? 'text-ink-2')
          : tone ? TONE_INK[tone] : 'text-ink-2'
        /* The gold-alpha ring is on every cell; the seam and out edges are
           inset shadows stacked over it, so a one-week stint can carry both
           without either edge losing its side. */
        const ring = 'inset 0 0 0 1px rgba(201,162,39,.28)'
        const shadow = [
          arriving ? 'inset 2.5px 0 0 var(--good)' : '',
          leaving ? 'inset -2.5px 0 0 var(--bad)' : '',
          ring,
        ].filter(Boolean).join(', ')
        return (
          <span
            key={g}
            title={r ? `${str(r, 'web_name')} · GW${g}${benched ? ' · benched' : ''}${isCap ? ' · captain' : ''}` : undefined}
            className={`relative flex h-[32px] items-center justify-center rounded-[5px] bg-[#0b0c0f] text-center text-[13px] font-extrabold tracking-[0.02em] transition-opacity ${ink} ${
              g === gw ? 'outline outline-[1.5px] -outline-offset-1 outline-white/60' : ''
            } ${cell.blank ? 'opacity-40' : ''} ${benched ? 'opacity-35' : ''} ${muted ? 'opacity-25' : ''}`}
            style={{ boxShadow: shadow }}
          >
            {/* WHO he is playing, in the views that dropped the opponent to
                make room for a number. Switching to xP used to lose the one
                thing that explains the number — 6.9 against whom? — and a
                crest costs a glyph's width where the name cost the cell. */}
            {crest && (
              <TeamBadge team={crest} size={19} className="mr-[5px] shrink-0 opacity-95" />
            )}
            {text}
            {/* The armband, on the man wearing it. A plan that cannot say who
                you are captaining is not showing you the plan. */}
            {isCap && (
              <i className="absolute -top-px -right-0.5 rounded-full bg-accent px-[2.5px] text-[7px] leading-[1.4] font-extrabold text-accent-contrast not-italic shadow-[0_0_0_1.5px_#0b0c0f]">
                C
              </i>
            )}
          </span>
        )
      })}
    </>
  )
}
