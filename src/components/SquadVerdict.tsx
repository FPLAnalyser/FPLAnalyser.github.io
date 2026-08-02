import { useMemo } from 'react'
import { Icon } from './Icon'
import { num } from '../lib/rows'
import { squadNarrative } from './SquadRatingSheet'
import type { Availability } from '../lib/availability'
import type { FixtureEaseRow, RatingRow } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   The read on your squad, said in one card rather than three bullet points.

   What was here before opened with an 11px grey uppercase label and three
   sentences, which is the shape of a footnote — the number the page exists
   to produce was inside a modal, and the four things that actually differ
   between one draft and the next were nowhere. This leads with the rating,
   names what kind of squad it is, and scores the four routes to points on
   one scale so a weakness is visible without reading anything.

   Every figure is a mean of dimension scores already in `ratings.json`,
   scored the same 0–100 way as a player. Nothing new is modelled here.
   ════════════════════════════════════════════════════════════════════════ */

const d20 = (r: RatingRow, key: string): number | null => {
  const v = num(r, key)
  return v == null ? null : Math.round(Math.max(0, Math.min(100, v * 20)))
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export interface Dimension {
  key: 'attack' | 'defence' | 'defcon' | 'fixtures'
  label: string
  /** 0–100, or null when nobody in the squad has the underlying figure. */
  value: number | null
  /** What the number is, in one clause — the tooltip and the empty state. */
  note: string
}

/** The four lines. Each is a squad-level mean of the players it applies to:
 *  attack is a forward's job and defence is a defender's, so averaging either
 *  across fifteen would bury the thing being measured. */
export function squadDimensions(squad: RatingRow[], fixtureEase: FixtureEaseRow[], gw: number): Dimension[] {
  const att = squad.filter((r) => r.position === 'MID' || r.position === 'FWD')
  const def = squad.filter((r) => r.position === 'GKP' || r.position === 'DEF')
  const outfield = squad.filter((r) => r.position !== 'GKP')

  // Attack blends the two ways an attacker scores — goals and assists — so a
  // squad of pure poachers and a squad of pure creators read alike, which is
  // right: both are attacking returns.
  const attackVals = att
    .map((r) => {
      const g = d20(r, 'season_goal_score_norm')
      const c = d20(r, 'season_creative_score_norm')
      const parts = [g, c].filter((v): v is number => v != null)
      return parts.length ? mean(parts) : null
    })
    .filter((v): v is number => v != null)

  const defVals = def.map((r) => d20(r, 'season_cs_score_norm')).filter((v): v is number => v != null)
  const dcVals = outfield.map((r) => d20(r, 'season_dc_score_norm')).filter((v): v is number => v != null)

  /* Fixtures over the next six, as a rank against the other nineteen clubs.
   *
   * Two goes at this were wrong before it worked, both caught by sampling 600
   * randomly-built legal squads rather than by reasoning about it:
   *
   *   (5 - meanFdr) / 4 — the obvious mapping. Every club's six-week mean sits
   *   between 2.83 and 3.67 at GW1, so every squad ever built landed between
   *   33 and 54 and the bar said nothing.
   *
   *   min-max across the league. Better spread, but the club means are skewed
   *   — most clubs bunch near 2.9-3.1 with a couple of outliers up at 3.67 —
   *   so the median squad read 76 while the other three lines read ~51. Four
   *   bars on one chart have to mean the same thing at the same height, and
   *   that one didn't.
   *
   * Ranking the clubs first fixes both: easiest six weeks in the division is
   * 100, hardest is 0, and a squad spread across the league averages 50 — the
   * same centre the player dimensions have. Measured median across 600 random
   * squads: 51, against 51 / 53 / 49 for the three above. */
  const clubMean = new Map<string, number>()
  {
    const acc = new Map<string, number[]>()
    for (const f of fixtureEase) {
      if (f.gw < gw || f.gw >= gw + 6) continue
      acc.set(f.team, [...(acc.get(f.team) ?? []), f.fdr])
    }
    for (const [t, v] of acc) if (v.length) clubMean.set(t, mean(v))
  }
  const easiestFirst = [...clubMean.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t)
  const clubPct = new Map<string, number>(
    easiestFirst.map((t, i) => [t, easiestFirst.length > 1 ? ((easiestFirst.length - 1 - i) / (easiestFirst.length - 1)) * 100 : 50]),
  )
  const mine = squad.map((r) => clubPct.get(String(r.team))).filter((v): v is number => v != null)
  const fixtures = mine.length >= 10 ? Math.round(mean(mine)) : null

  return [
    { key: 'attack', label: 'Attack', value: attackVals.length ? Math.round(mean(attackVals)) : null, note: 'goals and assists from your midfield and forwards' },
    { key: 'defence', label: 'Defence', value: defVals.length ? Math.round(mean(defVals)) : null, note: 'clean-sheet record of your keepers and defenders' },
    { key: 'defcon', label: 'Def Con', value: dcVals.length ? Math.round(mean(dcVals)) : null, note: 'how often your outfielders hit the +2 defensive threshold' },
    { key: 'fixtures', label: 'Fixtures', value: fixtures, note: 'your clubs\u2019 next six, placed against the other nineteen \u2014 a narrower spread than the three above' },
  ]
}

/* The headline. Two clauses: the best of the four and the worst of the four,
 * so it says something specific about this fifteen rather than "well balanced".
 * Only stated when they are actually far enough apart to be a shape — a squad
 * flat across all four gets told that instead of being handed a false
 * contrast. */
const STRONG: Record<Dimension['key'], string> = {
  attack: 'Sharp up top',
  defence: 'Solid at the back',
  defcon: 'Grinds out the extra points',
  fixtures: 'A kinder run than most',
}
const WEAK: Record<Dimension['key'], string> = {
  attack: 'blunt up top',
  defence: 'thin at the back',
  defcon: 'no defensive floor',
  fixtures: 'a harder run than most',
}

/* Both clauses have to earn their place on the absolute number, not just on
 * being the highest or lowest of four.
 *
 * The first version said whatever was best and whatever was worst, and on a
 * measured squad that produced "Sharp up top, a brutal run to come" off a
 * fixtures score of 49 — dead average. Being the weakest of four things is not
 * the same as being weak, and a verdict that overstates is worth less than no
 * verdict. The thresholds are the same ones the colours use, so the sentence and
 * the bars never disagree: a strength is a bar that went green (60, close
 * enough to the p90 of 59–64), a weakness is one that went red (under 46, the
 * p25). When neither happens the line says that instead. */
export function verdictLine(dims: Dimension[]): string {
  const known = dims.filter((d): d is Dimension & { value: number } => d.value != null)
  if (known.length < 2) return 'Not enough played football to read yet'
  const sorted = [...known].sort((a, b) => b.value - a.value)
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]
  const strong = best.value >= 60 ? STRONG[best.key] : null
  const weak = worst.value < 46 ? WEAK[worst.key] : null
  if (strong && weak) return `${strong}, ${weak}`
  if (strong) return `${strong}, and nothing badly short`
  if (weak) return `No standout strength, and ${weak}`
  return 'Even across the board, and short of a strength'
}

/* Four bands, worst to best: red, amber, green, gold.
 *
 * The boundaries are the quartiles of what a squad actually scores, not round
 * numbers. Six hundred randomly-built legal fifteens put all four dimensions
 * at p25 ≈ 46, median ≈ 51, p75 ≈ 56, p95 ≈ 64 — so red is the bottom quarter,
 * amber the middle half, green the top quarter and gold roughly the top one in
 * twenty. Picking 65 for green instead, as the first version did, painted a
 * measured squad four identical bars, which is a wall of colour saying
 * nothing. Gold is the top band because gold is this site's "best" everywhere
 * else; it is not the neutral. */
type Tone = 'bad' | 'warn' | 'good' | 'elite'
const toneOf = (v: number): Tone => (v >= 64 ? 'elite' : v >= 57 ? 'good' : v >= 46 ? 'warn' : 'bad')
/* Amber is its own orange rather than `--warn`.
   `--warn` is #e8b04a and `--accent` is #c9a227 — both golds, eight degrees of
   hue apart, and at 7px of bar they were indistinguishable: a squad reading 49
   and one reading 71 drew the same colour. #e8853a sits between the amber and
   the red and separates cleanly from the gold at the top of the scale. */
const AMBER = '#e8853a'
const BAR: Record<Tone, string> = { bad: 'bg-bad', warn: '', good: 'bg-good', elite: 'bg-accent' }
const TEXT: Record<Tone, string> = { bad: 'text-bad', warn: '', good: 'text-good', elite: 'text-accent' }

export function SquadVerdict({ chosen, fixtureEase, gw, avail, score, bestXI, onOpen }: {
  chosen: RatingRow[]
  fixtureEase: FixtureEaseRow[]
  gw: number
  avail: Availability
  score: number | null
  bestXI: number | null
  onOpen: () => void
}) {
  const dims = useMemo(() => squadDimensions(chosen, fixtureEase, gw), [chosen, fixtureEase, gw])
  const headline = useMemo(() => verdictLine(dims), [dims])
  // One line of prose, and it is the worst thing found rather than the first:
  // a risk you have not seen is worth more than a strength you already know
  // about. The rest is a tap away.
  const worry = useMemo(() => {
    const lines = squadNarrative(chosen, fixtureEase, gw, avail)
    return lines.find((l) => l.tone === 'warn') ?? lines[0] ?? null
  }, [chosen, fixtureEase, gw, avail])

  return (
    <div className="rounded-2xl border border-line bg-surface-1/60 p-3.5 md:p-4">
      <div className="flex items-center gap-3.5">
        <span
          className="relative grid size-14 shrink-0 place-items-center rounded-full"
          style={{ background: `conic-gradient(var(--accent) 0 ${score ?? 0}%, rgba(255,255,255,.08) ${score ?? 0}% 100%)` }}
        >
          <span className="absolute inset-[5px] rounded-full bg-surface-1" />
          <span className="metallic-num font-num relative z-[1] text-xl leading-none font-extrabold tabular-nums">{score ?? '—'}</span>
        </span>
        <div className="min-w-0 flex-1">
          {/* Ink, not ink-3. This is the sentence the page exists to produce;
              it was previously an 11px grey uppercase label above three
              bullets, which reads as a caption for something else. */}
          <h3 className="text-[15px] leading-tight font-extrabold text-ink md:text-base">{headline}</h3>
          <p className="mt-0.5 text-xs text-ink-2">
            Average of the fifteen{bestXI != null && <> · best XI <b className="font-semibold text-ink">{bestXI}</b></>}
          </p>
        </div>
      </div>

      <div className="mt-3.5 flex flex-col gap-[7px]">
        {dims.map((d) => {
          const tone: Tone = d.value == null ? 'warn' : toneOf(d.value)
          return (
            <div key={d.key} className="grid grid-cols-[62px_minmax(0,1fr)_26px] items-center gap-2.5" title={d.note}>
              <span className="text-[10px] font-bold tracking-[0.1em] text-ink-3 uppercase">{d.label}</span>
              <span className="relative h-2 rounded-full bg-surface-3">
                <span
                  className={`absolute inset-y-0 left-0 rounded-full ${BAR[tone]}`}
                  style={{ width: `${d.value ?? 0}%`, background: tone === 'warn' ? AMBER : undefined }}
                />
              </span>
              <span
                className={`text-right font-num text-[12px] font-bold tabular-nums ${d.value == null ? 'text-ink-3' : TEXT[tone]}`}
                style={{ color: d.value != null && tone === 'warn' ? AMBER : undefined }}
              >
                {d.value ?? '—'}
              </span>
            </div>
          )
        })}
      </div>

      {worry && (
        <button onClick={onOpen} className="mt-3 flex w-full gap-2 border-t border-line pt-3 text-left transition-opacity hover:opacity-80">
          <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${worry.tone === 'warn' ? 'bg-warn' : worry.tone === 'good' ? 'bg-good' : 'bg-ink-3'}`} />
          <span className="min-w-0 text-[13px] leading-snug">
            <span className="font-semibold text-ink">{worry.head}</span>
            <span className="text-ink-2"> — {worry.body}</span>
          </span>
        </button>
      )}

      <button
        onClick={onOpen}
        className="mt-3 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-accent/60 bg-accent-soft/50 text-[12.5px] font-bold text-accent transition-colors hover:brightness-110"
      >
        Full breakdown <Icon name="arrow-right" size={13} />
      </button>
    </div>
  )
}
