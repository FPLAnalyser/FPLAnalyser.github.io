import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PlayerPhoto } from './PlayerPhoto'
import { FoilShell, Pitch, BenchSpine, CARD_W, initialsOf, tierOf, nameSize } from './Pitch'
import { PlayerCardSheet } from './PlayerCardSheet'
import { availBadge, availFor, SEV_COLOUR, type Availability } from '../lib/availability'
import { xpForGw, useXpModel, useMarketOdds, gwBenchmark, gwRating, type XpModel, type MarketOdds } from '../lib/xp'
import { autoLineup } from '../lib/planner'
import { Icon } from './Icon'
import { tapHaptic } from '../lib/native'
import { num } from '../lib/rows'
import { FDR_COLORS } from '../lib/util'
import { CHIP_LABEL, type Chip } from '../lib/planner'
import type { Planner } from '../lib/usePlanner'
import type { AvailBadgeInfo } from '../lib/availability'
import type { FixtureEaseRow, RatingRow } from '../lib/types'

const BUDGET = 100
/** How wide the board runs. The pitch and everything stacked above and
 *  below it share this, so they line up as one column.
 *
 *  680, not 860. The player cards cap at 136px and stop growing, so five
 *  across an 860px board were sitting in 172px of space and using 136 of it —
 *  the rest was green. That width was worth more to the Squad Lab beside it,
 *  which was dividing a 440px column five ways and truncating its own headline
 *  numbers to "7 of…" and "B.F…". At 680 the cards land on 128px, eight inside
 *  their cap, and the column they paid for goes to 660. */
const BOARD_W = 680
const POS_ORDER = ['GKP', 'DEF', 'MID', 'FWD'] as const

/**
 * The board: one gameweek at a time, the XI on the grass, the bench in its own
 * dugout beneath it, and every action on a player one tap away. State lives in
 * usePlanner so the list beside the board can transfer into it.
 */

/* How much the last pick moved the number.
 *
 * The strip has always shown where the squad IS. What it never showed is what
 * the thing you just did was worth — so building a fifteen was a sequence of
 * guesses with the score only readable at the end. This closes that loop.
 *
 * Two rules keep it honest. It reports on a change to the SQUAD, so stepping
 * to another gameweek clears it rather than presenting a different fixture
 * list as if it were your decision. And it holds the last real delta until
 * the next one, so the answer is still there after you have looked away. */
function useSquadDelta(value: number | null, squadSig: string, gw: number, ready: boolean, plan: string) {
  const [delta, setDelta] = useState<number | null>(null)
  const base = useRef({ sig: squadSig, gw, value, plan, settling: false })
  useEffect(() => {
    /* Another gameweek is a different fixture list, and another plan is
       somebody else's decisions — neither is a thing you just did. Forking
       made the second case one click away: the branch keeps the same fifteen
       but re-decides the week, so the projection moves without the squad
       signature moving, and the board read "+7.2 since your last change" for
       a change nobody had made.

       Re-baselining ONCE on the switch is not enough, and this was measured:
       a plan's weeks load an effect later than the click that selected it, so
       the value captured at the switch is still the OLD plan's, and the new
       one's first figure then reads as a change. It read "+8.4" for clicking
       Plan B. So the switch opens a settling window instead — the baseline
       follows the number until it stops moving, and only then arms. */
    if (base.current.gw !== gw || base.current.plan !== plan) {
      base.current = { sig: squadSig, gw, value, plan, settling: true }
      setDelta(null)
      return
    }
    /* A swap is two actions — the man leaves, then his replacement arrives —
       and in between the squad is fourteen, the week cannot be built and the
       projection is null. The baseline only moves on a complete fifteen, so a
       delta always compares one finished squad with another. */
    if (!ready) return
    if (base.current.settling) {
      base.current = { ...base.current, sig: squadSig, value }
      const t = setTimeout(() => { base.current = { ...base.current, settling: false } }, 400)
      return () => clearTimeout(t)
    }
    if (base.current.sig === squadSig) {
      base.current = { ...base.current, value }
      return
    }
    /* And it waits for the number to stop moving. Adding the fifteenth player
       rebuilds the week, and the projection lands before the auto-lineup and
       the armband have settled — measured live it read +3.3 on a swap that was
       actually worth -1.1, because it compared against a transient. Each new
       value re-arms this timer, so the delta is taken once the figure has held
       still, which is also the moment it is worth reading. */
    const before = base.current.value
    const t = setTimeout(() => {
      base.current = { sig: squadSig, gw, value, plan, settling: false }
      setDelta(before != null && value != null ? value - before : null)
    }, 400)
    return () => clearTimeout(t)
  }, [squadSig, gw, value, ready, plan])
  return delta
}

export function SeasonPlanner({ planner, byEl, pool, fixtureEase, metric = 'rating', avail, onSold, squadScore, onOpenSquadRating, partialSquad, onRemovePick, onPickSlot, footer, statsSlot, onFork }: {
  planner: Planner
  byEl: Map<number, RatingRow>
  pool: RatingRow[]
  fixtureEase: FixtureEaseRow[]
  /** What the card corner shows — rating, price or that week's xP. */
  metric?: 'rating' | 'price' | 'xp'
  avail?: Availability
  /** A player was just put on the market — the page swings the picker round
   *  to his position so the empty place is one glance away. */
  onSold?: (el: number) => void
  /** The squad's own 0–100 rating, shown here so the page needn't repeat it. */
  squadScore?: number | null
  onOpenSquadRating?: () => void
  /** While the fifteen is incomplete the planner can't run, so the board
   *  lays out whoever has been picked against empty slots — same page,
   *  same furniture, just not full yet. */
  partialSquad?: number[]
  /** Drop a player from a squad that isn't fifteen yet. There is no transfer
   *  to make and nothing to undo — he simply comes off the board again, which
   *  is why this is separate from the sell path below. Without it the × only
   *  ever appeared once the fifteen was complete, so while you were building
   *  one a mistake could only be fixed from the list. */
  onRemovePick?: (el: number) => void
  onPickSlot?: (pos: 'GKP' | 'DEF' | 'MID' | 'FWD') => void
  /** Squad-level actions (share, clear) — under the bench rather than in a
   *  band of their own above the board, which spent a whole section on two
   *  buttons you only reach for once the fifteen is built. */
  footer?: React.ReactNode
  /** Where to draw the week's four numbers. On a wide screen the page hands
   *  down a node in the right-hand column and they are portalled there, which
   *  buys back the full-width row they used to occupy and puts them beside the
   *  team they describe rather than above it. Null on a phone, where that
   *  column stacks BELOW the board and the numbers are worth more above it —
   *  so they stay inline. The state and the two detail sheets never move, so
   *  there is still one place computing them. */
  statsSlot?: HTMLElement | null
  /** Branch the plan at the week on screen. Omitted where there is nowhere to
   *  branch into — the library is full — and hidden at the opening week,
   *  where a fork with nothing before it is just Duplicate. */
  onFork?: (gw: number) => void
}) {
  const xpModel = useXpModel()
  const market = useMarketOdds()
  const { gw, gws, setGw, week, ft, banked, hit, spend } = planner

  const [sheet, setSheet] = useState<number | null>(null)
  const [subFor, setSubFor] = useState<number | null>(null)
  const [detail, setDetail] = useState<'xp' | 'rating' | null>(null)

  const rowOf = (el: number) => byEl.get(el) ?? null
  const nameOf = (el: number) => String(rowOf(el)?.web_name ?? '')
  const teamOf = (el: number) => String(rowOf(el)?.team ?? '')
  const ratingOf = (el: number) => Math.round((num(rowOf(el) ?? {}, 'season_overall_score') ?? 0) * 20)
  const xpOf = (el: number) => {
    const r = rowOf(el)
    return r ? xpForGw(r, gw, fixtureEase, avail, xpModel, market) : null
  }
  const cornerOf = (el: number): string => {
    const r = rowOf(el)
    if (!r) return '—'
    if (metric === 'price') { const p = num(r, 'price'); return p == null ? '—' : `£${p.toFixed(1)}m` }
    if (metric === 'xp') { const v = xpOf(el); return v == null ? '—' : v.toFixed(1) }
    const rt = ratingOf(el)
    return rt ? String(rt) : '—'
  }
  const fixturesFor = (team: string) => fixtureEase.filter((f) => f.team === team && f.gw >= gw).slice(0, 3)

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

  const gwIdx = gws.indexOf(gw)
  const partners = subFor != null && week ? planner.partnersFor(subFor) : []
  const rowsByPos = (list: number[]) => POS_ORDER.map((p) => list.filter((e) => planner.posOf(e) === p))
  // The stored order IS the drawn order — reserve keeper first, the way the
  // FPL app lists him and the way a teamsheet reads. It used to be sorted
  // here instead, which left the array and the row disagreeing about which
  // slot was the first one.
  const benchOrder = week ? week.bench : []

  // Without a full fifteen the planner has nothing to plan, so the board
  // lays the picked players into the same shape and leaves the rest as
  // empty slots — the page never changes character, it just fills up.
  const partial = !week ? layoutPartial(partialSquad ?? [], planner.posOf, (el) => ratingOf(el)) : null
  const picked = partialSquad?.length ?? 0

  /* Both boards feed the same signature: a full week names its eleven and
     bench, a part-built squad is just the list so far. */
  const squadSig = useMemo(() => {
    const list = week ? [...week.xi, ...week.bench] : (partialSquad ?? [])
    return [...list].sort((a, b) => a - b).join(',')
  }, [week, partialSquad])
  const complete = Boolean(week)
  const xpDelta = useSquadDelta(teamXp, squadSig, gw, complete, planner.store)
  const scoreDelta = useSquadDelta(squadScore ?? null, squadSig, gw, complete, planner.store)

  /* When the two headline numbers move opposite ways, that IS the trade you
     just made, and it is worth one sentence — a rating is season-long quality
     and a projection is this week with the fixture applied, so a swap can
     easily be up on one and down on the other. Below these thresholds the
     move is noise and gets no commentary. */
  const trade = (() => {
    if (xpDelta == null || scoreDelta == null) return null
    if (Math.abs(xpDelta) < 0.1 || Math.abs(scoreDelta) < 1) return null
    if (xpDelta > 0 && scoreDelta < 0) return 'Points up, rating down — you traded season-long quality for this week\u2019s fixture.'
    if (xpDelta < 0 && scoreDelta > 0) return 'Rating up, points down — a better footballer into a worse week.'
    if (xpDelta > 0) return 'Up on both — a straight upgrade rather than a trade-off.'
    return 'Down on both. Worth a second look before you leave it.'
  })()

  const beginSub = (el: number) => {
    setSheet(null)
    if (!planner.partnersFor(el).length) return
    tapHaptic('light')
    setSubFor(el)
  }
  const onCardTap = (el: number) => {
    if (subFor != null) {
      if (partners.includes(el)) { if (planner.swap(subFor, el)) tapHaptic('medium'); setSubFor(null) }
      else if (el === subFor) setSubFor(null)
      return
    }
    setSheet(el)
  }

  const benchBoost = week?.chip === 'bench-boost'
  const tripleCap = week?.chip === 'triple-captain'
  const ftLeft = ft === Infinity ? Infinity : Math.max(0, ft - (week?.transfers.filter((t) => t.in != null).length ?? 0))

  const card = (el: number, onBench: boolean) => (
    <PlayerChip
      key={el}
      onOpen={() => onCardTap(el)}
      captain={week?.captain === el}
      vice={week?.vice === el}
      tripleCap={tripleCap}
      fixtures={fixturesFor(teamOf(el))}
      rating={ratingOf(el)}
      corner={cornerOf(el)}
      flag={avail ? availBadge(availFor(avail, el, num(rowOf(el) ?? {}, 'code'))) : null}
      name={nameOf(el)}
      code={num(rowOf(el) ?? {}, 'code')}
      element={el}
      /* Nothing arrives by transfer at the opening week — you are picking a
         squad, so a green "signed this week" tick on eleven of the fifteen
         was marking the act of building it. */
      transferred={!planner.opening && !!week?.transfers.some((t) => t.in === el)}
      sold={planner.pendingOut.includes(el)}
      onSell={week
        ? () => {
            const isSold = planner.pendingOut.includes(el)
            tapHaptic(isSold ? 'light' : 'medium')
            if (isSold) planner.undoTransfer(el)
            else { planner.sell(el); onSold?.(el) }
          }
        : onRemovePick
          ? () => { tapHaptic('light'); onRemovePick(el) }
          : undefined}
      sellVerb={week && !planner.opening ? 'Sell' : 'Remove'}
      bench={onBench && !benchBoost}
      highlight={subFor != null && partners.includes(el)}
      dimmed={subFor != null && !partners.includes(el) && el !== subFor}
      picked={subFor === el}
    />
  )

  const statTiles = (
    <>
      <Stat label="Projected points" value={teamXp == null ? '—' : teamXp.toFixed(1)} tone="accent" sub={week ? 'what this XI should score' : `${picked}/15 picked`} delta={xpDelta} dp={1} onClick={teamXp == null || !week ? undefined : () => setDetail('xp')} />
      <Stat label="GW rating" value={rating == null ? '—' : String(rating)} tone={ratingTone(rating)} sub={rating == null ? 'complete your squad' : ratingWord(rating)} onClick={rating == null ? undefined : () => setDetail('rating')} />
      <Stat label="Squad rating" value={squadScore == null ? '—' : String(squadScore)} tone="accent" sub="what you've built" delta={scoreDelta} dp={0} onClick={squadScore == null ? undefined : onOpenSquadRating} />
      <Stat label="In the bank" value={`£${(BUDGET - spend).toFixed(1)}m`} tone={spend > BUDGET ? 'bad' : 'ink'} sub={`£${spend.toFixed(1)}m squad`} />
    </>
  )

  return (
    <div>
      {/* Everything above the pitch is held to the pitch's own width, so the
          page reads as one column instead of a wide band of boxes. */}
      <div className="mx-auto" style={{ maxWidth: BOARD_W }}>
        {/* Gameweek nav */}
        <div className="mb-3 flex items-center justify-between gap-3">
          <StepButton dir="prev" disabled={gwIdx <= 0} onClick={() => { setGw(gws[gwIdx - 1]); tapHaptic('select') }} />
          {/* Fork sits on the gameweek, not in the plan bar, because it is a
              gameweek-scoped action: it means "from HERE, try something else".
              A Fork button next to Duplicate would have to name the week it
              cut at, and by then you have said the same thing twice. */}
          <div className="flex items-center gap-2">
            <div className="font-display text-xl font-bold text-ink">Gameweek {gw}</div>
            {onFork && !planner.opening && (
              <button
                onClick={() => { tapHaptic('medium'); onFork(gw) }}
                title={`Copy this plan up to GW${gw - 1} into a new one, and re-decide GW${gw} onwards`}
                className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-line-mid px-2 text-[11px] font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
              >
                <Icon name="target" size={12} /> Fork
              </button>
            )}
          </div>
          <StepButton dir="next" disabled={gwIdx >= gws.length - 1} onClick={() => { setGw(gws[gwIdx + 1]); tapHaptic('select') }} />
        </div>

        <GameweekStrip
          planner={planner}
          byEl={byEl}
          engine={{ fixtureEase, avail, model: xpModel, market }}
          current={gw}
          onPick={setGw}
          ratingOf={ratingOf}
        />

        {/* The week's four numbers. Same element either way — only its
            parent changes. */}
        {statsSlot
          ? createPortal(<div className="grid grid-cols-2 gap-2">{statTiles}</div>, statsSlot)
          : <div className="mb-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">{statTiles}</div>}

        {trade && (
          <div className="mb-2.5 rounded-xl border border-line bg-surface-1/60 px-3 py-2 text-[12px] leading-snug text-ink-2">
            <span className="mr-1.5 text-[10px] font-bold tracking-[0.11em] text-ink-3 uppercase">Your last move</span>
            {trade}
          </div>
        )}

        {/* Transfers — above the pitch, where you can act on them. At the
            opening week there are none to have, so there is no count to keep:
            the pitch already shows how many places are filled, and the line
            beside it says how many are left in words. The "15/15" chip that
            used to sit here was the same fact a third time. */}
        <div className="mb-2.5 rounded-2xl border border-line bg-surface-1/60 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">{week && !planner.opening ? 'Transfers' : 'Squad'}</span>
            {week && !planner.opening && (
              <span className={`font-num rounded-md px-2 py-0.5 text-sm font-bold tabular-nums ${hit > 0 ? 'bg-bad/15 text-bad' : 'bg-surface-3 text-ink'}`}>
                {ft === Infinity ? `${week.transfers.filter((t) => t.in != null).length} · unlimited` : `${week.transfers.filter((t) => t.in != null).length}/${banked}`}
              </span>
            )}
            {!week
              ? <span className="text-xs text-ink-3">Pick {15 - picked} more from the list{picked === 0 ? ' — or hit Auto pick' : ''}</span>
              : planner.opening
                ? <span className="text-xs text-ink-3">{week.chip ? `${CHIP_LABEL[week.chip]} — ` : ''}Building your opening squad — changes are free until the season starts</span>
                : ft === Infinity
                  ? <span className="text-xs font-semibold text-accent">{week.chip ? CHIP_LABEL[week.chip] : 'Free hit'} — no limit</span>
                  : <span className="text-xs text-ink-3">{ftLeft} free left{hit > 0 ? <span className="font-semibold text-bad"> · −{hit} pts</span> : ''}</span>}
            {week && !planner.opening && week.transfers.length === 0 && <span className="ml-auto text-xs text-ink-3">Tap ✕ on a player to sell him</span>}
            {week && planner.pendingOut.length > 0 && (
              <span className="ml-auto text-xs font-semibold text-accent">
                £{(BUDGET - spend).toFixed(1)}m to spend on {planner.pendingOut.length} {planner.pendingOut.length === 1 ? 'place' : 'places'}
              </span>
            )}
          </div>
        </div>

        {subFor != null && week && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-accent">
            <Icon name="target" size={14} />
            <span className="font-medium">
              {week.xi.includes(subFor) ? `Who comes on for ${nameOf(subFor)}?` : `Who makes way for ${nameOf(subFor)}?`}
              {partners.length ? ' Tap a highlighted player.' : ' No legal swap — the formation won’t allow it.'}
            </span>
            <button onClick={() => setSubFor(null)} className="ml-auto text-xs font-semibold hover:underline">Cancel</button>
          </div>
        )}
      </div>

      {/* The pending-transfer list lives BELOW the board, not above it.
          Above, it grew the header by 37px the instant you sold somebody —
          measured at 1440 — which pushed the pitch down by the same amount and
          left the restore button 37px clear of a mouse pointer that had not
          moved. The one control you want after selling a player is the one to
          put him back, and it has to still be under the cursor that sold him.
          Nothing above the board changes height any more, so it isn't. */}
      <Pitch maxWidth={BOARD_W}>
        {(week ? rowsByPos(week.xi).map((row) => row.map((el) => ({ el }))) : partial!.xi).map((row, i) => row.length > 0 && (
          <div key={i} className="flex justify-center gap-1.5 sm:gap-2.5">
            {row.map((slot, j) => (slot.el != null
              ? card(slot.el, false)
              : <EmptySlot key={`e${j}`} pos={(slot as { pos: 'GKP' | 'DEF' | 'MID' | 'FWD' }).pos} onClick={() => onPickSlot?.((slot as { pos: 'GKP' | 'DEF' | 'MID' | 'FWD' }).pos)} />))}
          </div>
        ))}
      </Pitch>

      <BenchSpine boosted={benchBoost} maxWidth={BOARD_W}>
        {week
          ? benchOrder.map((el) => card(el, true))
          : partial!.bench.map((slot, j) => (slot.el != null
              ? card(slot.el, true)
              : <EmptySlot key={`be${j}`} pos={slot.pos} onClick={() => onPickSlot?.(slot.pos)} />))}
      </BenchSpine>

      {week && !planner.opening && week.transfers.length > 0 && (
        <div className="mx-auto mt-2.5" style={{ maxWidth: BOARD_W }}>
          <div className="rounded-2xl border border-line bg-surface-1/60 px-3 py-2.5">
            <div className="mb-1.5 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">This week's transfers</div>
            <div className="flex flex-col gap-1">
              {week.transfers.map((t) => (
                <div key={t.out} className="flex items-center gap-2 text-sm">
                  <span className="truncate text-bad">{nameOf(t.out)}</span>
                  <Icon name="arrow-right" size={13} className="shrink-0 text-ink-3" />
                  {t.in == null
                    ? <span className="truncate text-ink-3 italic">pick a {planner.posOf(t.out)} from the list</span>
                    : <span className="truncate text-good">{nameOf(t.in)}</span>}
                  <button onClick={() => planner.undoTransfer(t.out)} className="ml-auto shrink-0 text-xs text-ink-3 hover:text-ink">
                    {t.in == null ? 'keep him' : 'undo'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Chips sit under the board, not above it. Everything that used to
          stack here — the read, the chips — pushed the eleven you are picking
          about six hundred pixels down a laptop screen, which is the one
          thing the page exists to show. The chip you play is a decision you
          make after looking at the team, not before. */}
      <div className="mx-auto" style={{ maxWidth: BOARD_W }}>
        <div className="mt-2.5 mb-2.5 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Chip</span>
          {(Object.keys(CHIP_LABEL) as Chip[]).map((c) => {
            const spentAt = planner.chipSpent(c)
            const usedElsewhere = spentAt != null && spentAt !== gw
            return (
              <button
                key={c}
                disabled={!week || usedElsewhere}
                onClick={() => planner.setChip(c)}
                title={usedElsewhere ? `Played in GW${spentAt} — your ${planner.half === 1 ? 'first' : 'second'}-half ${CHIP_LABEL[c]}` : undefined}
                className={`min-h-8 rounded-full border px-2.5 text-xs font-medium transition-colors ${week?.chip === c ? 'border-accent bg-accent-selected text-accent' : usedElsewhere || !week ? 'border-line text-ink-3 opacity-40' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'}`}
              >{CHIP_LABEL[c]}</button>
            )
          })}
        </div>
      </div>

      {footer && <div className="mx-auto mt-3" style={{ maxWidth: BOARD_W }}>{footer}</div>}

      {sheet != null && rowOf(sheet) && week && (
        <PlayerCardSheet
          player={rowOf(sheet) as RatingRow}
          pool={pool}
          fixtureEase={fixtureEase}
          onClose={() => setSheet(null)}
          actions={
            <SquadActions
              isStarter={week.xi.includes(sheet)}
              isCaptain={week.captain === sheet}
              isVice={week.vice === sheet}
              canSwap={planner.partnersFor(sheet).length > 0}
              onCaptain={() => { tapHaptic('light'); planner.makeCaptain(sheet); setSheet(null) }}
              onVice={() => { tapHaptic('light'); planner.makeVice(sheet); setSheet(null) }}
              onSwap={() => beginSub(sheet)}
              onTransfer={() => {
                // Same action as the cross on the card. It used to only arm a
                // search, which left the player sitting on the pitch wearing
                // an OUT badge while the money never arrived.
                planner.sell(sheet)
                onSold?.(sheet)
                setSheet(null)
              }}
            />
          }
        />
      )}

      {detail === 'xp' && teamXp != null && week && (
        <XpSheet
          gw={gw} total={teamXp} hit={hit} capMult={capMult}
          rows={scoring.map((el) => ({ el, name: nameOf(el), team: teamOf(el), xp: xpOf(el), captain: week.captain === el, bench: week.bench.includes(el) }))}
          onClose={() => setDetail(null)}
        />
      )}

      {detail === 'rating' && rating != null && benchmark && teamXp != null && (
        <RatingSheet gw={gw} total={teamXp} rating={rating} benchmark={benchmark} onClose={() => setDetail(null)} />
      )}
    </div>
  )
}

type Pos4 = 'GKP' | 'DEF' | 'MID' | 'FWD'
type Slot = { el: number | null; pos: Pos4 }

/** Lay a part-built squad into the same 15 slots the finished board uses:
 *  a 4-4-2 eleven and a four-man bench (keeper first). Best-rated players
 *  take the pitch; the rest of the slots stay empty and clickable. */
function layoutPartial(squad: number[], posOf: (el: number) => Pos4, ratingOf: (el: number) => number): { xi: Slot[][]; bench: Slot[] } {
  const pool: Record<Pos4, number[]> = { GKP: [], DEF: [], MID: [], FWD: [] }
  for (const el of squad) pool[posOf(el)]?.push(el)
  for (const k of Object.keys(pool) as Pos4[]) pool[k].sort((a, b) => ratingOf(b) - ratingOf(a))
  const take = (p: Pos4) => pool[p].shift() ?? null
  const row = (p: Pos4, n: number): Slot[] => Array.from({ length: n }, () => ({ el: take(p), pos: p }))
  const xi = [row('GKP', 1), row('DEF', 4), row('MID', 4), row('FWD', 2)]
  const bench: Slot[] = [{ el: take('GKP'), pos: 'GKP' }, { el: take('DEF'), pos: 'DEF' }, { el: take('MID'), pos: 'MID' }, { el: take('FWD'), pos: 'FWD' }]
  return { xi, bench }
}

/** An unfilled place in the squad — same footprint as a card, so the board
 *  holds its shape from the first pick to the fifteenth. */
function EmptySlot({ pos, onClick }: { pos: Pos4; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`${CARD_W} grid place-items-center rounded-xl border border-dashed border-white/25 bg-black/20 text-white/55 transition-colors hover:border-accent hover:bg-accent-soft/20 hover:text-accent`}
      style={{ height: 125 }}
    >
      <span className="grid size-6 place-items-center rounded-full border border-current text-[13px] leading-none font-bold">+</span>
      <span className="mt-1 text-[10px] font-extrabold tracking-[0.12em] uppercase">{pos}</span>
    </button>
  )
}

const ratingWord = (r: number) => (r >= 85 ? 'elite week' : r >= 70 ? 'strong' : r >= 50 ? 'about par' : r >= 30 ? 'below par' : 'poor week')

/** The rating reads as a colour before it reads as a number, on the same
 *  bands as the word beneath it — gold for an elite week, green for strong,
 *  neutral at par, then amber and red as it falls away. */
const ratingTone = (r: number | null): 'accent' | 'good' | 'ink' | 'warn' | 'bad' =>
  r == null ? 'ink' : r >= 85 ? 'accent' : r >= 70 ? 'good' : r >= 50 ? 'ink' : r >= 30 ? 'warn' : 'bad'

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

function Stat({ label, value, tone, sub, onClick, delta, dp = 1 }: {
  label: string; value: string; tone?: 'ink' | 'bad' | 'good' | 'accent' | 'warn'; sub?: string
  onClick?: () => void
  /** Movement since the last change to the squad — null when nothing has
   *  changed yet, or when the change was too small to round to anything. */
  delta?: number | null
  dp?: number
}) {
  const c = tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : tone === 'good' ? 'text-good' : tone === 'accent' ? 'text-accent' : 'text-ink'
  const inner = (
    <>
      <div className={`font-display text-lg leading-none tabular-nums ${c}`}>{value}</div>
      <div className="mt-1 text-[10px] font-semibold tracking-[0.1em] text-ink-2 uppercase">{label}</div>
      {/* Wraps rather than truncates. A narrower board means narrower stat
          boxes, and "what this XI should score" cut to "what this XI should
          sc…" — a caption that no longer says anything, to save a line. */}
      {sub && <div className="mt-0.5 text-[10px] leading-tight text-ink-3">{sub}</div>}
      {delta != null && Math.abs(delta) >= (dp === 0 ? 1 : 0.05) && (
        <div className={`font-num mt-1 text-[10.5px] font-bold tabular-nums ${delta > 0 ? 'text-good' : 'text-bad'}`}>
          {delta > 0 ? '+' : '\u2212'}{Math.abs(delta).toFixed(dp)}
          <span className="ml-1 font-sans font-medium text-ink-3">since your last change</span>
        </div>
      )}
    </>
  )
  const cls = 'w-full rounded-xl border border-line bg-surface-1/60 p-2.5 text-center'
  return onClick
    ? <button onClick={onClick} className={`${cls} transition-colors hover:border-accent/50 hover:bg-accent-selected`}>{inner}</button>
    : <div className={cls}>{inner}</div>
}

function PlayerChip({ onOpen, captain, vice, tripleCap, fixtures, rating, corner, flag, name, code, element, transferred, bench, highlight, dimmed, picked, sold, onSell, sellVerb = 'Sell' }: {
  onOpen: () => void; captain: boolean; vice: boolean; tripleCap?: boolean; fixtures: FixtureEaseRow[]; rating: number
  corner: string; flag?: AvailBadgeInfo | null
  name: string; code: number | null; element: number; transferred: boolean; bench?: boolean
  highlight?: boolean; dimmed?: boolean; picked?: boolean
  /** Sold this week and not yet replaced — he stays on the pitch so the shape
   *  of the team is still readable while you decide who takes his place. */
  sold?: boolean
  onSell?: () => void
  /** "Sell" once the fifteen exists and the money goes to the bank; "Remove"
   *  while you are still picking one, where nothing is being sold to anybody. */
  sellVerb?: 'Sell' | 'Remove'
}) {
  const next = fixtures[0]
  const [bg, fg] = next ? (FDR_COLORS[next.fdr] || FDR_COLORS[3]) : ['#39424E', '#E8EDF3']
  return (
    <span className={`${CARD_W} relative transition-opacity ${dimmed ? 'opacity-30' : ''}`}>
      {onSell && (
        <button
          onClick={(ev) => { ev.stopPropagation(); onSell() }}
          aria-label={sold ? `Keep ${name}` : `${sellVerb} ${name}`}
          title={sold
            ? `Keep ${name}`
            : sellVerb === 'Remove' ? `Remove ${name} from your squad` : `Sell ${name} — his fee goes into the bank`}
          /* Top-right, hanging off the card. This is only safe because the
             armband moved inside: it was the one thing overhanging a card's
             left edge, and two six-pixel overhangs don't fit a six-pixel gap.
             With it gone, the corner opposite is empty. */
          className={`absolute -top-1.5 -right-1.5 z-20 grid size-5 place-items-center rounded-full border text-[10px] shadow-md transition-colors sm:size-[22px] ${
            sold
              ? 'border-good bg-good text-white'
              : 'border-line bg-surface-1 text-ink-2 hover:border-bad hover:bg-bad hover:text-white'
          }`}
        >
          <Icon name={sold ? 'arrow-right' : 'x'} size={sold ? 11 : 12} className={sold ? 'rotate-180' : ''} />
        </button>
      )}
      {/* Sold reads as greyed out and nothing more. The veil sits over the
          card rather than being a filter on it, so the restore button keeps
          its colour instead of going grey along with him. */}
      {sold && <span className="pointer-events-none absolute inset-0 z-10 rounded-xl bg-surface-1/45 backdrop-grayscale" />}
      {/* The just-signed tick takes the bottom-left, diagonally opposite the
          cross. One overhanging thing per corner, and the two that are used
          are never on the same edge of the gap between cards. */}
      {transferred && <span className="absolute -bottom-1.5 -left-1.5 z-10 grid size-4 place-items-center rounded-full bg-good text-[10px] text-white"><Icon name="check" size={10} /></span>}
      <FoilShell
        tier={bench ? 'graphite' : tierOf(rating || null)}
        onClick={onOpen}
        className={`w-full ${highlight ? 'ring-2 ring-accent ring-offset-1 ring-offset-transparent' : ''} ${picked ? 'ring-2 ring-bad' : ''} ${sold ? 'opacity-70' : ''}`}
        innerClassName="px-1 pt-1 pb-1.5 sm:px-1.5"
      >
        {/* A bar of severity colour along the top edge, with the reason
            riding on it. Colour finds the problem across fifteen cards at a
            glance; the label says whether it's a knock or a ban. The edge is
            the only free surface on the card — the border carries the rating
            tier, the pill under the name carries fixture difficulty, and a
            faded card already means sold. */}
        {flag && (
          <>
            <span className="absolute inset-x-0 top-0 z-10 h-1" style={{ background: SEV_COLOUR[flag.sev].bar }} />
            <span
              title={flag.title}
              className="absolute top-[5px] left-1 z-10 rounded px-1 py-0.5 text-[9px] leading-none font-extrabold tracking-wide"
              style={{ background: SEV_COLOUR[flag.sev].chip, color: SEV_COLOUR[flag.sev].ink }}
            >{flag.label}</span>
          </>
        )}
        <span className="photo-slot relative mx-auto block h-9 w-8 sm:h-11 sm:w-10">
          <span className="photo-mono absolute inset-0 place-items-center text-[11px] font-extrabold text-white/35">{initialsOf(name)}</span>
          <PlayerPhoto code={code} element={element} className="relative h-full w-full object-contain object-top" placeholder={<span className="grid h-full w-full place-items-center text-[11px] font-extrabold text-white/35">{initialsOf(name)}</span>} />
        </span>
        {/* The armband rides with the name rather than hanging off the
            corner, which is where the neighbouring card's controls reach. */}
        {/* Flex rather than a truncating text line: `truncate` clips
            anything taller than the line box, which sliced the top and
            bottom off the armband. Only the name truncates now. */}
        <span className={`capture-line mt-1 flex w-full items-center justify-center gap-1 leading-tight font-bold text-white sm:text-[11px] ${nameSize(name, captain || vice)}`}>
          {(captain || vice) && (
            <span
              title={captain && tripleCap ? 'Triple captain' : captain ? 'Captain' : 'Vice-captain'}
              className={`grid h-[14px] min-w-[14px] shrink-0 place-items-center rounded-full px-[3px] text-[10px] leading-none font-black sm:h-4 sm:min-w-4 ${
                captain ? 'bg-accent text-accent-contrast' : 'bg-white/85 text-black'
              }`}
            >{captain ? (tripleCap ? '3×' : 'C') : 'V'}</span>
          )}
          <span className="truncate">{name}</span>
        </span>
        <span className="mt-0.5 block w-full truncate rounded px-0.5 text-[10px] font-bold sm:px-1" style={{ background: bg, color: fg }}>{next ? `${next.opponent} (${next.venue})` : 'No game'}</span>
        {fixtures.length > 1 && (
          <span className="mt-0.5 hidden w-full gap-0.5 sm:flex">
            {fixtures.slice(1).map((f, i) => {
              const [b, t] = FDR_COLORS[f.fdr] || FDR_COLORS[3]
              return <span key={i} className="min-w-0 flex-1 truncate rounded px-0.5 text-center text-[9px] font-bold" style={{ background: b, color: t }}>{f.opponent} ({f.venue})</span>
            })}
          </span>
        )}
        <span className="tier-num font-num mt-0.5 block text-[10px] font-extrabold tabular-nums sm:text-[12px]">{corner}</span>
      </FoilShell>
    </span>
  )
}

/** What you can do to a player in your squad, shown inside his card. */
function SquadActions({ isStarter, isCaptain, isVice, canSwap, onCaptain, onVice, onSwap, onTransfer }: {
  isStarter: boolean; isCaptain: boolean; isVice: boolean; canSwap: boolean
  onCaptain: () => void; onVice: () => void; onSwap: () => void; onTransfer: () => void
}) {
  // One row, always. Four equal cells that shrink together beat a wrapping
  // set that costs a whole second line on a phone; the labels are short
  // enough that nothing truncates even at 320px.
  const btn = 'inline-flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 text-[11px] font-semibold transition-colors disabled:opacity-40 sm:px-2.5 sm:text-xs'
  return (
    <div className="flex gap-1 sm:gap-1.5">
      <button onClick={onCaptain} title={isCaptain ? 'Already captain' : 'Make him captain'} className={`${btn} ${isCaptain ? 'border-accent bg-accent-selected text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'}`}><Icon name="crown" size={13} className="hidden shrink-0 min-[360px]:block" /> Captain</button>
      <button onClick={onVice} title={isVice ? 'Already vice' : 'Make him vice-captain'} className={`${btn} ${isVice ? 'border-accent bg-accent-selected text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'}`}><Icon name="shield" size={13} className="hidden shrink-0 min-[360px]:block" /> Vice</button>
      <button onClick={onSwap} disabled={!canSwap} className={`${btn} border-line-mid text-ink-2 hover:border-line-strong hover:text-ink`}><Icon name="pitch" size={13} className="hidden shrink-0 min-[360px]:block" /> {isStarter ? 'Bench' : 'Start'}</button>
      <button onClick={onTransfer} className={`${btn} border-bad/45 text-bad hover:bg-bad/10`}><Icon name="users" size={13} className="hidden shrink-0 min-[360px]:block" /> Transfer</button>
    </div>
  )
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-[210] flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center" onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface-1 p-2" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body,
  )
}

/** Where the projected total comes from, player by player. */
function XpSheet({ gw, total, hit, rows, capMult, onClose }: {
  gw: number; total: number; hit: number
  rows: { el: number; name: string; team: string; xp: number | null; captain: boolean; bench: boolean }[]
  capMult: number; onClose: () => void
}) {
  const sorted = [...rows].sort((a, b) => (b.xp ?? 0) * (b.captain ? capMult : 1) - (a.xp ?? 0) * (a.captain ? capMult : 1))
  return (
    <Overlay onClose={onClose}>
      <div className="max-h-[80vh] overflow-y-auto">
        <div className="flex items-baseline gap-2 px-3 py-2">
          <span className="font-display text-lg font-bold text-ink">GW{gw} projected points</span>
          <span className="ml-auto font-display text-2xl font-bold text-accent tabular-nums">{total.toFixed(1)}</span>
        </div>
        <p className="px-3 pb-2 text-xs text-ink-3">
          Every player who scores this week, captain counted {capMult === 3 ? 'three times' : 'twice'}
          {hit > 0 ? `, less the ${hit}-point transfer hit` : ''}.
        </p>
        <div className="border-t border-line">
          {sorted.map((r) => (
            <div key={r.el} className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm last:border-0">
              <span className="min-w-0 flex-1 truncate text-ink">{r.name}</span>
              {r.captain && <span className="shrink-0 rounded bg-accent px-1 text-[10px] font-bold text-accent-contrast">{capMult === 3 ? '3×' : 'C'}</span>}
              {r.bench && <span className="shrink-0 rounded bg-surface-3 px-1 text-[10px] font-bold text-ink-3">BENCH</span>}
              <span className="font-num w-12 shrink-0 text-right tabular-nums text-ink-2">{r.xp == null ? '—' : (r.xp * (r.captain ? capMult : 1)).toFixed(1)}</span>
            </div>
          ))}
        </div>
      </div>
      <button className="mt-1 w-full rounded-xl px-4 py-3 text-center text-sm font-semibold text-ink-3" onClick={onClose}>Close</button>
    </Overlay>
  )
}

/** What the 0–100 gameweek rating actually measures. */
function RatingSheet({ gw, total, rating, benchmark, onClose }: {
  gw: number; total: number; rating: number; benchmark: { floor: number; ceiling: number }; onClose: () => void
}) {
  const pct = Math.max(0, Math.min(100, ((total - benchmark.floor) / (benchmark.ceiling - benchmark.floor)) * 100))
  return (
    <Overlay onClose={onClose}>
      <div className="px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-lg font-bold text-ink">GW{gw} rating</span>
          <span className="ml-auto font-display text-3xl font-bold text-accent tabular-nums">{rating}</span>
        </div>
        <p className="mt-1 text-xs text-ink-3">
          A points total means nothing on its own — {total.toFixed(1)} is good or bad depending on what was available this
          week. So it's measured between two posts.
        </p>
      </div>
      <div className="px-3 pb-3">
        <div className="relative mt-3 h-2 rounded-full bg-surface-3">
          <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${pct}%` }} />
          <div className="absolute -top-1 size-4 -translate-x-1/2 rounded-full border-2 border-accent bg-surface-1" style={{ left: `${pct}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-ink-3">
          <span>{benchmark.floor.toFixed(0)} · median XI</span>
          <span>{benchmark.ceiling.toFixed(0)} · best XI available</span>
        </div>
        <div className="mt-3 space-y-1.5 text-xs text-ink-2">
          <div><span className="font-semibold text-ink">The floor</span> — an XI of median players at every position, captain doubled. What a squad picked without thinking returns.</div>
          <div><span className="font-semibold text-ink">The ceiling</span> — the best legal XI in the entire game this week, captain doubled. Nobody gets this; it's the edge of what was on the table.</div>
          <div><span className="font-semibold text-ink">Your {rating}</span> — how far up that gap your XI sits. Both posts move every week with the fixtures, so the rating is always against this week, not a season average.</div>
        </div>
      </div>
      <button className="mt-1 w-full rounded-xl px-4 py-3 text-center text-sm font-semibold text-ink-3" onClick={onClose}>Close</button>
    </Overlay>
  )
}

/* ── The gameweek strip ────────────────────────────────────────────────────
   Two arrows tell you where you are and nothing about where you are going:
   finding the hard week meant stepping to it, which is five clicks and a
   memory test. This draws the whole window at once and makes each week a
   button.

   Three readings per card, and each does work the others cannot. The number
   is precise. The bar makes the comparison instant. The hard count is the
   thing a projection HIDES — a week can project mid-table because a strong
   bench props it up while most of the fifteen walk into a rated-4 fixture,
   and those are different weeks to plan around.

   Not the GW rating, which was the obvious candidate and turned out to be
   the wrong number: across a normal window it moves between about 75 and 86
   and calls nearly every week "strong", so eight cards would carry eight
   near-identical figures. The projection and the hard count both use their
   range. */
function GameweekStrip({ planner, byEl, engine, current, onPick, ratingOf }: {
  planner: Planner
  byEl: Map<number, RatingRow>
  engine: { fixtureEase: FixtureEaseRow[]; avail?: Availability; model: XpModel | null; market: MarketOdds | null }
  current: number
  onPick: (gw: number) => void
  ratingOf: (el: number) => number
}) {
  const { gws, startGw, squadAtGw, weekAt, hitAt, posOf, revision } = planner
  const { fixtureEase, avail, model, market } = engine

  /* Ten weeks ahead, one behind for context. `gws` runs to GW38 and drawing all
     of it meant thirty-eight lineups per render for a strip nobody reads to the
     end of. */
  const window = useMemo(() => {
    const i = Math.max(0, gws.indexOf(current))
    return gws.slice(Math.max(0, i - 1), Math.max(0, i - 1) + 12)
  }, [gws, current])

  const cells = useMemo(() => {
    const fdr = new Map<string, number>()
    for (const f of fixtureEase) fdr.set(`${f.team}|${f.gw}`, f.fdr)

    /* THE MANAGER'S ELEVEN, not the best one available.
 
       This is a planner, so a week is worth what the team you picked for it
       scores with the captain you gave it. An earlier version showed the best
       legal eleven for every week, which made the cards comparable and made
       them somebody else's team.
 
       Weeks you have not opened yet have no saved lineup, so the strip does
       what the planner itself does on arrival: carry the previous eleven
       forward while every one of them is still in the squad, and fall back to
       an auto lineup when a transfer has broken it. Walking from the start of
       the season rather than from the window keeps that chain intact — begin
       in the middle and the first card inherits nothing and reads as an auto
       pick that the planner would never actually show you. */
    /* Built into the map and read back out of it, rather than carried in a
       mutable local. `carried = next` where `next` was derived from `carried`
       is a self-referential initializer, and TypeScript resolves that by
       giving up on the declared type — reporting the guarded branch first as
       `never` and then as implicit `any`. Reading the previous week out of the
       map has no cycle in it. */
    const lineups = new Map<number, StripLine & { chip: string | null }>()
    let last: number | null = null
    for (const gw of gws) {
      const squad = squadAtGw(gw)
      const stored = weekAt(gw)
      if (stored) {
        lineups.set(gw, { xi: stored.xi, bench: stored.bench, captain: stored.captain, chip: stored.chip })
        last = gw
      } else {
        const prev = last == null ? undefined : lineups.get(last)
        if (prev && prev.xi.length === 11
            && [...prev.xi, ...prev.bench].every((e) => squad.includes(e))) {
          lineups.set(gw, { xi: prev.xi, bench: prev.bench, captain: prev.captain, chip: null })
          last = gw
        } else if (squad.length === 15) {
          const a = autoLineup(squad, posOf, ratingOf)
          lineups.set(gw, { xi: a.xi, bench: a.bench, captain: a.captain, chip: null })
          last = gw
        }
      }
      if (gw >= window[window.length - 1]) break
    }

    return window.map((gw) => {
      const line = lineups.get(gw)
      const squad = squadAtGw(gw)
      const rows = squad.map((el) => byEl.get(el)).filter(Boolean) as RatingRow[]
      let xp: number | null = null
      if (line) {
        const scoring = line.chip === 'bench-boost' ? [...line.xi, ...line.bench] : line.xi
        const mult = line.chip === 'triple-captain' ? 3 : 2
        let total = 0
        let any = false
        for (const el of scoring) {
          const r = byEl.get(el)
          const v = r ? xpForGw(r, gw, fixtureEase, avail, model, market) : null
          if (v != null) { total += v * (el === line.captain ? mult : 1); any = true }
        }
        // Hits are subtracted here exactly as they are in the headline stat, so
        // a week you took a -4 in reads as what it is worth, not what it grosses.
        xp = any ? total - hitAt(gw) : null
      }
      const hard = rows.filter((r) => (fdr.get(`${String(r.team)}|${gw}`) ?? 3) >= 4).length
      const capName = line?.captain != null ? String(byEl.get(line.captain)?.web_name ?? '') : ''
      return { gw, xp, hard, chip: line?.chip ?? null, capName, planned: Boolean(weekAt(gw)) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window.join(','), revision, byEl, fixtureEase, avail, model, market])

  const vals = cells.map((c) => c.xp).filter((v): v is number => v != null)
  if (vals.length < 2) return null
  const lo = Math.min(...vals) - (Math.max(...vals) - Math.min(...vals)) * 0.45 - 0.5
  const hi = Math.max(...vals)
  const width = (v: number) => `${Math.max(6, ((v - lo) / Math.max(hi - lo, 0.001)) * 100)}%`

  return (
    <div className="mb-2.5">
      {/* A grid, not a scroller. The row of cards used to run off the edge
          behind a drag bar, which hides half the window on exactly the screens
          where the window matters most. Wrapping shows all twelve at once:
          three rows of four on a phone, two of six on a laptop. */}
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
        {cells.map((c) => {
          const on = c.gw === current
          const tone = c.hard >= 6 ? 'text-bad' : c.hard >= 4 ? 'text-warn' : c.hard <= 2 ? 'text-good' : 'text-ink-3'
          return (
            <button
              key={c.gw}
              onClick={() => { if (!on) { onPick(c.gw); tapHaptic('select') } }}
              aria-current={on ? 'true' : undefined}
              title={`Gameweek ${c.gw}${c.xp != null ? ` — ${c.xp.toFixed(1)} from your eleven` : ''}${
                c.capName ? `, ${c.capName} captain` : ''} · ${c.hard} of the fifteen in a fixture rated 4 or 5${
                c.planned ? '' : ' · not opened yet, carrying this eleven forward'}`}
              className={`flex flex-col gap-1 rounded-xl border px-1.5 py-1.5 text-left transition-colors ${
                on ? 'border-accent bg-accent-selected' : 'border-line bg-surface-2/40 hover:border-line-strong'
              }`}
            >
              <span className="flex items-baseline justify-between gap-1">
                <span className={`text-[9.5px] font-bold tracking-[0.08em] uppercase ${on ? 'text-accent' : 'text-ink-3'}`}>
                  GW{c.gw}
                </span>
                {c.chip
                  ? <span className="text-[8.5px] font-bold text-accent-2">{CHIP_SHORT[c.chip] ?? ''}</span>
                  : c.gw === startGw ? <span className="text-[8.5px] text-ink-3">now</span> : null}
              </span>
              <span className={`font-num text-[15px] leading-none font-bold tabular-nums ${on ? 'text-accent-2' : 'text-ink'}`}>
                {c.xp == null ? '—' : c.xp.toFixed(1)}
              </span>
              <span className="block h-1 overflow-hidden rounded-full bg-surface-3">
                <span className="block h-full rounded-full" style={{
                  width: c.xp == null ? '0%' : width(c.xp),
                  background: on ? 'var(--accent-2)' : 'var(--accent)',
                  opacity: on ? 1 : 0.55,
                }} />
              </span>
              <span className={`truncate text-[9.5px] ${tone}`}>{c.hard} hard</span>
            </button>
          )
        })}
      </div>
      <p className="mt-1 text-[10px] text-ink-3">
        What your eleven scores each week with your captain, and how many of the fifteen face a fixture rated
        4 or 5. Weeks you have not opened carry this eleven forward, the same way the board does. Tap to go there.
      </p>
    </div>
  )
}

/** One week's eleven as the strip understands it. */
interface StripLine { xi: number[]; bench: number[]; captain: number | null }

const CHIP_SHORT: Record<string, string> = {
  'wildcard': 'WC', 'free-hit': 'FH', 'bench-boost': 'BB', 'triple-captain': 'TC',
}
