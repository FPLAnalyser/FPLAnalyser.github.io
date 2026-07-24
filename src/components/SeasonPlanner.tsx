import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TeamBadge } from './badges'
import { PlayerPhoto } from './PlayerPhoto'
import { Icon } from './Icon'
import { tapHaptic } from '../lib/native'
import { num } from '../lib/rows'
import { teamLabel, FDR_COLORS, playerHref } from '../lib/util'
import {
  type PlannerState, type WeekPlan, type Pos, type Chip, CHIP_LABEL,
  squadAt, freeTransfers, pointsHit, chipsUsed, autoLineup, toggleStarter,
} from '../lib/planner'
import type { FixtureEaseRow, RatingRow } from '../lib/types'

const BUDGET = 100
const MAX_PER_CLUB = 3
const POS_ORDER: Pos[] = ['GKP', 'DEF', 'MID', 'FWD']

/**
 * Week-by-week season planner: navigate gameweeks, set your XI / bench / captain
 * / chip for each, and make transfers between weeks (free transfers roll up to 5;
 * extras cost 4pts). The same engine will drive the My Team page. Persists to
 * localStorage, keyed to the base squad so a rebuild starts fresh.
 */
export function SeasonPlanner({ base, byEl, pool, fixtureEase, startGw }: {
  base: number[]
  byEl: Map<number, RatingRow>
  pool: RatingRow[]
  fixtureEase: FixtureEaseRow[]
  startGw: number
}) {
  const navigate = useNavigate()
  const posOf = (el: number) => String(byEl.get(el)?.position ?? 'MID') as Pos
  const ratingOf = (el: number) => (num(byEl.get(el) ?? {}, 'season_overall_score') ?? 0) * 20
  const priceOf = (el: number) => num(byEl.get(el) ?? {}, 'price') ?? 0
  const teamOf = (el: number) => String(byEl.get(el)?.team ?? '')
  const nameOf = (el: number) => String(byEl.get(el)?.web_name ?? '')

  const gws = useMemo(
    () => [...new Set(fixtureEase.map((f) => f.gw))].filter((g) => g >= startGw).sort((a, b) => a - b),
    [fixtureEase, startGw],
  )
  const [gw, setGw] = useState(startGw)
  const [sheet, setSheet] = useState<number | null>(null)     // element with the action sheet open
  const [transferOut, setTransferOut] = useState<number | null>(null) // element being replaced

  const sig = base.join(',')
  const [state, setState] = useState<PlannerState>(() => {
    try {
      const raw = localStorage.getItem('fpl_planner')
      if (raw) { const s = JSON.parse(raw); if (s.base?.join(',') === sig) return s }
    } catch { /* ignore */ }
    return { base: [...base], startGw, weeks: {} }
  })
  const persist = (s: PlannerState) => { setState(s); try { localStorage.setItem('fpl_planner', JSON.stringify(s)) } catch { /* ignore */ } }

  // Reset if the base squad changed since last time.
  useEffect(() => {
    if (state.base.join(',') !== sig) persist({ base: [...base], startGw, weeks: {} })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  // Lazily materialise the week we're viewing: carry the previous week's lineup
  // forward (if those players are still in the squad), else auto-pick a best XI.
  useEffect(() => {
    if (state.weeks[gw]) return
    const squad = squadAt(state, gw)
    const prev = [...Object.keys(state.weeks).map(Number)].filter((g) => g < gw).sort((a, b) => b - a)[0]
    let week: WeekPlan
    const prevWk = prev != null ? state.weeks[prev] : undefined
    if (prevWk && [...prevWk.xi, ...prevWk.bench].every((e) => squad.includes(e)) && prevWk.xi.length === 11) {
      week = { transfers: [], xi: [...prevWk.xi], bench: [...prevWk.bench], captain: prevWk.captain, vice: prevWk.vice, chip: null }
    } else {
      const lu = autoLineup(squad, posOf, ratingOf)
      week = { transfers: [], ...lu, chip: null }
    }
    persist({ ...state, weeks: { ...state.weeks, [gw]: week } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gw, state])

  const week = state.weeks[gw]
  const squad = useMemo(() => squadAt(state, gw), [state, gw])
  const ft = freeTransfers(state, gw)
  const hit = pointsHit(state, gw)
  const usedChips = chipsUsed(state)

  const fixtureAt = (team: string) => fixtureEase.find((f) => f.team === team && f.gw === gw) ?? null
  const clubCount = (team: string, exclude?: number) => squad.filter((e) => teamOf(e) === team && e !== exclude).length
  const spend = squad.reduce((s, e) => s + priceOf(e), 0)

  if (!week) return null

  const setWeek = (patch: Partial<WeekPlan>) => persist({ ...state, weeks: { ...state.weeks, [gw]: { ...week, ...patch } } })

  const makeCaptain = (el: number) => { tapHaptic('light'); setWeek({ captain: el, vice: week.vice === el ? week.captain : week.vice }); setSheet(null) }
  const makeVice = (el: number) => { tapHaptic('light'); setWeek({ vice: el, captain: week.captain === el ? week.vice : week.captain }); setSheet(null) }
  const toggle = (el: number) => {
    const res = toggleStarter(el, week.xi, week.bench, posOf)
    if (res) { tapHaptic('light'); setWeek(res) }
    setSheet(null)
  }
  const autoXI = () => { tapHaptic('medium'); setWeek({ ...autoLineup(squad, posOf, ratingOf) }) }
  const setChip = (c: Chip) => setWeek({ chip: week.chip === c ? null : c })

  // Transfers ────────────────────────────────────────────────────────────────
  const canReplace = (outEl: number, inEl: number): string | null => {
    if (squad.includes(inEl)) return 'Already in your squad'
    if (posOf(inEl) !== posOf(outEl)) return `Must be a ${posOf(outEl)}`
    if (teamOf(inEl) !== teamOf(outEl) && clubCount(teamOf(inEl), outEl) >= MAX_PER_CLUB) return `Max ${MAX_PER_CLUB} from ${teamLabel(teamOf(inEl))}`
    if (spend - priceOf(outEl) + priceOf(inEl) > BUDGET + 1e-9) return 'Over budget'
    return null
  }
  const doTransfer = (outEl: number, inEl: number) => {
    if (canReplace(outEl, inEl)) return
    tapHaptic('medium')
    const xi = week.xi.map((e) => (e === outEl ? inEl : e))
    const bench = week.bench.map((e) => (e === outEl ? inEl : e))
    const captain = week.captain === outEl ? inEl : week.captain
    const vice = week.vice === outEl ? inEl : week.vice
    const transfers = [...week.transfers.filter((t) => t.out !== outEl), { out: outEl, in: inEl }]
    setWeek({ transfers, xi, bench, captain, vice })
    setTransferOut(null)
  }
  const undoTransfer = (outEl: number) => {
    const t = week.transfers.find((x) => x.out === outEl)
    if (!t) return
    const xi = week.xi.map((e) => (e === t.in ? outEl : e))
    const bench = week.bench.map((e) => (e === t.in ? outEl : e))
    setWeek({ transfers: week.transfers.filter((x) => x.out !== outEl), xi, bench, captain: week.captain === t.in ? outEl : week.captain, vice: week.vice === t.in ? outEl : week.vice })
  }

  // XI projected rating (captain doubled, tripled on TC; bench boost adds bench).
  const projected = () => {
    const capMult = week.chip === 'triple-captain' ? 3 : 2
    const starters = week.chip === 'bench-boost' ? [...week.xi, ...week.bench] : week.xi
    let total = 0
    for (const e of starters) total += ratingOf(e) * (e === week.captain ? capMult : 1)
    return Math.round(total / 11)
  }

  const gwIdx = gws.indexOf(gw)
  const rowsByPos = (list: number[]) => POS_ORDER.map((p) => list.filter((e) => posOf(e) === p))

  return (
    <div>
      {/* Gameweek nav */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <button disabled={gwIdx <= 0} onClick={() => { setGw(gws[gwIdx - 1]); tapHaptic('select') }} className="grid size-10 place-items-center rounded-lg border border-line-mid text-ink-2 transition-colors hover:text-ink disabled:opacity-30"><Icon name="trend-down" size={16} className="-rotate-90" /></button>
        <div className="text-center">
          <div className="font-display text-xl font-bold text-ink">Gameweek {gw}</div>
          {gw === startGw ? <div className="text-[11px] text-ink-3">Set your opening team</div> : <div className="text-[11px] text-ink-3">{ft === Infinity ? '' : `${ft} free transfer${ft === 1 ? '' : 's'}`}{hit > 0 ? ` · −${hit} pts` : ''}</div>}
        </div>
        <button disabled={gwIdx >= gws.length - 1} onClick={() => { setGw(gws[gwIdx + 1]); tapHaptic('select') }} className="grid size-10 place-items-center rounded-lg border border-line-mid text-ink-2 transition-colors hover:text-ink disabled:opacity-30"><Icon name="trend-up" size={16} className="rotate-90" /></button>
      </div>

      {/* Summary + chips */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Squad value" value={`£${spend.toFixed(1)}m`} />
        <Stat label="In the bank" value={`£${(BUDGET - spend).toFixed(1)}m`} tone={spend > BUDGET ? 'bad' : 'ink'} />
        <Stat label="Transfers" value={`${week.transfers.length}${hit > 0 ? ` · −${hit}` : ''}`} tone={hit > 0 ? 'bad' : 'ink'} />
        <Stat label="Proj. XI" value={String(projected())} tone="accent" />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Chip</span>
        {(Object.keys(CHIP_LABEL) as Chip[]).map((c) => {
          const usedElsewhere = usedChips.has(c) && week.chip !== c
          return (
            <button key={c} disabled={usedElsewhere} onClick={() => setChip(c)} className={`min-h-8 rounded-full border px-2.5 text-xs font-medium transition-colors ${week.chip === c ? 'border-accent bg-accent-soft text-accent' : usedElsewhere ? 'border-line text-ink-3 opacity-40' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'}`}>{CHIP_LABEL[c]}</button>
          )
        })}
        <button onClick={autoXI} className="ml-auto inline-flex min-h-8 items-center gap-1 rounded-full border border-line-mid px-2.5 text-xs font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink"><Icon name="bolt" size={12} /> Auto-pick XI</button>
      </div>

      {/* Pitch */}
      <div className="relative overflow-hidden rounded-3xl p-3 md:p-5" style={{ background: 'radial-gradient(120% 80% at 50% 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.5) 100%), repeating-linear-gradient(90deg, #0e2117 0 9%, #10281c 9% 18%), linear-gradient(180deg, #10281c, #0c1c13)' }}>
        <div className="flex flex-col gap-3 md:gap-4">
          {rowsByPos(week.xi).map((row, i) => row.length > 0 && (
            <div key={i} className="flex flex-wrap justify-center gap-2 md:gap-3">
              {row.map((el) => <PlayerChip key={el} el={el} onOpen={() => setSheet(el)} captain={week.captain === el} vice={week.vice === el} fix={fixtureAt(teamOf(el))} rating={Math.round(ratingOf(el))} name={nameOf(el)} code={num(byEl.get(el) ?? {}, 'code')} element={el} transferred={week.transfers.some((t) => t.in === el)} />)}
            </div>
          ))}
        </div>
      </div>

      {/* Bench */}
      <div className="mt-3 rounded-2xl border border-line bg-surface-1/60 p-3">
        <div className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Bench {week.chip === 'bench-boost' && <span className="text-accent normal-case tracking-normal">· Bench Boost active — all 15 score</span>}</div>
        <div className="flex flex-wrap justify-center gap-2 md:gap-3">
          {week.bench.map((el) => <PlayerChip key={el} el={el} onOpen={() => setSheet(el)} captain={week.captain === el} vice={week.vice === el} fix={fixtureAt(teamOf(el))} rating={Math.round(ratingOf(el))} name={nameOf(el)} code={num(byEl.get(el) ?? {}, 'code')} element={el} transferred={week.transfers.some((t) => t.in === el)} bench />)}
        </div>
      </div>

      {gw > startGw && week.transfers.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5 rounded-2xl border border-line bg-surface-1/60 p-3 text-sm">
          <div className="text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Transfers this week</div>
          {week.transfers.map((t) => (
            <div key={t.out} className="flex items-center gap-2">
              <span className="text-bad">{nameOf(t.out)}</span><Icon name="trend-up" size={13} className="rotate-90 text-ink-3" /><span className="text-good">{nameOf(t.in)}</span>
              <button onClick={() => undoTransfer(t.out)} className="ml-auto text-xs text-ink-3 hover:text-ink">undo</button>
            </div>
          ))}
        </div>
      )}

      {/* Action sheet */}
      {sheet != null && (
        <ActionSheet
          el={sheet}
          name={nameOf(sheet)}
          isStarter={week.xi.includes(sheet)}
          isCaptain={week.captain === sheet}
          isVice={week.vice === sheet}
          canBench={gw >= startGw}
          onCaptain={() => makeCaptain(sheet)}
          onVice={() => makeVice(sheet)}
          onToggle={() => toggle(sheet)}
          onTransfer={() => { setTransferOut(sheet); setSheet(null) }}
          onView={() => navigate(playerHref(nameOf(sheet), num(byEl.get(sheet) ?? {}, 'code')))}
          onClose={() => setSheet(null)}
        />
      )}

      {/* Transfer picker */}
      {transferOut != null && (
        <TransferPicker
          outEl={transferOut}
          pool={pool}
          canReplace={(inEl) => canReplace(transferOut, inEl)}
          onPick={(inEl) => doTransfer(transferOut, inEl)}
          onClose={() => setTransferOut(null)}
          fixtureEase={fixtureEase}
          gw={gw}
        />
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ink' | 'bad' | 'accent' }) {
  const c = tone === 'bad' ? 'text-bad' : tone === 'accent' ? 'text-accent' : 'text-ink'
  return (
    <div className="rounded-xl border border-line bg-surface-1/60 p-2.5 text-center">
      <div className={`font-display text-lg leading-none tabular-nums ${c}`}>{value}</div>
      <div className="mt-1 text-[9px] font-semibold tracking-[0.1em] text-ink-2 uppercase">{label}</div>
    </div>
  )
}

function PlayerChip({ onOpen, captain, vice, fix, rating, name, code, element, transferred, bench }: {
  el: number; onOpen: () => void; captain: boolean; vice: boolean; fix: FixtureEaseRow | null; rating: number; name: string; code: number | null; element: number; transferred: boolean; bench?: boolean
}) {
  const [bg, fg] = fix ? (FDR_COLORS[fix.fdr] || FDR_COLORS[3]) : ['#39424E', '#E8EDF3']
  return (
    <button onClick={onOpen} className={`relative flex w-[86px] flex-col items-center rounded-xl border p-1.5 text-center transition-transform hover:-translate-y-0.5 ${bench ? 'border-line bg-surface-2/50' : 'border-white/10 bg-black/25'}`}>
      {(captain || vice) && <span className={`absolute -left-1.5 -top-1.5 z-10 grid size-5 place-items-center rounded-full text-[10px] font-bold ${captain ? 'bg-accent text-accent-contrast' : 'bg-surface-3 text-ink'}`}>{captain ? 'C' : 'V'}</span>}
      {transferred && <span className="absolute -right-1.5 -top-1.5 z-10 grid size-4 place-items-center rounded-full bg-good text-[9px] text-white"><Icon name="check" size={10} /></span>}
      <PlayerPhoto code={code} element={element} className="h-10 w-8 rounded object-cover object-top" placeholder={<div className="h-10 w-8 rounded bg-surface-3" />} />
      <div className="mt-1 w-full truncate text-[11px] font-semibold text-ink">{name}</div>
      <div className="mt-0.5 w-full truncate rounded px-1 text-[9px] font-semibold" style={{ background: bg, color: fg }}>{fix ? `${fix.opponent} (${fix.venue})` : 'No game'}</div>
      <div className="mt-0.5 font-num text-[11px] font-bold tabular-nums text-accent">{rating || '—'}</div>
    </button>
  )
}

function ActionSheet({ name, isStarter, isCaptain, isVice, canBench, onCaptain, onVice, onToggle, onTransfer, onView, onClose }: {
  el: number; name: string; isStarter: boolean; isCaptain: boolean; isVice: boolean; canBench: boolean; onCaptain: () => void; onVice: () => void; onToggle: () => void; onTransfer: () => void; onView: () => void; onClose: () => void
}) {
  const row = 'flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-ink transition-colors hover:bg-surface-2/60'
  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center" onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface-1 p-2" onClick={(e) => e.stopPropagation()}>
        <div className="px-3 py-2 text-sm font-bold text-ink">{name}</div>
        <button className={row} onClick={onCaptain}><Icon name="crown" size={16} /> {isCaptain ? 'Captain ✓' : 'Make captain'}</button>
        <button className={row} onClick={onVice}><Icon name="shield" size={16} /> {isVice ? 'Vice ✓' : 'Make vice-captain'}</button>
        {canBench && <button className={row} onClick={onToggle}><Icon name="pitch" size={16} /> {isStarter ? 'Move to bench' : 'Bring into XI'}</button>}
        <button className={row} onClick={onTransfer}><Icon name="users" size={16} /> Transfer out</button>
        <button className={row} onClick={onView}><Icon name="eye" size={16} /> View profile</button>
        <button className="w-full rounded-xl px-4 py-3 text-center text-sm font-semibold text-ink-3" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

function TransferPicker({ outEl, pool, canReplace, onPick, onClose, fixtureEase, gw }: {
  outEl: number; pool: RatingRow[]; canReplace: (inEl: number) => string | null; onPick: (inEl: number) => void; onClose: () => void; fixtureEase: FixtureEaseRow[]; gw: number
}) {
  const [q, setQ] = useState('')
  const outPos = pool.find((r) => r.element === outEl)?.position
  const rows = useMemo(() => {
    const nq = q.trim().toLowerCase()
    return pool
      .filter((r) => r.position === outPos && (!nq || String(r.web_name).toLowerCase().includes(nq)))
      .sort((a, b) => (num(b, 'season_overall_score') ?? 0) - (num(a, 'season_overall_score') ?? 0))
      .slice(0, 60)
  }, [pool, outPos, q])
  const fixAt = (team: string) => fixtureEase.find((f) => f.team === team && f.gw === gw)

  return (
    <div className="fixed inset-0 z-[210] flex flex-col bg-bg" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex items-center gap-2 border-b border-line p-3">
        <button onClick={onClose} className="grid size-9 place-items-center rounded-lg text-ink-2 hover:text-ink"><Icon name="x" size={18} /></button>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Replace with…" className="min-h-10 flex-1 rounded-lg border border-line-mid bg-surface-1 px-3 text-base text-ink outline-none placeholder:text-ink-3 md:text-sm" />
      </div>
      <div className="mx-auto w-full max-w-lg flex-1 overflow-y-auto">
        {rows.map((r) => {
          const why = canReplace(r.element)
          const f = fixAt(String(r.team))
          const o = num(r, 'season_overall_score')
          return (
            <div key={r.element} className="flex items-center gap-2.5 border-b border-line px-3 py-2">
              <TeamBadge team={String(r.team)} size={16} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{String(r.web_name)}</div>
                <div className="truncate text-[11px] text-ink-3">{teamLabel(String(r.team))} · £{(num(r, 'price') ?? 0).toFixed(1)}m{f ? ` · ${f.opponent} (${f.venue})` : ''}</div>
              </div>
              <span className="w-8 shrink-0 text-right font-num text-sm font-semibold tabular-nums text-ink-2">{o == null ? '—' : Math.round(o * 20)}</span>
              <button disabled={!!why} title={why ?? 'Transfer in'} onClick={() => onPick(r.element)} className={`grid size-8 shrink-0 place-items-center rounded-lg border transition-colors ${why ? 'cursor-not-allowed border-line text-ink-3 opacity-50' : 'border-accent/50 text-accent hover:bg-accent-soft'}`}><Icon name="check" size={15} /></button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
