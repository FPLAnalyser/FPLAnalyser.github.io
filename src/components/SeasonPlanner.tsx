import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { PlayerPhoto } from './PlayerPhoto'
import { FoilShell, Pitch, CARD_W, initialsOf, tierOf } from './Pitch'
import { availBadge, availFor, type Availability } from '../lib/availability'
import { xpForGw, useXpModel, useMarketOdds, gwBenchmark, gwRating } from '../lib/xp'
import { Icon } from './Icon'
import { tapHaptic } from '../lib/native'
import { num } from '../lib/rows'
import { FDR_COLORS, playerHref } from '../lib/util'
import { CHIP_LABEL, type Chip } from '../lib/planner'
import type { Planner } from '../lib/usePlanner'
import type { FixtureEaseRow, RatingRow } from '../lib/types'

const BUDGET = 100
const POS_ORDER = ['GKP', 'DEF', 'MID', 'FWD'] as const

/**
 * The board: one gameweek at a time, with the XI on the grass, the bench in
 * its own tray beneath it, and everything you can do to a player one tap away.
 * State lives in usePlanner so the picker alongside can transfer into it.
 */
export function SeasonPlanner({ planner, byEl, pool, fixtureEase, metric = 'rating', avail, onArmTransfer, armedOut }: {
  planner: Planner
  byEl: Map<number, RatingRow>
  pool: RatingRow[]
  fixtureEase: FixtureEaseRow[]
  /** What the card corner shows — rating, price or that week's xP. */
  metric?: 'rating' | 'price' | 'xp'
  avail?: Availability
  /** Arm a player for transfer; the picker beside the board completes it. */
  onArmTransfer?: (el: number) => void
  armedOut?: number | null
}) {
  const navigate = useNavigate()
  const xpModel = useXpModel()
  const market = useMarketOdds()
  const { gw, gws, setGw, startGw, week, ft, banked, hit, usedChips, spend } = planner

  const [sheet, setSheet] = useState<number | null>(null)
  // A pending substitution: the player tapped, waiting for their partner.
  const [subFor, setSubFor] = useState<number | null>(null)
  const [xpOpen, setXpOpen] = useState(false)

  const rowOf = (el: number) => byEl.get(el) ?? null
  const nameOf = (el: number) => String(rowOf(el)?.web_name ?? '')
  const teamOf = (el: number) => String(rowOf(el)?.team ?? '')
  const ratingOf = (el: number) => Math.round((num(rowOf(el) ?? {}, 'season_overall_score') ?? 0) * 20)
  const xpOf = (el: number, atGw = gw) => {
    const r = rowOf(el)
    return r ? xpForGw(r, atGw, fixtureEase, avail, xpModel, market) : null
  }
  const cornerOf = (el: number): string => {
    const r = rowOf(el)
    if (!r) return '—'
    if (metric === 'price') return num(r, 'price') != null ? `£${num(r, 'price')}` : '—'
    if (metric === 'xp') { const v = xpOf(el); return v == null ? '—' : v.toFixed(1) }
    const rt = ratingOf(el)
    return rt ? String(rt) : '—'
  }
  const fixturesFor = (team: string) => fixtureEase.filter((f) => f.team === team && f.gw >= gw).slice(0, 3)

  // What this week is projected to return, and how good that is.
  const capMult = week?.chip === 'triple-captain' ? 3 : 2
  const scoring = week ? (week.chip === 'bench-boost' ? [...week.xi, ...week.bench] : week.xi) : []
  const teamXp = useMemo(() => {
    if (!week) return null
    let total = 0
    let any = false
    for (const el of scoring) {
      const v = xpOf(el)
      if (v != null) { total += v * (el === week.captain ? capMult : 1); any = true }
    }
    return any ? total - hit : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, gw, xpModel, market, avail, hit])
  const benchmark = useMemo(
    () => gwBenchmark(pool, gw, fixtureEase, avail, xpModel, market),
    [pool, gw, fixtureEase, avail, xpModel, market],
  )
  const rating = teamXp == null ? null : gwRating(teamXp, benchmark)

  if (!week) return null

  const gwIdx = gws.indexOf(gw)
  const partners = subFor != null ? planner.partnersFor(subFor) : []
  const rowsByPos = (list: number[]) => POS_ORDER.map((p) => list.filter((e) => planner.posOf(e) === p))

  const beginSub = (el: number) => {
    setSheet(null)
    const opts = planner.partnersFor(el)
    if (!opts.length) return
    tapHaptic('light')
    setSubFor(el)
  }
  const completeSub = (partner: number) => {
    if (subFor == null) return
    if (planner.swap(subFor, partner)) tapHaptic('medium')
    setSubFor(null)
  }
  const onCardTap = (el: number) => {
    if (subFor != null) {
      if (partners.includes(el)) completeSub(el)
      else if (el === subFor) setSubFor(null)
      return
    }
    setSheet(el)
  }

  const chipActive = week.chip
  const benchBoost = chipActive === 'bench-boost'

  const card = (el: number, onBench: boolean) => (
    <PlayerChip
      key={el}
      onOpen={() => onCardTap(el)}
      captain={week.captain === el}
      vice={week.vice === el}
      fixtures={fixturesFor(teamOf(el))}
      rating={ratingOf(el)}
      corner={cornerOf(el)}
      flag={avail ? availBadge(availFor(avail, el, num(rowOf(el) ?? {}, 'code'))) : null}
      name={nameOf(el)}
      code={num(rowOf(el) ?? {}, 'code')}
      element={el}
      transferred={week.transfers.some((t) => t.in === el)}
      armedOut={armedOut === el}
      bench={onBench && !benchBoost}
      // During a substitution the legal partners glow and everything else dims.
      highlight={subFor != null && partners.includes(el)}
      dimmed={subFor != null && !partners.includes(el) && el !== subFor}
      picked={subFor === el}
    />
  )

  return (
    <div>
      {/* Gameweek nav */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <StepButton dir="prev" disabled={gwIdx <= 0} onClick={() => { setGw(gws[gwIdx - 1]); tapHaptic('select') }} />
        <div className="text-center">
          <div className="font-display text-xl font-bold text-ink">Gameweek {gw}</div>
          <div className="text-[11px] text-ink-3">
            {gw === startGw ? 'Your opening squad — transfers start next week' : <TransferLine ft={ft} banked={banked} used={week.transfers.length} hit={hit} chip={week.chip} />}
          </div>
        </div>
        <StepButton dir="next" disabled={gwIdx >= gws.length - 1} onClick={() => { setGw(gws[gwIdx + 1]); tapHaptic('select') }} />
      </div>

      {/* This week at a glance */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Projected points" value={teamXp == null ? '—' : teamXp.toFixed(1)} tone="accent" onClick={teamXp == null ? undefined : () => setXpOpen(true)} sub="tap for the breakdown" />
        <Stat label="GW rating" value={rating == null ? '—' : String(rating)} tone={rating != null && rating >= 70 ? 'good' : 'ink'} sub={rating == null ? '' : ratingWord(rating)} onClick={rating == null ? undefined : () => setXpOpen(true)} />
        <Stat label="Free transfers" value={ft === Infinity ? '∞' : `${Math.max(0, ft - week.transfers.length)}`} tone={hit > 0 ? 'bad' : 'ink'} sub={ft === Infinity ? (week.chip ? CHIP_LABEL[week.chip] : 'opening squad') : `${week.transfers.length} used${hit ? ` · −${hit}` : ''}`} />
        <Stat label="In the bank" value={`£${(BUDGET - spend).toFixed(1)}m`} tone={spend > BUDGET ? 'bad' : 'ink'} sub={`£${spend.toFixed(1)}m squad`} />
      </div>

      {/* Chips */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Chip</span>
        {(Object.keys(CHIP_LABEL) as Chip[]).map((c) => {
          const usedElsewhere = usedChips.has(c) && week.chip !== c
          return (
            <button key={c} disabled={usedElsewhere} onClick={() => planner.setChip(c)} className={`min-h-8 rounded-full border px-2.5 text-xs font-medium transition-colors ${week.chip === c ? 'border-accent bg-accent-soft text-accent' : usedElsewhere ? 'border-line text-ink-3 opacity-40' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'}`}>{CHIP_LABEL[c]}</button>
          )
        })}
        <button onClick={() => { tapHaptic('medium'); planner.autoXI() }} className="ml-auto inline-flex min-h-8 items-center gap-1 rounded-full border border-line-mid px-2.5 text-xs font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink"><Icon name="bolt" size={12} /> Auto-pick XI</button>
      </div>

      {subFor != null && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-accent">
          <Icon name="target" size={14} />
          <span className="font-medium">
            {planner.week?.xi.includes(subFor) ? `Who comes on for ${nameOf(subFor)}?` : `Who makes way for ${nameOf(subFor)}?`}
            {partners.length ? ' Tap a highlighted player.' : ' No legal swap — the formation won’t allow it.'}
          </span>
          <button onClick={() => setSubFor(null)} className="ml-auto text-xs font-semibold hover:underline">Cancel</button>
        </div>
      )}

      {/* The eleven, on the grass. The bench sits in its own tray below — it
          isn't on the pitch, so it shouldn't look like it is. */}
      <Pitch maxWidth={660}>
        {rowsByPos(week.xi).map((row, i) => row.length > 0 && (
          <div key={i} className="flex justify-center gap-1.5 sm:gap-2.5">{row.map((el) => card(el, false))}</div>
        ))}
      </Pitch>

      <div
        className={`mx-auto mt-2.5 rounded-2xl border px-3 py-2.5 transition-colors ${benchBoost ? 'border-accent bg-accent-soft' : 'border-line bg-surface-1/60'}`}
        style={{ maxWidth: 660 }}
      >
        <div className="mb-2 flex items-center gap-2">
          <span className={`text-[10px] font-extrabold tracking-[0.18em] uppercase ${benchBoost ? 'text-accent' : 'text-ink-3'}`}>Bench</span>
          {benchBoost
            ? <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-contrast">Bench Boost — all 15 score</span>
            : <span className="text-[10px] text-ink-3">order matters: first on is first sub</span>}
        </div>
        <div className="flex justify-center gap-1.5 sm:gap-2.5">{week.bench.map((el) => card(el, true))}</div>
      </div>

      {week.transfers.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5 rounded-2xl border border-line bg-surface-1/60 p-3 text-sm">
          <div className="text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Transfers this week</div>
          {week.transfers.map((t) => (
            <div key={t.out} className="flex items-center gap-2">
              <span className="text-bad">{nameOf(t.out)}</span>
              <Icon name="arrow-right" size={13} className="text-ink-3" />
              <span className="text-good">{nameOf(t.in)}</span>
              <button onClick={() => planner.undoTransfer(t.out)} className="ml-auto text-xs text-ink-3 hover:text-ink">undo</button>
            </div>
          ))}
        </div>
      )}

      {sheet != null && (
        <ActionSheet
          name={nameOf(sheet)}
          isStarter={week.xi.includes(sheet)}
          isCaptain={week.captain === sheet}
          isVice={week.vice === sheet}
          canSwap={planner.partnersFor(sheet).length > 0}
          onCaptain={() => { tapHaptic('light'); planner.makeCaptain(sheet); setSheet(null) }}
          onVice={() => { tapHaptic('light'); planner.makeVice(sheet); setSheet(null) }}
          onSwap={() => beginSub(sheet)}
          onTransfer={() => { onArmTransfer?.(sheet); setSheet(null) }}
          onView={() => navigate(playerHref(nameOf(sheet), num(rowOf(sheet) ?? {}, 'code')))}
          onClose={() => setSheet(null)}
        />
      )}

      {xpOpen && teamXp != null && (
        <XpSheet
          gw={gw} total={teamXp} rating={rating} benchmark={benchmark} hit={hit}
          rows={scoring.map((el) => ({ el, name: nameOf(el), xp: xpOf(el), captain: week.captain === el, bench: week.bench.includes(el) }))}
          capMult={capMult}
          onClose={() => setXpOpen(false)}
        />
      )}
    </div>
  )
}

const ratingWord = (r: number) => (r >= 85 ? 'elite week' : r >= 70 ? 'strong' : r >= 50 ? 'about par' : r >= 30 ? 'below par' : 'poor week')

function TransferLine({ ft, banked, used, hit, chip }: { ft: number; banked: number; used: number; hit: number; chip: Chip | null }) {
  if (ft === Infinity) return <span className="font-semibold text-accent">{chip ? `${CHIP_LABEL[chip]} — unlimited transfers` : 'Unlimited transfers'}</span>
  const left = Math.max(0, ft - used)
  return (
    <span>
      {left} of {banked} free transfer{banked === 1 ? '' : 's'} left
      {used > 0 ? ` · ${used} made` : ''}
      {hit > 0 ? <span className="text-bad"> · −{hit} pts</span> : ''}
    </span>
  )
}

function StepButton({ dir, disabled, onClick }: { dir: 'prev' | 'next'; disabled: boolean; onClick: () => void }) {
  return (
    <button
      aria-label={dir === 'prev' ? 'Previous gameweek' : 'Next gameweek'}
      disabled={disabled}
      onClick={onClick}
      className="grid size-10 shrink-0 place-items-center rounded-full border border-accent/45 text-accent transition-colors hover:border-accent hover:bg-accent-soft disabled:border-line disabled:text-ink-3 disabled:opacity-35 disabled:hover:bg-transparent"
    >
      <Icon name={dir === 'prev' ? 'chevron-left' : 'chevron-right'} size={18} />
    </button>
  )
}

function Stat({ label, value, tone, sub, onClick }: { label: string; value: string; tone?: 'ink' | 'bad' | 'good' | 'accent'; sub?: string; onClick?: () => void }) {
  const c = tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : tone === 'accent' ? 'text-accent' : 'text-ink'
  const inner = (
    <>
      <div className={`font-display text-lg leading-none tabular-nums ${c}`}>{value}</div>
      <div className="mt-1 text-[9px] font-semibold tracking-[0.1em] text-ink-2 uppercase">{label}</div>
      {sub && <div className="mt-0.5 truncate text-[9.5px] text-ink-3">{sub}</div>}
    </>
  )
  const cls = 'w-full rounded-xl border border-line bg-surface-1/60 p-2.5 text-center'
  return onClick
    ? <button onClick={onClick} className={`${cls} transition-colors hover:border-accent/50 hover:bg-accent-soft/40`}>{inner}</button>
    : <div className={cls}>{inner}</div>
}

function PlayerChip({ onOpen, captain, vice, fixtures, rating, corner, flag, name, code, element, transferred, bench, highlight, dimmed, picked, armedOut }: {
  onOpen: () => void; captain: boolean; vice: boolean; fixtures: FixtureEaseRow[]; rating: number
  corner: string; flag?: { label: string; tone: 'bad' | 'warn' | 'flat'; title: string } | null
  name: string; code: number | null; element: number; transferred: boolean; bench?: boolean
  highlight?: boolean; dimmed?: boolean; picked?: boolean; armedOut?: boolean
}) {
  const next = fixtures[0]
  const [bg, fg] = next ? (FDR_COLORS[next.fdr] || FDR_COLORS[3]) : ['#39424E', '#E8EDF3']
  return (
    <span className={`${CARD_W} relative transition-opacity ${dimmed ? 'opacity-30' : ''}`}>
      {(captain || vice) && <span className={`absolute -top-1.5 -left-1.5 z-10 grid size-5 place-items-center rounded-full text-[10px] font-bold ${captain ? 'bg-accent text-accent-contrast' : 'bg-surface-3 text-ink'}`}>{captain ? 'C' : 'V'}</span>}
      {transferred && <span className="absolute -top-1.5 -right-1.5 z-10 grid size-4 place-items-center rounded-full bg-good text-[9px] text-white"><Icon name="check" size={10} /></span>}
      {armedOut && <span className="absolute -top-1.5 -right-1.5 z-10 rounded-full bg-bad px-1.5 py-0.5 text-[8px] font-bold text-white">OUT</span>}
      <FoilShell
        tier={bench ? 'graphite' : tierOf(rating || null)}
        onClick={onOpen}
        className={`w-full ${highlight ? 'ring-2 ring-accent ring-offset-1 ring-offset-transparent' : ''} ${picked ? 'ring-2 ring-bad' : ''}`}
        innerClassName="px-1 pt-1 pb-1.5 sm:px-1.5"
      >
        {flag && (
          <span title={flag.title} className={`absolute top-1 left-1 z-10 rounded px-1 py-0.5 text-[7.5px] leading-none font-extrabold tracking-wide ${flag.tone === 'bad' ? 'bg-bad text-white' : 'bg-warn text-black'}`}>{flag.label}</span>
        )}
        <span className="photo-slot relative mx-auto block h-9 w-8 sm:h-11 sm:w-10">
          <span className="photo-mono absolute inset-0 place-items-center text-[11px] font-extrabold text-white/35">{initialsOf(name)}</span>
          <PlayerPhoto code={code} element={element} className="relative h-full w-full object-contain object-top" placeholder={<span className="grid h-full w-full place-items-center text-[11px] font-extrabold text-white/35">{initialsOf(name)}</span>} />
        </span>
        <span className="capture-line mt-1 block w-full truncate text-[9.5px] leading-tight font-bold text-white sm:text-[11px]">{name}</span>
        <span className="mt-0.5 block w-full truncate rounded px-1 text-[8.5px] font-bold sm:text-[9px]" style={{ background: bg, color: fg }}>{next ? `${next.opponent} (${next.venue})` : 'No game'}</span>
        {/* The run after this one — the reason to hold or sell, on the card. */}
        {fixtures.length > 1 && (
          <span className="mt-0.5 hidden w-full gap-0.5 sm:flex">
            {fixtures.slice(1).map((f, i) => {
              const [b, t] = FDR_COLORS[f.fdr] || FDR_COLORS[3]
              return <span key={i} className="min-w-0 flex-1 truncate rounded px-0.5 text-center text-[7.5px] font-bold" style={{ background: b, color: t }}>{f.opponent}</span>
            })}
          </span>
        )}
        <span className="tier-num font-num mt-0.5 block text-[10px] font-extrabold tabular-nums sm:text-[12px]">{corner}</span>
      </FoilShell>
    </span>
  )
}

/** Overlays go through a portal: the board sits inside cards that create
 *  stacking contexts, and a sheet rendered inside one of those can end up
 *  painted underneath the pitch. */
function Overlay({ children, onClose, z = 200 }: { children: React.ReactNode; onClose: () => void; z?: number }) {
  return createPortal(
    <div className="fixed inset-0 flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center" style={{ zIndex: z }} onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface-1 p-2" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body,
  )
}

function ActionSheet({ name, isStarter, isCaptain, isVice, canSwap, onCaptain, onVice, onSwap, onTransfer, onView, onClose }: {
  name: string; isStarter: boolean; isCaptain: boolean; isVice: boolean; canSwap: boolean
  onCaptain: () => void; onVice: () => void; onSwap: () => void; onTransfer: () => void; onView: () => void; onClose: () => void
}) {
  const row = 'flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-ink transition-colors hover:bg-surface-2/60 disabled:opacity-40'
  return (
    <Overlay onClose={onClose}>
      <div className="px-3 py-2 text-sm font-bold text-ink">{name}</div>
      <button className={row} onClick={onCaptain}><Icon name="crown" size={16} /> {isCaptain ? 'Captain ✓' : 'Make captain'}</button>
      <button className={row} onClick={onVice}><Icon name="shield" size={16} /> {isVice ? 'Vice ✓' : 'Make vice-captain'}</button>
      <button className={row} onClick={onSwap} disabled={!canSwap}>
        <Icon name="pitch" size={16} /> {isStarter ? 'Substitute — pick who comes on' : 'Bring on — pick who makes way'}
      </button>
      <button className={row} onClick={onTransfer}><Icon name="users" size={16} /> Transfer out</button>
      <button className={row} onClick={onView}><Icon name="eye" size={16} /> View profile</button>
      <button className="w-full rounded-xl px-4 py-3 text-center text-sm font-semibold text-ink-3" onClick={onClose}>Cancel</button>
    </Overlay>
  )
}

function XpSheet({ gw, total, rating, benchmark, hit, rows, capMult, onClose }: {
  gw: number; total: number; rating: number | null; benchmark: { floor: number; ceiling: number } | null; hit: number
  rows: { el: number; name: string; xp: number | null; captain: boolean; bench: boolean }[]
  capMult: number; onClose: () => void
}) {
  const sorted = [...rows].sort((a, b) => (b.xp ?? 0) * (b.captain ? capMult : 1) - (a.xp ?? 0) * (a.captain ? capMult : 1))
  return (
    <Overlay onClose={onClose} z={210}>
      <div className="max-h-[80vh] overflow-y-auto">
        <div className="flex items-baseline gap-2 px-3 py-2">
          <span className="font-display text-lg font-bold text-ink">Gameweek {gw}</span>
          <span className="ml-auto font-display text-2xl font-bold text-accent tabular-nums">{total.toFixed(1)}</span>
        </div>
        <p className="px-3 pb-2 text-xs text-ink-3">
          Projected points for the players who score this week, captain counted {capMult === 3 ? 'three times' : 'twice'}
          {hit > 0 ? `, less the ${hit}-point transfer hit` : ''}.
          {rating != null && benchmark && (
            <> Rated <span className="font-semibold text-ink-2">{rating}</span> — where that total sits between an XI of median
            players ({benchmark.floor.toFixed(0)}) and the best XI available this week ({benchmark.ceiling.toFixed(0)}).</>
          )}
        </p>
        <div className="border-t border-line">
          {sorted.map((r) => (
            <div key={r.el} className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm last:border-0">
              <span className="min-w-0 flex-1 truncate text-ink">{r.name}</span>
              {r.captain && <span className="rounded bg-accent px-1 text-[9px] font-bold text-accent-contrast">C</span>}
              {r.bench && <span className="rounded bg-surface-3 px-1 text-[9px] font-bold text-ink-3">BENCH</span>}
              <span className="font-num w-12 text-right tabular-nums text-ink-2">{r.xp == null ? '—' : (r.xp * (r.captain ? capMult : 1)).toFixed(1)}</span>
            </div>
          ))}
        </div>
      </div>
      <button className="mt-1 w-full rounded-xl px-4 py-3 text-center text-sm font-semibold text-ink-3" onClick={onClose}>Close</button>
    </Overlay>
  )
}
