import { useMemo } from 'react'
import { Icon } from './Icon'
import { TeamBadge } from './badges'
import { Panel } from './SquadShape'
import { analyserDiff, bandOf, type DiffScale } from '../lib/fixtureRuns'
import { num, str } from '../lib/rows'
import { useLazyTable } from '../lib/useData'
import {
  buildSeries, chipWindows, effectiveOwnership, transferUpside,
  type Engine, type PlayerSeries,
} from '../lib/squadInsights'
import type { RatingRow, FixtureEaseRow } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   THE THINGS YOU ACTUALLY DO.

   Captain, chip, transfer, and the two market reads that decide when. Every
   panel here ends in a choice, which is why each one carries the number the
   choice turns on rather than a general picture of the squad.
   ════════════════════════════════════════════════════════════════════════ */

const pct = (v: number) => `${Math.round(v * 100)}%`

// ── the armband, week by week ───────────────────────────────────────────────

export function CaptaincyLadder({ squad, xiElements, gws }: {
  squad: PlayerSeries[]
  xiElements: Set<number>
  gws: number[]
}) {
  const weeks = useMemo(() => gws.map((gw, i) => {
    const ranked = squad
      .filter((p) => xiElements.has(p.element) && p.weeks[i]?.parts)
      .map((p) => ({ p, xp: p.weeks[i].xp }))
      .sort((a, b) => b.xp - a.xp)
    return { gw, ranked }
  }), [squad, xiElements, gws])

  const live = weeks.filter((w) => w.ranked.length >= 2)
  if (!live.length) return null

  // How clear the call is: the first pick's lead over the second, as a share of
  // the first pick. A 2% lead is a coin toss dressed as an answer.
  const margins = live.map((w) => (w.ranked[0].xp - w.ranked[1].xp) / Math.max(w.ranked[0].xp, 1e-6))
  const tight = margins.filter((m) => m < 0.08).length

  return (
    <Panel
      title="The armband, week by week"
      kicker="Your best three captain options each week, by projected points. The bar under each week is how clear the call is — a short bar means the top two are close enough that either is defensible."
      note={
        <>
          {tight} of {live.length} weeks have the top two within 8% of each other. In those weeks the
          projection is not telling you who to captain, it is telling you it does not know — and the
          honest move is to pick on ownership instead, which the panel below prices.
        </>
      }
    >
      <div className="overflow-x-auto">
        <div className="flex min-w-max gap-2">
          {live.map((w, wi) => (
            <div key={w.gw} className="w-[140px] shrink-0 rounded-xl border border-line bg-surface-2/50 p-2">
              <div className="mb-1.5 text-[10px] font-bold tracking-[0.1em] text-ink-3 uppercase">GW{w.gw}</div>
              {w.ranked.slice(0, 3).map((r, i) => (
                <div key={r.p.element} className="mb-1 flex items-center gap-1.5">
                  {i === 0
                    ? <span className="text-accent"><Icon name="crown" size={12} /></span>
                    : <span className="w-3 text-center font-num text-[10px] text-ink-3">{i + 1}</span>}
                  <span className={`min-w-0 flex-1 truncate text-[12px] ${i === 0 ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                    {String(r.p.row.web_name)}
                  </span>
                  <span className="font-num text-[11.5px] font-semibold text-accent-2 tabular-nums">{r.xp.toFixed(1)}</span>
                </div>
              ))}
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(100, margins[wi] * 400)}%`, background: margins[wi] < 0.08 ? 'var(--warn)' : 'var(--accent)' }}
                  title={`${pct(margins[wi])} clear of the second pick`}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  )
}

// ── what the armband is worth against the field ─────────────────────────────

export function CaptaincyVsField({ squad, xiElements, pool, gws, engine, gwIndex, gw }: {
  squad: PlayerSeries[]
  xiElements: Set<number>
  pool: RatingRow[]
  gws: number[]
  engine: Engine
  gwIndex: number
  gw: number
}) {
  const rows = useMemo(() => squad
    .filter((p) => xiElements.has(p.element) && p.weeks[gwIndex]?.parts)
    .map((p) => {
      const xp = p.weeks[gwIndex].xp
      const owned = (num(p.row, 'selected_by_percent') ?? 0) / 100
      return { p, xp, owned }
    })
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 6), [squad, xiElements, gwIndex])

  /* THE FIELD'S CAPTAIN IS A LEAGUE-WIDE FACT, not one of your fifteen.
     The first version took the most-owned player in your own eleven, which
     made a captaincy differential impossible by construction — you were always
     measured against yourself, and everyone below your top pick came out
     negative. So the benchmark is the pool player with the highest ownership x
     projection, the standard proxy for who the armband actually lands on. */
  const field = useMemo(() => {
    const candidates = pool
      .map((r) => ({ r, owned: (num(r, 'selected_by_percent') ?? 0) / 100 }))
      .filter((c) => c.owned > 0.05)
      .sort((a, b) => b.owned - a.owned)
      .slice(0, 25)
    if (!candidates.length) return null
    const projected = buildSeries(candidates.map((c) => c.r), gws, engine)
    let best: { name: string; xp: number; owned: number } | null = null
    projected.forEach((p, i) => {
      const xp = p.weeks[gwIndex]?.xp ?? 0
      const owned = candidates[i].owned
      const weight = xp * owned
      if (!best || weight > best.xp * best.owned) best = { name: String(p.row.web_name), xp, owned }
    })
    return best as { name: string; xp: number; owned: number } | null
  }, [pool, gws, engine, gwIndex])

  if (rows.length < 2 || !field) return null
  const max = Math.max(...rows.map((r) => Math.abs(r.xp - field.xp)), 1e-6)

  return (
    <Panel
      title={`What the armband is worth against the field — GW${gw}`}
      kicker={`Captaining someone doubles the gap between him and whoever everyone else captains. The field's pick is ${field.name} — ${pct(field.owned)} owned across the game, projected ${field.xp.toFixed(1)} — so that is the line each of your options is measured against.`}
      note={
        <>
          A word of caution the data forces: the site knows <b>ownership</b>, which FPL publishes,
          but not <b>captaincy</b>, which it does not. The field's pick above is the standard proxy —
          the highest ownership × projection in the game — not a measured captain split. It is the
          right shape of answer and an approximate size of one. Every row coming out negative is not
          a bug: it means you do not own the template captain, and the armband cannot buy you rank
          this week, only lose less of it.
        </>
      }
    >
      <div className="grid gap-1.5">
        {rows.map((r) => {
          const edge = (r.xp - field.xp) * 2
          const isField = String(r.p.row.web_name) === field.name
          return (
            <div key={r.p.element} className="flex items-center gap-2">
              <span className="w-[110px] shrink-0 truncate text-[12.5px] font-semibold text-ink sm:w-[150px]">
                {String(r.p.row.web_name)}
                {isField && <span className="ml-1 text-[10px] font-bold tracking-wide text-ink-3 uppercase">field</span>}
              </span>
              <span className="font-num w-11 shrink-0 text-right text-[11.5px] text-ink-3 tabular-nums">{pct(r.owned)}</span>
              {/* Zero sits in the middle: left of it you are handing rank away. */}
              <div className="relative h-5 flex-1 rounded-md bg-surface-2">
                <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
                <div
                  className="absolute inset-y-0 rounded-md"
                  style={{
                    left: edge >= 0 ? '50%' : `${50 - (Math.abs(edge) / (max * 2)) * 50}%`,
                    width: `${(Math.abs(edge) / (max * 2)) * 50}%`,
                    background: edge >= 0 ? 'var(--good)' : 'var(--bad)',
                  }}
                />
              </div>
              <span className={`font-num w-12 shrink-0 text-right text-[12px] font-semibold tabular-nums ${edge >= 0 ? 'text-good' : 'text-bad'}`}>
                {edge >= 0 ? '+' : ''}{edge.toFixed(1)}
              </span>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

// ── chips ───────────────────────────────────────────────────────────────────

export function ChipWindows({ squad, xiElements, gws }: {
  squad: PlayerSeries[]
  xiElements: Set<number>
  gws: number[]
}) {
  const weeks = useMemo(() => chipWindows(squad, xiElements, gws), [squad, xiElements, gws])
  if (!weeks.length) return null
  const bb = weeks.map((w) => w.benchBoost)
  const tc = weeks.map((w) => w.tripleCaptain)
  const max = Math.max(...bb, ...tc, 1e-6)
  const bbSpread = (Math.max(...bb) - Math.min(...bb)) / Math.max(...bb)
  const bestBB = weeks[bb.indexOf(Math.max(...bb))]
  const bestTC = weeks[tc.indexOf(Math.max(...tc))]

  return (
    <Panel
      title="Chip windows"
      kicker="Bench Boost is what your four bench players would add that week. Triple Captain is the EXTRA from a third multiplier on your best starter — not his whole score, because you already had him doubled."
      note={
        bbSpread < 0.2
          ? <>Bench Boost swings only {pct(bbSpread)} across these six weeks, and a flat profile is
              itself the finding: no week here is special, so the right play is to hold the chip for
              a double gameweek rather than hunt a peak that is not there.</>
          : <>Best Bench Boost week is GW{bestBB.gw} at {bestBB.benchBoost.toFixed(1)}; best Triple
              Captain is GW{bestTC.gw} on {bestTC.tcName} for {bestTC.tripleCaptain.toFixed(1)} extra.
              Both are still worth weighing against a double gameweek later.</>
      }
    >
      <div className="grid gap-2">
        {weeks.map((w) => (
          <div key={w.gw} className="flex items-center gap-2">
            <span className="font-num w-11 shrink-0 text-[11px] text-ink-3 tabular-nums">GW{w.gw}</span>
            <div className="flex-1">
              <div className="mb-1 flex items-center gap-2">
                <div className="h-3.5 flex-1 overflow-hidden rounded bg-surface-2">
                  <div className="h-full rounded" style={{ width: `${(w.benchBoost / max) * 100}%`, background: 'var(--accent)' }} />
                </div>
                <span className="font-num w-9 text-right text-[11.5px] font-semibold text-accent-2 tabular-nums">{w.benchBoost.toFixed(1)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3.5 flex-1 overflow-hidden rounded bg-surface-2">
                  <div className="h-full rounded" style={{ width: `${(w.tripleCaptain / max) * 100}%`, background: 'var(--info)' }} />
                </div>
                <span className="font-num w-9 text-right text-[11.5px] font-semibold text-ink-2 tabular-nums">+{w.tripleCaptain.toFixed(1)}</span>
              </div>
            </div>
            <span className="w-[86px] shrink-0 truncate text-[11px] text-ink-3">{w.tcName}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-[11px] text-ink-2">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-[2px]" style={{ background: 'var(--accent)' }} />Bench Boost</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-[2px]" style={{ background: 'var(--info)' }} />Triple Captain, extra</span>
      </div>
    </Panel>
  )
}

// ── ownership ───────────────────────────────────────────────────────────────

export function OwnershipSwing({ squad, gwIndex, gw }: {
  squad: PlayerSeries[]
  gwIndex: number
  gw: number
}) {
  const rows = useMemo(() => squad
    .map((p) => ({ p, ...effectiveOwnership(p, gwIndex) }))
    .filter((r) => r.xp > 0)
    .sort((a, b) => b.swing - a.swing), [squad, gwIndex])

  if (!rows.length) return null
  const max = Math.max(...rows.map((r) => r.xp), 1e-6)
  const byXp = rows.slice().sort((a, b) => b.xp - a.xp)
  const moved = rows.findIndex((r) => r.p.element === byXp[0].p.element)

  return (
    <Panel
      title={`Effective ownership swing — GW${gw}`}
      kicker="Projected points multiplied by the share of managers who do NOT own him. Points move your score; only points other people do not have move your rank, and rank is what the game is scored on."
      note={
        <>
          The two orders disagree — {String(byXp[0].p.row.web_name)} is your highest projection but
          {moved === 0 ? ' also tops this list' : ` sits ${moved + 1}${moved === 1 ? 'nd' : moved === 2 ? 'rd' : 'th'} here`}
          {' '}— and that disagreement is the entire case for a differential. Ownership is the discount
          rate on points: a player everyone has can only hold your rank.
        </>
      }
    >
      <div className="grid gap-1.5">
        {rows.map((r) => (
          <div key={r.p.element} className="flex items-center gap-2">
            <span className="w-[110px] shrink-0 truncate text-[12.5px] font-semibold text-ink sm:w-[150px]">
              {String(r.p.row.web_name)}
            </span>
            <span className="font-num w-11 shrink-0 text-right text-[11px] text-ink-3 tabular-nums">{pct(r.owned)}</span>
            {/* Full bar is the raw projection; the filled part is what survives
                ownership. The gap between them IS the discount. */}
            <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-surface-2">
              <div className="absolute inset-y-0 left-0 rounded-md bg-accent-soft" style={{ width: `${(r.xp / max) * 100}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-md bg-accent" style={{ width: `${(r.swing / max) * 100}%` }} />
            </div>
            <span className="font-num w-10 shrink-0 text-right text-[12px] font-semibold text-accent-2 tabular-nums">{r.swing.toFixed(2)}</span>
            <span className="font-num w-10 shrink-0 text-right text-[11px] text-ink-3 tabular-nums">{r.xp.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-[11px] text-ink-2">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-[2px] bg-accent" />Swing</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-[2px] bg-accent-soft" />Raw xP</span>
      </div>
    </Panel>
  )
}

// ── transfers ───────────────────────────────────────────────────────────────

export function TransferUpside({ squad, pool, gws, engine, bank }: {
  squad: PlayerSeries[]
  pool: RatingRow[]
  gws: number[]
  engine: Engine
  bank: number
}) {
  const moves = useMemo(() => {
    const owned = new Set(squad.map((p) => p.element))
    // The whole pool through the engine is 573 x 6 and runs in well under a
    // second, but there is no point projecting a £4.0m fourth-choice keeper: a
    // candidate has to be someone the optimiser would ever pick.
    const priciest = Math.max(...squad.map((p) => p.price))
    const candidates = pool.filter((r) => {
      const el = num(r, 'element') ?? -1
      if (owned.has(el)) return false
      const price = num(r, 'price') ?? 99
      return price <= priciest + bank + 0.1
    })
    return transferUpside(squad, buildSeries(candidates, gws, engine), bank)
  }, [squad, pool, gws, engine, bank])

  if (!moves.length) {
    return (
      <Panel title="What a transfer would actually buy" kicker="Nothing in the market beats what you own inside the bank — over this horizon, on this projection.">
        <div className="text-[13px] text-ink-2">No upgrade found. That is a good sign, not an empty panel.</div>
      </Panel>
    )
  }
  const max = Math.max(...moves.map((m) => m.gain))

  return (
    <Panel
      title="What a transfer would actually buy"
      kicker={`The best same-position swap for each player you own, inside your £${bank.toFixed(1)}m bank and the three-per-club rule. Scored over the whole horizon, not the next week — a one-week gain that reverses in the second is not an upgrade.`}
      note={
        <>
          A hit costs 4 points. Anything below that line is a move you should only make for free,
          and the top move here is worth {moves[0].gain.toFixed(1)} over {gws.length} weeks —
          {moves[0].gain >= 4 ? ' enough to take one.' : ' not enough to take one.'}
        </>
      }
    >
      <div className="grid gap-1.5">
        {moves.map((m) => (
          <div key={m.out.element} className="flex items-center gap-2">
            <span className="w-[92px] shrink-0 truncate text-[12.5px] text-ink-2 sm:w-[110px]">
              {String(m.out.row.web_name)}
            </span>
            <Icon name="trend-up" size={13} className="shrink-0 text-accent" />
            <span className="w-[92px] shrink-0 truncate text-[12.5px] font-semibold text-ink sm:w-[110px]">
              {String(m.in.row.web_name)}
            </span>
            <div className="h-4 flex-1 overflow-hidden rounded-md bg-surface-2">
              <div className="h-full rounded-md" style={{ width: `${(m.gain / max) * 100}%`, background: m.gain >= 4 ? 'var(--good)' : 'var(--accent)' }} />
            </div>
            <span className="font-num w-11 shrink-0 text-right text-[12px] font-semibold text-accent-2 tabular-nums">+{m.gain.toFixed(1)}</span>
            <span className="font-num w-12 shrink-0 text-right text-[11px] text-ink-3 tabular-nums">
              {m.cost >= 0 ? '−' : '+'}£{Math.abs(m.cost).toFixed(1)}m
            </span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── fixture turn map ────────────────────────────────────────────────────────

export function FixtureTurnMap({ fixtureEase, gws, squadTeams, diffScale }: {
  fixtureEase: FixtureEaseRow[]
  gws: number[]
  squadTeams: Set<string>
  diffScale: DiffScale | null
}) {
  const rows = useMemo(() => {
    const teams = [...new Set(fixtureEase.map((f) => f.team))].sort()
    return teams.map((team) => {
      const cells = gws.map((gw) => {
        const fx = fixtureEase.filter((f) => f.team === team && f.gw === gw)
        if (!fx.length) return null
        /* The site's own attacking difficulty, not FPL's FDR. FDR is an
           editorial 1–5 that exists for no historical fixture and cannot be
           checked against anything; analyserDiff is built from the opponent's
           measured xG conceded and the venue, and is what the Fixtures page
           colours by — so a green cell here means what a green cell means
           there. It falls back to FDR only when the baselines are missing. */
        const d = fx.reduce((s, f) =>
          s + analyserDiff(f.opponent, 'attack', f.venue as 'H' | 'A', f.fdr, diffScale).diff, 0) / fx.length
        return { label: fx.map((f) => `${f.opponent}${f.venue}`).join(' + '), t: (3 - d) / 2 }
      })
      const seen = cells.filter(Boolean) as { label: string; t: number }[]
      const avg = seen.length ? seen.reduce((s, c) => s + c.t, 0) / seen.length : -99
      // The turn: second half of the window against the first. A club whose
      // average is ordinary but whose back end is kind is the transfer nobody
      // has made yet, and an average alone hides it completely.
      const half = Math.floor(cells.length / 2)
      const first = cells.slice(0, half).filter(Boolean) as { t: number }[]
      const last = cells.slice(half).filter(Boolean) as { t: number }[]
      const turn = (last.length ? last.reduce((s, c) => s + c.t, 0) / last.length : 0)
        - (first.length ? first.reduce((s, c) => s + c.t, 0) / first.length : 0)
      return { team, cells, avg, turn }
    }).sort((a, b) => b.avg - a.avg)
  }, [fixtureEase, gws, diffScale])

  const turning = rows.slice().sort((a, b) => b.turn - a.turn).slice(0, 3).filter((r) => r.turn > 0.15)

  return (
    <Panel
      title="Fixture turn map"
      kicker="Every club's run over the window, best average first. Sorting by average tells you who is good now; reading across a row tells you who is about to be."
      note={
        turning.length
          ? <>Buy the turn, not the run. {turning.map((r) => r.team).join(', ')}{' '}
              {turning.length === 1 ? 'has' : 'have'} a materially kinder second half of this window
              than first — a mid-table average hiding good weeks at the end is exactly the transfer
              nobody else has made yet.</>
          : <>No club's second half of this window is much kinder than its first, so there is no turn
              to buy here — the running order at the top is the running order.</>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[540px] border-separate border-spacing-[2px]">
          <thead>
            <tr>
              <th />
              {gws.map((gw) => (
                <td key={gw} className="pb-1 text-center text-[10px] font-bold tracking-[0.08em] text-ink-3 uppercase">GW{gw}</td>
              ))}
              <td className="pb-1 pl-2 text-center text-[10px] font-bold tracking-[0.08em] text-ink-3 uppercase">Turn</td>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.team}>
                <th className="pr-2 text-left">
                  <span className={`flex items-center gap-1.5 text-[12px] font-semibold ${squadTeams.has(r.team) ? 'text-accent' : 'text-ink'}`}>
                    <TeamBadge team={r.team} size={14} />{r.team}
                  </span>
                </th>
                {r.cells.map((c, i) => (
                  <td key={i} className="rounded px-1 py-1 text-center" style={{ background: c ? bandOf(c.t) : undefined }}>
                    <span className="block text-[11px] font-semibold text-ink">{c?.label ?? '–'}</span>
                  </td>
                ))}
                <td className="pl-2 text-center">
                  <span className={`font-num text-[11.5px] font-semibold tabular-nums ${r.turn > 0.15 ? 'text-good' : r.turn < -0.15 ? 'text-bad' : 'text-ink-3'}`}>
                    {r.turn > 0 ? '+' : ''}{r.turn.toFixed(2)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-ink-3">Your clubs are in gold. Turn is the back half of the window minus the front — positive means the run improves.</div>
    </Panel>
  )
}

// ── prices ──────────────────────────────────────────────────────────────────

interface PriceRow {
  element: number; web_name: string; team: string; position: string
  net_transfers_2gw: number; selected: number; velocity: number; risk: string
}

export function PriceWatch({ owned }: { owned: Set<number> }) {
  const q = useLazyTable<PriceRow[]>('price_risk')
  const rows = Array.isArray(q.data) ? q.data : null
  const sorted = useMemo(() => rows
    ? [...rows].sort((a, b) => Math.abs(b.velocity) - Math.abs(a.velocity)).slice(0, 16)
    : [], [rows])

  if (!rows) return null
  const mine = sorted.filter((r) => owned.has(r.element))
  const max = Math.max(...sorted.map((r) => Math.abs(r.velocity)), 1e-6)

  return (
    <Panel
      title="Price-change watch"
      kicker="Transfer velocity over the last two gameweeks. Right of centre is heading for a rise, left for a fall. Your own players are in gold."
      note={
        mine.length
          ? <>{mine.length} of your {owned.size} are on the move: {mine.map((r) => `${r.web_name} ${r.velocity > 0 ? '↑' : '↓'}`).join(', ')}.
              A rise is worth 0.1m and nothing else — never let it drive a transfer you would not
              otherwise make, but if you were making one anyway, the order matters.</>
          : <>Nobody in your squad is among the biggest movers, so there is no price deadline forcing
              your hand this week.</>
      }
    >
      <div className="grid gap-1">
        {sorted.map((r) => {
          const isMine = owned.has(r.element)
          const w = (Math.abs(r.velocity) / max) * 50
          return (
            <div key={r.element} className="flex items-center gap-2">
              <span className={`w-[112px] shrink-0 truncate text-[12.5px] ${isMine ? 'font-bold text-accent' : 'font-semibold text-ink'}`}>
                {r.web_name}
              </span>
              <span className="w-[68px] shrink-0 text-[10.5px] text-ink-3">{r.team} · {r.position}</span>
              <div className="relative h-4 flex-1 rounded-md bg-surface-2">
                <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
                <div
                  className="absolute inset-y-0 rounded-md"
                  style={{
                    left: r.velocity >= 0 ? '50%' : `${50 - w}%`,
                    width: `${w}%`,
                    background: r.velocity >= 0 ? 'var(--good)' : 'var(--bad)',
                  }}
                />
              </div>
              <span className={`font-num w-11 shrink-0 text-right text-[12px] font-semibold tabular-nums ${r.velocity >= 0 ? 'text-good' : 'text-bad'}`}>
                {r.velocity >= 0 ? '+' : ''}{r.velocity.toFixed(2)}
              </span>
              <span className="font-num w-[76px] shrink-0 text-right text-[11px] text-ink-3 tabular-nums">
                {r.net_transfers_2gw >= 0 ? '+' : '−'}{Math.abs(r.net_transfers_2gw).toLocaleString()}
              </span>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

/** Shared by the two panels that key off one specific gameweek. */
export const teamsOf = (squad: PlayerSeries[]) => new Set(squad.map((p) => str(p.row, 'team') ?? ''))
