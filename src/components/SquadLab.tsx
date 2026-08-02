import { useMemo, useState } from 'react'
import { Icon } from './Icon'
import { TeamBadge } from './badges'
import { tapHaptic } from '../lib/native'
import { num } from '../lib/rows'
import { teamLabel } from '../lib/util'
import { useXpModel, useMarketOdds, useShotProfiles } from '../lib/xp'
import {
  type CaptainLadder, type ChipAdvice, type ChipKey, type ChipPlan, type Clash,
  type Engine, type HorizonRead, type Move, type Recommendation, type TemplateRead,
  BAND_AT, captainLadder, chipPlan, horizonRead, recommend, templateRead,
} from '../lib/squadLab'
import { FIRST_HALF_LAST } from '../lib/planner'
import type { Availability } from '../lib/availability'
import type { FixtureEaseRow, RatingRow } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   Squad Lab — four reads under the board.

   One band of tiles, one drawer open at a time. Four full panels stacked
   would be a thousand pixels of page nobody finishes; four tiles are
   seventy, and every headline stays on screen whichever one you open.
   ════════════════════════════════════════════════════════════════════════ */

type Key = 'template' | 'horizon' | 'advice' | 'captain' | 'chips' | 'clash'

export function SquadLab({ squad, xi, pool, fixtureEase, avail, gw, gws, bank, freeTransfers, unlimitedTransfers, onApplyMove, chipSpentAt }: {
  squad: RatingRow[]
  xi: RatingRow[]
  pool: RatingRow[]
  fixtureEase: FixtureEaseRow[]
  avail?: Availability
  gw: number
  gws: number[]
  bank: number
  freeTransfers: number
  /** Transfers are already free this week — the opening squad, or a wildcard
   *  or free hit is on. A wildcard on top of that buys nothing. */
  unlimitedTransfers?: boolean
  /** Apply a recommended swap outright — the advice is specific, so making it
   *  should be one tap rather than arming a search you then repeat by hand. */
  onApplyMove?: (outEl: number, inEl: number) => void
  /** Where each chip has already gone in this half of the season. */
  chipSpentAt?: (c: ChipKey) => number | null
}) {
  const model = useXpModel()
  const market = useMarketOdds()
  const profiles = useShotProfiles()
  const [open, setOpen] = useState<Key | null>('advice')

  const engine: Engine = useMemo(
    () => ({ fixtureEase, avail, model, market, profiles }),
    [fixtureEase, avail, model, market, profiles],
  )

  const template = useMemo(() => templateRead(squad, pool), [squad, pool])
  const horizon = useMemo(() => horizonRead(squad, gw, engine, gws), [squad, gw, engine, gws])
  const captain = useMemo(() => captainLadder(xi, gw, engine), [xi, gw, engine])
  const advice = useMemo(
    () => recommend({ squad, pool, fromGw: gw, gws, bank, freeTransfers, engine }),
    [squad, pool, gw, gws, bank, freeTransfers, engine],
  )
  const chips = useMemo(
    () => chipPlan({ squad, pool, fromGw: gw, gws, bank, engine, freeTransfers, unlimitedTransfers, spentAt: chipSpentAt ?? (() => null) }),
    [squad, pool, gw, gws, bank, engine, freeTransfers, unlimitedTransfers, chipSpentAt],
  )

  if (!template) return null
  const toggle = (k: Key) => { tapHaptic('select'); setOpen((o) => (o === k ? null : k)) }

  return (
    <div className="@container mt-2.5 rounded-2xl border border-line bg-surface-1/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Squad lab</span>
        <span className="text-[11px] text-ink-3">Tap a tile</span>
      </div>

      {/* Five across only when five across actually fit.
          These used to be viewport breakpoints, which is the wrong question:
          the lab does not live in the viewport, it lives in a column that is
          400px on one screen and 660 on another. On a 1024 laptop the viewport
          said "large, go to five" and the column handed each tile 70px, so the
          numbers the lab exists to state were the first thing cut. Measured off
          the container instead, three roomy tiles over two rows beat five
          truncated ones on a single line. */}
      {/* Six tiles, so three across rather than five: five plus one leaves an
          orphan on its own row, and at 560px five tiles were already handing
          each one 70px. */}
      <div className="grid grid-cols-2 gap-2 @[440px]:grid-cols-3">
        <Tile
          label="Template" open={open === 'template'} onClick={() => toggle('template')}
          value={`${template.counts.template} of ${template.rows.length}`}
          sub={`${template.avgOwn.toFixed(0)}% owned on average`}
          tone={template.tone === 'warn' ? 'warn' : 'good'}
        />
        <Tile
          label="Horizon" open={open === 'horizon'} onClick={() => toggle('horizon')}
          value={horizon ? `GW${horizon.toughest.gw}` : '—'}
          sub={horizon
            ? `${horizon.toughest.hard} of 15 in a hard game — your toughest of the next ${horizon.weeks.length}`
            : 'needs a full squad'}
          tone={horizon && horizon.toughest.hard >= 5 ? 'warn' : 'ink'}
        />
        <Tile
          label="Analyser" open={open === 'advice'} onClick={() => toggle('advice')}
          value={advice ? (advice.verdict === 'hold' ? 'Hold' : `+${advice.net.toFixed(1)}`) : '—'}
          sub={advice ? (advice.verdict === 'hold' ? 'no move worth making' : `from ${advice.moves.length} ${advice.moves.length === 1 ? 'move' : 'moves'}`) : 'needs 15 players'}
          tone={advice?.verdict === 'move' ? 'accent' : 'good'}
        />
        <Tile
          label="Captain" open={open === 'captain'} onClick={() => toggle('captain')}
          value={captain ? String(captain.rows[0].row.web_name) : '—'}
          sub={captain ? (captain.close ? `only ${captain.gap.toFixed(1)} clear` : `${captain.gap.toFixed(1)} clear`) : 'needs an XI'}
          tone={captain?.close ? 'warn' : 'accent'}
        />
        <Tile
          label="Clashes" open={open === 'clash'} onClick={() => toggle('clash')}
          value={horizon ? (horizon.clashes.length ? `−${horizon.clashes.reduce((a, c) => a + c.cost, 0).toFixed(1)}` : 'None') : '—'}
          sub={horizon
            ? (horizon.clashes.length
                ? `${horizon.clashes.length} ${horizon.clashes.length === 1 ? 'fixture' : 'fixtures'} where your own players meet`
                : 'no player of yours plays another')
            : 'needs a full squad'}
          tone={horizon && horizon.clashes.length ? 'warn' : 'good'}
        />
        <Tile
          label="Chips" open={open === 'chips'} onClick={() => toggle('chips')}
          value={chips ? (chips.best ? (chips.best.chip === 'wildcard' ? 'Wildcard' : `GW${chips.best.gw}`) : 'Hold') : '—'}
          sub={chips
            ? (chips.best
                ? `${chips.best.label}${chips.best.chip === 'wildcard' ? '' : ` · +${chips.best.gain.toFixed(0)}`}`
                : chips.weeksLeft != null && chips.weeksLeft <= 4 ? `${chips.weeksLeft} weeks to use your first-half set` : 'none worth playing yet')
            : 'needs 15 players'}
          tone={chips?.best ? 'accent' : chips && chips.weeksLeft != null && chips.weeksLeft <= 4 ? 'warn' : 'good'}
        />
      </div>

      {open && (
        <div className="mt-3 border-t border-line pt-3">
          {open === 'clash' && <ClashPanel clashes={horizon?.clashes ?? []} />}
          {open === 'template' && <TemplatePanel read={template} />}
          {open === 'horizon' && <HorizonPanel read={horizon} />}
          {open === 'advice' && <AdvicePanel read={advice} onApply={onApplyMove} />}
          {open === 'captain' && <CaptainPanel read={captain} gw={gw} />}
          {open === 'chips' && <ChipsPanel read={chips} />}
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, sub, tone, open, onClick }: {
  label: string; value: string; sub: string; tone: 'good' | 'warn' | 'accent' | 'ink'; open: boolean; onClick: () => void
}) {
  const c = tone === 'warn' ? 'text-warn' : tone === 'good' ? 'text-good' : tone === 'accent' ? 'text-accent' : 'text-ink'
  return (
    <button
      onClick={onClick}
      aria-expanded={open}
      className={`rounded-xl border p-2 text-left transition-colors ${
        open ? 'border-accent bg-accent-soft/40' : 'border-line bg-surface-1/60 hover:border-line-strong'
      }`}
    >
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-semibold tracking-[0.12em] text-ink-3 uppercase">{label}</span>
        <Icon
          name="chevron-right"
          size={11}
          className={`ml-auto shrink-0 text-ink-3 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </div>
      {/* The value drops to 15px in the five-across layout. The longest thing
          a tile ever states is a captain's name, and "B.Fernandes" measured
          101px against 98px of tile — three pixels from readable, which
          truncate resolves by cutting the name rather than the number. */}
      <div className={`font-display mt-1 truncate text-base leading-none @[560px]:text-[15px] ${c}`}>{value}</div>
      <div className="mt-1 line-clamp-2 text-[10.5px] leading-tight text-ink-3">{sub}</div>
    </button>
  )
}

const Head = ({ title, note }: { title: string; note: string }) => (
  <div className="mb-2.5">
    <div className="text-sm font-bold text-ink">{title}</div>
    <div className="text-xs text-ink-3">{note}</div>
  </div>
)

const Readout = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-3 border-l-2 border-accent pl-2.5 text-xs text-ink-2">{children}</div>
)

/* ── 1 · template & differential ─────────────────────────────────────────── */

const BAND_STYLE = {
  template: { bar: 'bg-ink-3', label: 'Template' },
  balanced: { bar: 'bg-accent', label: 'Balanced' },
  punt: { bar: 'bg-good', label: 'Punt' },
} as const

function TemplatePanel({ read }: { read: TemplateRead }) {
  const max = Math.max(...read.rows.map((r) => r.own), 1)
  return (
    <div>
      <Head title="Template &amp; differential" note="How much of your squad is everyone else's squad" />

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(['template', 'balanced', 'punt'] as const).map((b) => (
          <span key={b} className="inline-flex items-center gap-1.5 rounded-full border border-line-mid px-2.5 py-1 text-[11px]">
            <span className={`size-2 rounded-full ${BAND_STYLE[b].bar}`} />
            <span className="font-semibold text-ink">{read.counts[b]}</span>
            <span className="text-ink-3">
              {BAND_STYLE[b].label}
              {b === 'template' ? ` (${BAND_AT.template}%+)` : b === 'punt' ? ` (<${BAND_AT.balanced}%)` : ''}
            </span>
            <span className="text-ink-3/70">· typically {read.typical[b].toFixed(0)}</span>
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        {read.rows.map(({ row, own, band }) => (
          <div key={num(row, 'element')} className="flex items-center gap-2 text-xs">
            <TeamBadge team={String(row.team)} size={14} />
            <span className="w-[86px] shrink-0 truncate font-medium text-ink">{String(row.web_name)}</span>
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
              <span className={`block h-full rounded-full ${BAND_STYLE[band].bar}`} style={{ width: `${(own / max) * 100}%` }} />
            </span>
            <span className="w-11 shrink-0 text-right tabular-nums text-ink-2">{own.toFixed(1)}%</span>
          </div>
        ))}
      </div>

      {read.missing.length > 0 && (
        <div className="mt-3 rounded-xl border border-line bg-surface-2/40 p-2.5">
          <div className="text-[10px] font-semibold tracking-[0.12em] text-ink-3 uppercase">The bets you're making by leaving them out</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {read.missing.map(({ row, own }) => (
              <span key={num(row, 'element')} className="inline-flex items-center gap-1.5 rounded-lg border border-line-mid px-2 py-1 text-[11px]">
                <TeamBadge team={String(row.team)} size={12} />
                <span className="font-medium text-ink">{String(row.web_name)}</span>
                <span className="tabular-nums text-bad">{own.toFixed(0)}%</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <Readout>
        {read.headline}. Your rank doesn't move on the players everyone owns — it moves on the ones they don't,
        and on the big names you've gone without.
      </Readout>
    </div>
  )
}

/* ── 2 · horizon scanning ────────────────────────────────────────────────── */

function HorizonPanel({ read }: { read: HorizonRead | null }) {
  if (!read) return <div className="py-4 text-center text-xs text-ink-3">Complete your fifteen to scan the horizon.</div>
  // A fifteen spread across ten clubs has a genuinely smoother schedule than
  // any one of them, so plotted from zero these bars would look identical.
  // They're drawn as a deviation from your own average week instead — the
  // axis says so, so a 4% week still reads as a 4% week.
  const dev = read.weeks.map((w) => (read.mean > 0 ? (w.xp - read.mean) / read.mean : 0))
  const span = Math.max(...dev.map(Math.abs), 0.02)
  // The bars carry value; the row of counts underneath carries trouble. A
  // week is worth flagging when a real share of the squad walks into a hard
  // game, which moves far more than projected points do.
  const alarming = (w: { hard: number }) => w.hard >= 5
  const notable = read.toughest.hard >= 3
  return (
    <div>
      <Head title="Horizon scanning" note={`What your fifteen face over the next ${read.weeks.length} gameweeks`} />

      {/* The conclusion first.
          This used to sit at the very bottom, under the bars, the hard counts,
          the hardest-fixture chips, the blanks and doubles and the clash list —
          in 12px muted type, as a footnote. It is the one sentence the whole
          panel exists to produce ("GW6 is the week to plan for, nine of your
          fifteen face a hard game"), and a reader had to get past six other
          things to reach it. Chart underneath, as evidence for a claim already
          made. */}
      <div className="mb-3 rounded-xl border border-line-mid bg-surface-2/60 px-3 py-2.5 text-[13.5px] leading-relaxed font-semibold text-ink">
        {read.headline}
      </div>

      <div className="relative flex h-[96px] items-center gap-1.5">
        <span className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
        {read.weeks.map((w, i) => {
          const peak = w.gw === read.best.gw && read.swing >= 5
          const trough = w.gw === read.toughest.gw && notable
          const up = dev[i] >= 0
          const h = Math.max(3, (Math.abs(dev[i]) / span) * 34)
          const bg = trough ? 'bg-bad' : peak ? 'bg-good' : 'bg-ink-3/50'
          return (
            <div key={w.gw} className="relative z-[1] flex h-full min-w-0 flex-1 flex-col items-center">
              <div className="flex h-1/2 w-full flex-col items-center justify-end">
                {up && <span className="font-num mb-0.5 text-[10px] tabular-nums text-good">+{(dev[i] * 100).toFixed(0)}%</span>}
                {up && <span className={`w-full rounded-t-sm ${bg}`} style={{ height: `${h}px` }} />}
              </div>
              <div className="flex h-1/2 w-full flex-col items-center">
                {!up && <span className={`w-full rounded-b-sm ${bg}`} style={{ height: `${h}px` }} />}
                {!up && <span className="font-num mt-0.5 text-[10px] tabular-nums text-bad">{(dev[i] * 100).toFixed(0)}%</span>}
                <span className={`mt-auto text-[10px] font-semibold ${trough ? 'text-bad' : peak ? 'text-good' : 'text-ink-3'}`}>
                  GW{w.gw}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-0.5 text-center text-[10px] text-ink-3">
        against your average week of {read.mean.toFixed(0)} projected points
      </div>

      {/* What the bars can't show: a fifteen across ten clubs barely moves in
          projected points, but the number of players walking into a hard game
          swings from one to eight over the same run. */}
      <div className="mt-2.5 flex items-stretch gap-1.5">
        {read.weeks.map((w) => (
          <div
            key={w.gw}
            title={`GW${w.gw}: ${w.hard} hard, ${w.easy} easy`}
            className={`flex min-w-0 flex-1 flex-col items-center rounded-md border py-1 ${
              alarming(w) ? 'border-bad/50 bg-bad/10' : w.hard <= 2 ? 'border-good/40 bg-good/5' : 'border-line'
            }`}
          >
            <span className={`font-num text-[13px] leading-none tabular-nums ${
              alarming(w) ? 'text-bad' : w.hard <= 2 ? 'text-good' : 'text-ink-2'
            }`}>{w.hard}</span>
            <span className="mt-0.5 text-[10px] tracking-wide text-ink-3 uppercase">hard</span>
          </div>
        ))}
      </div>
      <div className="mt-0.5 text-center text-[10px] text-ink-3">
        of your fifteen facing a fixture rated 4 or 5 for difficulty
      </div>

      {read.hardest.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <span className="font-semibold text-ink-3">GW{read.toughest.gw} is hardest for</span>
          {read.hardest.map((h) => (
            <span key={h.team} className="inline-flex items-center gap-1 rounded-md border border-line-mid px-1.5 py-0.5">
              <TeamBadge team={h.team} size={11} />
              <span className="text-ink-2">{h.opponent}</span>
            </span>
          ))}
        </div>
      )}

      {read.weeks.some((w) => w.blanks || w.doubles) && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-3">
          {read.weeks.filter((w) => w.doubles).map((w) => (
            <span key={`d${w.gw}`} className="text-good">GW{w.gw}: {w.doubles} double{w.doubles > 1 ? 's' : ''}</span>
          ))}
          {read.weeks.filter((w) => w.blanks).map((w) => (
            <span key={`b${w.gw}`} className="text-bad">GW{w.gw}: {w.blanks} blank{w.blanks > 1 ? 's' : ''}</span>
          ))}
        </div>
      )}


      <Readout>
        Each bar is your best eleven's projected points for that week — not a difficulty colour — so it already
        accounts for who you actually own, who's fit, and what the bookmakers make of each fixture.
      </Readout>
    </div>
  )
}

/** Your own attacker against your own defence — the only pairing that really
 *  cannibalises, since two defences can both keep a clean sheet in a 0-0.
 *
 *  Its own tab rather than a footnote on the horizon panel. It answers a
 *  different question from "when is my hard week" — it is about the fifteen
 *  rather than the calendar — and buried at the bottom of a panel that already
 *  carries a chart, a hard-fixture strip, a hardest-fixture list and a
 *  blanks-and-doubles line, it was the sixth thing on screen. */
function ClashPanel({ clashes }: { clashes: Clash[] }) {
  const total = clashes.reduce((a, c) => a + c.cost, 0)
  return (
    <div>
      <Head title="Your players cost each other" note="Where an attacker of yours ends a defender of yours' clean sheet" />
      {!clashes.length ? (
        <div className="rounded-xl border border-good/35 bg-good/5 px-3 py-2.5 text-[13.5px] font-semibold text-ink">
          Nothing in the next few weeks. No attacker of yours meets a defender of yours, so nobody in the fifteen is
          scoring at another's expense.
        </div>
      ) : (
        <>
          <div className="mb-3 rounded-xl border border-line-mid bg-surface-2/60 px-3 py-2.5 text-[13.5px] leading-relaxed font-semibold text-ink">
            {clashes.length === 1 ? 'One fixture' : `${clashes.length} fixtures`} where your own players meet — about{' '}
            <span className="text-bad">{total.toFixed(1)} points</span> of clean sheet at risk from your own attack.
          </div>
          <div className="flex flex-col gap-2.5">
        {clashes.map((c, i) => (
          <div key={i} className="rounded-xl border border-bad/35 bg-bad/5 p-2.5 text-xs">
            <div className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="font-semibold text-ink">GW{c.gw}</span>
              <span className="text-ink-2">{c.fixture}</span>
              <span className="font-num ml-auto tabular-nums text-bad">−{c.cost.toFixed(1)} pts</span>
            </div>
            <div className="text-ink-3">
              <span className="text-ink-2">
                {c.attackers.map((a) => `${String(a.row.web_name)} (${(a.pScore * 100).toFixed(0)}%)`).join(' or ')}
              </span>
              {' '}scoring ends the clean sheet for{' '}
              <span className="text-ink-2">{c.blocked.map((b) => String(b.web_name)).join(' and ')}</span>
            </div>
          </div>
        ))}
          </div>
          <Readout>
            Two defences can both keep a clean sheet in a 0-0, so defenders never really cannibalise. An attacker
            against your own defence is the one pairing that does, and it is the cost nobody prices in when they
            buy the third player from a club.
          </Readout>
        </>
      )}
    </div>
  )
}

/* ── 3 · the Analyser's recommendation ───────────────────────────────────── */

function AdvicePanel({ read, onApply }: { read: Recommendation | null; onApply?: (outEl: number, inEl: number) => void }) {
  if (!read) return <div className="py-4 text-center text-xs text-ink-3">Complete your fifteen for a recommendation.</div>
  const hold = read.verdict === 'hold'
  return (
    <div>
      <Head title="The Analyser's recommendation" note={`Judged over the next ${read.weeks} gameweeks, not just this one`} />

      <div className={`rounded-xl border p-3 ${hold ? 'border-good/40 bg-good/5' : 'border-accent/40 bg-accent-soft/40'}`}>
        <div className="flex items-center gap-2">
          <Icon name={hold ? 'check' : 'bolt'} size={14} className={hold ? 'text-good' : 'text-accent'} />
          <span className={`text-sm font-bold ${hold ? 'text-good' : 'text-accent'}`}>{read.headline}</span>
        </div>
        <div className="mt-1 text-xs text-ink-2">{read.detail}</div>
      </div>

      {read.moves.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-2">
          {read.moves.map((m, i) => <MoveRow key={i} move={m} step={i + 1} free={i < read.moves.length - read.hits} onApply={onApply} />)}
        </div>
      )}

      <Readout>
        {hold
          ? 'Doing nothing is a real answer. A transfer made because one was available is how a bank of free transfers becomes a wasted month.'
          : 'Each move is measured against the whole run, so a player with one good week doesn\'t out-rank one with six.'}
      </Readout>
    </div>
  )
}

function MoveRow({ move, step, free, onApply }: { move: Move; step: number; free: boolean; onApply?: (outEl: number, inEl: number) => void }) {
  return (
    <div className="rounded-xl border border-line bg-surface-1/60 p-2.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-num grid size-5 shrink-0 place-items-center rounded-md bg-surface-3 text-[10px] font-bold text-ink-2">{step}</span>
        <span className="truncate text-bad">{String(move.out.web_name)}</span>
        <Icon name="arrow-right" size={12} className="shrink-0 text-ink-3" />
        <TeamBadge team={String(move.in.team)} size={13} />
        <span className="truncate font-semibold text-good">{String(move.in.web_name)}</span>
        <span className="font-num ml-auto shrink-0 tabular-nums text-accent">+{move.gain.toFixed(1)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-7 text-[11px] text-ink-3">
        <span>{move.reason}</span>
        <span>·</span>
        <span>{teamLabel(String(move.in.team))}</span>
        <span>·</span>
        <span className={move.spend > 0 ? 'text-bad' : 'text-good'}>
          {move.spend >= 0 ? '−' : '+'}£{Math.abs(move.spend).toFixed(1)}m
        </span>
        {!free && <><span>·</span><span className="text-bad">costs a hit</span></>}
        {onApply && (
          <button
            onClick={() => {
              tapHaptic('medium')
              onApply(num(move.out, 'element') as number, num(move.in, 'element') as number)
            }}
            className="ml-auto font-semibold text-accent hover:underline"
          >
            Make this move
          </button>
        )}
      </div>
    </div>
  )
}

/* ── 4 · captain ladder ──────────────────────────────────────────────────── */

function CaptainPanel({ read, gw }: { read: CaptainLadder | null; gw: number }) {
  if (!read) return <div className="py-4 text-center text-xs text-ink-3">Pick your eleven to rank the armband.</div>
  const max = Math.max(...read.rows.map((r) => r.xp), 1)
  const shown = read.rows.slice(0, 8)
  return (
    <div>
      <Head title={`Captain ladder · GW${gw}`} note="Ranked on projected points; judged on how often each one actually tops your XI" />

      <div className="mb-1 flex items-center gap-2 px-1 text-[10px] font-semibold tracking-[0.12em] text-ink-3 uppercase">
        <span className="w-[18px] shrink-0" />
        <span className="w-[76px] shrink-0">Player</span>
        <span className="hidden w-[92px] shrink-0 sm:block">Fixture</span>
        <span className="min-w-0 flex-1" />
        <span className="w-9 shrink-0 text-right">xP</span>
        <span className="w-11 shrink-0 text-right">Tops XI</span>
      </div>

      <div className="flex flex-col gap-0.5">
        {shown.map((r, i) => (
          <div key={num(r.row, 'element')} className={`flex items-center gap-2 rounded-lg px-1 py-1.5 text-xs ${i === 0 ? 'bg-accent-soft/50 ring-1 ring-accent/40' : ''}`}>
            <span className={`grid size-[18px] shrink-0 place-items-center rounded-md text-[10px] font-bold ${
              i === 0 ? 'bg-accent text-accent-contrast' : i === 1 ? 'bg-surface-3 text-ink-2' : 'text-ink-3'
            }`}>{i === 0 ? 'C' : i === 1 ? 'V' : ''}</span>
            <span className="w-[76px] shrink-0 truncate font-semibold text-ink">{String(r.row.web_name)}</span>
            <span className="hidden w-[92px] shrink-0 truncate text-ink-3 sm:block">{r.fixture}</span>
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
              <span className={`block h-full rounded-full ${i === 0 ? 'bg-accent' : 'bg-ink-3/60'}`} style={{ width: `${(r.xp / max) * 100}%` }} />
            </span>
            <span className={`font-num w-9 shrink-0 text-right tabular-nums ${i === 0 ? 'text-accent' : 'text-ink-2'}`}>{r.xp.toFixed(1)}</span>
            <span className="font-num w-11 shrink-0 text-right tabular-nums text-ink-3">{r.topPct.toFixed(0)}%</span>
          </div>
        ))}
      </div>

      <div className={`mt-2.5 flex items-start gap-2 rounded-xl border p-2.5 text-xs ${
        read.close ? 'border-warn/40 bg-warn/5' : 'border-good/35 bg-good/5'
      }`}>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.1em] uppercase ${
          read.close ? 'bg-warn/20 text-warn' : 'bg-good/20 text-good'
        }`}>{read.close ? 'Close call' : 'Clear call'}</span>
        <span className="text-ink-2">
          {read.headline}
          {read.close ? ' — close enough that either is defensible.' : '.'}
          {' '}He returns double figures in <span className="font-semibold text-ink">{read.rows[0].haulPct.toFixed(0)}%</span> of simulated weeks.
        </span>
      </div>

      {shown.some((r) => r.note) && (
        <div className="mt-2 flex flex-col gap-1">
          {shown.filter((r) => r.note).slice(0, 3).map((r) => (
            <div key={`n${num(r.row, 'element')}`} className="flex gap-1.5 text-[11px]">
              <span className={`mt-1 size-1.5 shrink-0 rounded-full ${r.matchup > 1 ? 'bg-good' : 'bg-warn'}`} />
              <span className="text-ink-3"><span className="font-medium text-ink-2">{String(r.row.web_name)}</span> — {r.note}</span>
            </div>
          ))}
        </div>
      )}

      <Readout>
        A gameweek is simulated four thousand times from the same rates the projection uses, so "tops your XI" is a
        real race rather than eleven numbers compared after the fact. Dead-ball notes match how a player scores against
        how his opponent concedes.
      </Readout>
    </div>
  )
}

/* ── 5 · chips ───────────────────────────────────────────────────────────── */

const CHIP_NOTE: Record<ChipKey, string> = {
  'triple-captain': 'A third helping of your best player',
  'bench-boost': 'Your four substitutes score too',
  'free-hit': 'One week as any squad you like',
  wildcard: 'Rebuild the fifteen, no hits',
}

function ChipsPanel({ read }: { read: ChipPlan | null }) {
  if (!read) return <div className="py-4 text-center text-xs text-ink-3">Complete your fifteen to plan your chips.</div>
  return (
    <div>
      <Head
        title="Chip planning"
        note={read.weeksLeft != null
          ? `Best week in the ${read.span} left this half, valued against playing normally — your first-half set expires after GW${FIRST_HALF_LAST}`
          : `Best week in the ${read.span} left this season, valued against playing that week normally`}
      />

      <div className="flex flex-col gap-2">
        {read.advice.map((a) => <ChipRow key={a.chip} a={a} best={read.best?.chip === a.chip} />)}
      </div>

      {read.weeksLeft != null && read.weeksLeft <= 6 && read.advice.some((a) => a.spentAt == null) && (
        <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-warn/40 bg-warn/5 p-2.5 text-xs">
          <Icon name="clock" size={13} className="shrink-0 text-warn" />
          <span className="text-ink-2">
            Your first-half chips have to be played by <span className="font-semibold text-ink">GW{FIRST_HALF_LAST}</span> — a
            second full set unlocks at GW20, so an unused one now is simply lost.
          </span>
        </div>
      )}

      <Readout>
        {read.headline}. Most managers lose more to chips held too long than to chips played too early — a
        Bench Boost that expires unused is worth nothing at all.
      </Readout>
    </div>
  )
}

function ChipRow({ a, best }: { a: ChipAdvice; best: boolean }) {
  const spent = a.spentAt != null
  return (
    <div className={`rounded-xl border p-2.5 ${
      spent ? 'border-line bg-surface-2/30 opacity-60'
        : best ? 'border-accent bg-accent-soft/40'
          : a.worthIt ? 'border-line-strong' : 'border-line'
    }`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={`text-xs font-bold ${best ? 'text-accent' : 'text-ink'}`}>{a.label}</span>
        {spent
          ? <span className="text-[11px] text-ink-3">played in GW{a.spentAt}</span>
          : a.worthIt && a.gw != null
            ? <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-accent uppercase">GW{a.gw}</span>
            : <span className="text-[11px] text-ink-3">hold</span>}
        {/* The wildcard is never a points figure, and a free hit is decided
            on the shape of the week rather than the gap — so its number is
            the size of the prize, shown only once the week justifies one. */}
        {!spent && a.chip !== 'wildcard' && (a.chip !== 'free-hit' || a.worthIt) && (
          <span className={`font-num ml-auto text-sm tabular-nums ${a.worthIt ? 'text-good' : 'text-ink-3'}`}>
            +{a.gain.toFixed(1)}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-[11px] leading-tight text-ink-3">
        {spent ? CHIP_NOTE[a.chip] : a.detail}
      </div>
    </div>
  )
}
