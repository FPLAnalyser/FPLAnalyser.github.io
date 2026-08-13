import { useMemo, useState } from 'react'
import { str } from '../lib/rows'
import {
  buildSlots, handovers, memberAt, spineCell, heatTop, weekRisk,
  MODE_LABEL, type SpineMode, type Slot,
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

/** Difficulty as ink. d3 is lifted off the mid-grey it shares with the
 *  chrome, or a run of average fixtures reads as a run of empty cells. */
const FDR_INK: Record<number, string> = {
  1: 'text-[#2fbf6e]', 2: 'text-[#7fd39b]', 3: 'text-[#9aa6b5]',
  4: 'text-[#e8907f]', 5: 'text-[#e05b52]',
}

/** Value as ink, five steps of the accent — never the difficulty ramp.
 *  Points and difficulty are different questions and must not share a
 *  colour language. */
const HEAT_INK = [
  'text-ink-3', 'text-ink-2', 'text-accent', 'text-accent-2',
  'text-[#fff3c4] [text-shadow:0_0_7px_rgba(234,209,136,.6)]',
]

export function SeasonSpine({
  state, byEl, fixtureEase, gws, gw, onPickGw, weekXp, bestCaptain, avail, model, market, profiles,
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
  avail?: Availability
  model: XpModel | null
  market: MarketOdds | null
  profiles: ShotProfiles | null
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<SpineMode>('fix')
  const [names, setNames] = useState(true)

  const slots = useMemo(() => buildSlots(state), [state])
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

  const cols = `minmax(0,7rem) repeat(${gws.length}, minmax(2.6rem, 1fr))`

  return (
    <section className="mb-3 overflow-hidden rounded-2xl border border-line bg-bg-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line px-3 py-2">
        <h2 className="text-[12.5px] font-extrabold tracking-tight text-ink">Your season</h2>
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
                className={`relative flex min-h-11 flex-col justify-end gap-[3px] rounded-md px-0.5 pt-4 pb-0.5 transition ${
                  on ? 'bg-accent/15 ring-1 ring-accent/45 ring-inset' : 'hover:bg-white/5'
                }`}
              >
                <span className={`text-center text-[11px] font-extrabold ${on ? 'text-accent-2' : 'text-ink-2'}`}>
                  {xp.toFixed(1)}
                </span>
                <span
                  className={`rounded-t-[3px] border border-b-0 ${
                    on ? 'border-transparent bg-accent' : 'border-accent/40 bg-accent/25'
                  }`}
                  style={{ height: `${Math.max(4, (xp / top) * 46)}px` }}
                />
                {/* Diverging: easy grows from the left, hard from the right,
                    and they can meet but never cross — fifteen is fifteen. */}
                {rk && rk.total > 0 && (
                  <span className="flex h-[3px] justify-between rounded-sm bg-surface-3">
                    <i className="block h-full rounded-sm bg-good" style={{ width: `${(rk.easy / rk.total) * 100}%` }} />
                    <i className="block h-full rounded-sm bg-bad/80" style={{ width: `${(rk.hard / rk.total) * 100}%` }} />
                  </span>
                )}
                <span className={`pb-px text-center text-[10px] font-semibold ${on ? 'font-extrabold text-accent' : 'text-ink-3'}`}>
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

      <p className="flex flex-wrap items-center gap-x-1.5 px-3 pb-2 text-[11px] text-ink-3">
        <span>ABC home · abc away</span>
        {open && <span>· difficulty is the text colour</span>}
        {open && <span className="text-good">· ▸ green edge in</span>}
        {open && <span className="text-bad">· red edge out</span>}
      </p>

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

/* ── one slot, across the window ─────────────────────────────────────── */

function SlotRow({
  slot, index, gws, gw, mode, names, moves, byEl, fixtureEase, avail, model, market, profiles,
}: {
  slot: Slot
  index: number
  gws: number[]
  gw: number
  mode: SpineMode
  names: boolean
  moves: ReturnType<typeof handovers>
  byEl: Map<number, RatingRow>
  fixtureEase: FixtureEaseRow[]
  avail?: Availability
  model: XpModel | null
  market: MarketOdds | null
  profiles: ShotProfiles | null
}) {
  const nameOf = (el: number | null) => (el == null ? '—' : str(byEl.get(el) ?? {}, 'web_name') || '—')
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
        <span className="relative col-start-2 -col-end-1 h-[11px]">
          {here.map((m) => {
            const at = gws.indexOf(m.gw)
            return (
              <span key={m.gw}>
                {at > 0 && (
                  <span
                    className="absolute top-0 text-[8.5px] font-bold whitespace-nowrap text-bad"
                    style={{ right: `${((gws.length - at) / gws.length) * 100}%` }}
                  >
                    {nameOf(m.out)} ◂
                  </span>
                )}
                <span
                  className="absolute top-0 text-[8.5px] font-bold whitespace-nowrap text-good"
                  style={{ left: `${(at / gws.length) * 100}%` }}
                >
                  ▸ {nameOf(m.in)}
                </span>
              </span>
            )
          })}
        </span>
      )}
      <span className="sticky left-0 z-[3] flex min-w-0 items-center gap-1.5 bg-bg-0 pr-2 pl-3 text-[11px] whitespace-nowrap text-ink-2">
        <span className="rounded-sm border border-line px-[3px] py-px text-[8.5px] font-extrabold tracking-[0.07em] text-ink-3">
          {first ? String(first.position) : '—'}
        </span>
        <span className="min-w-0 overflow-hidden text-ellipsis">{nameOf(holder)}</span>
      </span>
      {gws.map((g) => {
        const el = memberAt(slot, g)
        const r = el != null ? byEl.get(el) : undefined
        const cell = spineCell(r, g, mode, fixtureEase, avail, model, market, profiles)
        const arriving = here.some((m) => m.gw === g)
        const leaving = here.some((m) => m.gw === g + 1)
        const text = mode === 'fix' || cell.value == null
          ? cell.fixture || '—'
          : cell.value.toFixed(1)
        const ink = mode === 'fix'
          ? FDR_INK[cell.fdr] ?? 'text-ink-2'
          : HEAT_INK[Math.min(4, Math.floor((cell.value ?? 0) / (heatTop(mode) / 4)))]
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
            title={r ? `${str(r, 'web_name')} · GW${g}` : undefined}
            className={`flex h-[17px] items-center justify-center rounded-[3px] bg-[#0b0c0f] text-center text-[8.5px] font-extrabold tracking-[0.02em] ${ink} ${
              g === gw ? 'outline outline-[1.5px] -outline-offset-1 outline-white/60' : ''
            } ${cell.blank ? 'opacity-40' : ''}`}
            style={{ boxShadow: shadow }}
          >
            {text}
          </span>
        )
      })}
    </>
  )
}
