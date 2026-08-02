import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { Exportable } from './ExportPanel'
import { num, bool } from '../lib/rows'
import { teamLabel } from '../lib/util'
import { availFor, onPenalties, type Availability } from '../lib/availability'
import type { FixtureEaseRow, RatingRow } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   What the squad rating is made of, and what kind of squad you've built.

   The number on the tile is just an average, which tells you nothing about
   the shape of the thing. This opens it up two ways: the arithmetic (per
   position, against what the rest of the game gets from that position), and
   a read of the squad's character — where the points are supposed to come
   from, and what you've doubled up on without meaning to.
   ════════════════════════════════════════════════════════════════════════ */

type Pos = 'GKP' | 'DEF' | 'MID' | 'FWD'
const ORDER: Pos[] = ['GKP', 'DEF', 'MID', 'FWD']
const POS_LABEL: Record<Pos, string> = { GKP: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards' }

const ov = (r: RatingRow): number | null => {
  const s = num(r, 'season_overall_score')
  return s == null ? null : Math.round(Math.max(0, Math.min(100, s * 20)))
}
const dim = (r: RatingRow, key: string): number => Math.round((num(r, key) ?? 0) * 20)
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export interface NarrativeLine { tone: 'good' | 'warn' | 'flat'; head: string; body: string }

/** Read the squad's character from what's actually in it. Every line is a
 *  fact about the fifteen, not a score — the tone says whether it's a
 *  strength, a risk, or just a shape worth knowing about. */
export function squadNarrative(chosen: RatingRow[], fixtureEase: FixtureEaseRow[], gw: number, avail?: Availability): NarrativeLine[] {
  const out: NarrativeLine[] = []
  if (chosen.length < 5) return out
  const outfield = chosen.filter((r) => r.position !== 'GKP')

  // Penalties — the single most repeatable source of points in the game.
  //
  // What counts is the man who will actually stand over the ball, which is not
  // the same as `pen_order === 1`. FPL lists the club's stated order and never
  // re-ranks it for an injury, so reading rank 1 credited a squad for owning
  // Bournemouth's first choice while he sat out three months with a foot
  // injury — and gave no credit at all for owning the deputy who was taking
  // them. `penaltyDuty` resolves the queue against who is fit.
  //
  // Live orders when the daily refresh has run; the season snapshot otherwise.
  // Duty moves between seasons (Thiago went from Brentford's #2 to #1), so the
  // freshest source always wins — and without the live layer there is nothing
  // to resolve availability against, so rank 1 is the best that can be said.
  const live = avail?.generatedAt ? avail : null
  const takesPens = (r: RatingRow): boolean =>
    live ? onPenalties(live, availFor(live, num(r, 'element'), num(r, 'code'))) : num(r, 'penalties_order') === 1
  const deputy = (r: RatingRow): boolean => {
    if (!live) return false
    const p = availFor(live, num(r, 'element'), num(r, 'code'))
    return (p?.pen_order ?? 1) > 1
  }
  const pens = chosen.filter(takesPens)
  const penNames = pens.map((r) => r.web_name).join(', ')
  // A deputy is on them until the first choice is fit, so the claim is hedged
  // where it needs to be rather than stated flat and quietly going stale.
  const standIns = pens.filter(deputy).map((r) => r.web_name)
  const caveat = standIns.length
    ? ` ${standIns.join(' and ')} ${standIns.length > 1 ? 'have' : 'has'} them while the first choice is out, so this lasts as long as the injury does.`
    : ''
  if (pens.length >= 3) {
    out.push({ tone: 'good', head: `${pens.length} penalty takers`, body: `${penNames} are all on them for their clubs. Penalties are the most repeatable points in the game — this many is a deliberate edge, not an accident.${caveat}` })
  } else if (pens.length === 0) {
    out.push({ tone: 'warn', head: 'No penalty takers', body: 'Nobody in the fifteen is on penalties for their club. Roughly one goal in nine comes from a penalty; you are giving that up.' })
  } else {
    out.push({ tone: 'flat', head: `${pens.length} penalty taker${pens.length > 1 ? 's' : ''}`, body: `${penNames} — on them for ${pens.length > 1 ? 'their clubs' : 'his club'}.${caveat}` })
  }

  // Set-piece delivery — corners and free kicks only, ranked across all
  // outfielders, so this counts real takers rather than anyone who crosses.
  const sp = outfield.filter((r) => dim(r, 'season_set_piece_score_norm') >= 80)
  if (sp.length >= 3) {
    out.push({ tone: 'good', head: `${sp.length} set-piece takers`, body: `${sp.map((r) => r.web_name).join(', ')} all deliver corners and free kicks — assists from dead balls don't depend on the attack playing well.` })
  }

  // Def Con — the newest points route, and the easiest one to over-buy.
  //
  // Only the over-bought case is stated here. The good case used to be too,
  // and now says the same names as the Def Con block above it in the sheet —
  // which scores the whole squad rather than just counting specialists, so it
  // is the better place for it.
  const dc = outfield.filter((r) => dim(r, 'season_dc_score_norm') >= 75)
  if (dc.length >= 5) {
    out.push({ tone: 'warn', head: `${dc.length} built on Def Con`, body: `${dc.map((r) => r.web_name).join(', ')}. A lot of your ceiling rests on the +2 threshold, which pays the same in a 4-0 win as a 0-3 loss — safe, but it doesn't win you a gameweek.` })
  }

  // Club stacking — fine when it's the right club, expensive when it blanks.
  const byClub = new Map<string, RatingRow[]>()
  for (const r of chosen) byClub.set(String(r.team), [...(byClub.get(String(r.team)) ?? []), r])
  const stacks = [...byClub.entries()].filter(([, v]) => v.length >= 3).sort((a, b) => b[1].length - a[1].length)
  if (stacks.length) {
    out.push({
      tone: stacks.length >= 3 ? 'warn' : 'flat',
      head: `${stacks.length === 1 ? 'Triple up' : `${stacks.length} triple-ups`} — ${stacks.map(([t]) => teamLabel(t)).join(', ')}`,
      body: stacks.map(([t, v]) => `${teamLabel(t)}: ${v.map((r) => r.web_name).join(', ')}`).join(' · ') + (stacks.length >= 3 ? '. Three clubs at the cap means three bad afternoons can take your whole week with them.' : '.'),
    })
  }

  // Price shape — where the money went.
  const prices = chosen.map((r) => num(r, 'price') ?? 0)
  const premiums = chosen.filter((r) => (num(r, 'price') ?? 0) >= 9)
  const fodder = chosen.filter((r) => (num(r, 'price') ?? 0) <= 4.5)
  const spend = prices.reduce((a, b) => a + b, 0)
  if (premiums.length >= 3) {
    out.push({ tone: 'flat', head: `${premiums.length} premiums, ${fodder.length} at £4.5m or under`, body: `${premiums.map((r) => `${r.web_name} £${num(r, 'price')}m`).join(', ')} take £${premiums.reduce((a, r) => a + (num(r, 'price') ?? 0), 0).toFixed(1)}m of the £${spend.toFixed(1)}m. That shape only works if the cheap end actually plays.` })
  } else if (premiums.length === 0) {
    out.push({ tone: 'warn', head: 'No premium', body: 'Nothing above £9.0m. Even coverage, but no player capable of a 20-point week on his own.' })
  }

  // Minutes — the risk that quietly costs more than any pick.
  const risky = chosen.filter((r) => (num(r, 'season_start_rate') ?? 1) < 0.6 && (num(r, 'season_start_rate') ?? 1) > 0)
  if (risky.length >= 4) {
    out.push({ tone: 'warn', head: `${risky.length} started under 60% of games`, body: `${risky.map((r) => r.web_name).join(', ')}. Points you never get because he wasn't on the pitch cost the same as points you got wrong.` })
  }

  // Opening fixtures for the fifteen.
  const fdrs = chosen
    .map((r) => fixtureEase.filter((f) => f.team === r.team && f.gw >= gw && f.gw < gw + 4).map((f) => f.fdr))
    .flat()
  if (fdrs.length >= 20) {
    const avg = mean(fdrs)
    out.push({
      tone: avg <= 2.7 ? 'good' : avg >= 3.4 ? 'warn' : 'flat',
      head: `Opening four weeks average FDR ${avg.toFixed(1)}`,
      body: avg <= 2.7 ? 'A kind start across the squad — front-load your transfers rather than your patience.'
        : avg >= 3.4 ? 'A hard opening month. Expect the early table to flatter squads with easier runs.'
        : 'An average opening month — nothing to plan around either way.',
    })
  }

  // Players with no rating at all.
  const unrated = chosen.filter((r) => ov(r) == null)
  if (unrated.length) {
    out.push({ tone: 'flat', head: `${unrated.length} unrated`, body: `${unrated.map((r) => r.web_name).join(', ')} — new to the league, so there's no record to rate. They pull the squad average down without that meaning anything.` })
  }

  return out
}

export function SquadRatingSheet({ chosen, pool, squadScore, bestXI, fixtureEase, gw, avail, onClose }: {
  chosen: RatingRow[]
  pool: RatingRow[]
  avail?: Availability
  squadScore: number | null
  bestXI: number | null
  fixtureEase: FixtureEaseRow[]
  gw: number
  onClose: () => void
}) {
  const lines = useMemo(() => squadNarrative(chosen, fixtureEase, gw, avail), [chosen, fixtureEase, gw, avail])

  // Per position: your average against the BEST you could have had — the top
  // N rated players at that position, where N is how many you own. Measuring
  // against the average of all 98 rated defenders was useless: half of them
  // are bench fodder, so any sane squad scored +25 and the number said
  // nothing. Against the best available it reads as a deficit, which is both
  // honest and actionable.
  const byPos = useMemo(() => ORDER.map((p) => {
    const mine = chosen.filter((r) => r.position === p).map(ov).filter((v): v is number => v != null)
    const best = pool
      .filter((r) => r.position === p && bool(r, 'season_ok'))
      .map(ov).filter((v): v is number => v != null)
      .sort((a, b) => b - a)
      .slice(0, Math.max(mine.length, 1))
    return {
      pos: p,
      n: mine.length,
      mine: mine.length ? Math.round(mean(mine)) : null,
      best: best.length ? Math.round(mean(best)) : null,
    }
  }), [chosen, pool])

  const ranked = useMemo(
    () => [...chosen].filter((r) => ov(r) != null).sort((a, b) => (ov(b) ?? 0) - (ov(a) ?? 0)),
    [chosen],
  )

  /* Def Con, as a squad-level line rather than a per-player column.
   *
   * The +2 for hitting the defensive-contribution threshold is the newest
   * route to points in the game and the one people most often own by accident
   * — you can end up with six grinders and no idea, because nothing on the
   * board adds them up. This does, on the same bar-and-tick as the positions
   * above: your outfielders' mean against the mean of the best equally-many
   * available, so it reads as a gap rather than a compliment.
   *
   * Outfielders only. Goalkeepers have no defensive-contribution threshold in
   * FPL, so including them would drag the mean toward a number that cannot be
   * acted on. */
  const defcon = useMemo(() => {
    const mine = chosen.filter((r) => r.position !== 'GKP' && num(r, 'season_dc_score_norm') != null)
    if (mine.length < 5) return null
    const best = pool
      .filter((r) => r.position !== 'GKP' && bool(r, 'season_ok') && num(r, 'season_dc_score_norm') != null)
      .map((r) => dim(r, 'season_dc_score_norm'))
      .sort((a, b) => b - a)
      .slice(0, mine.length)
    return {
      n: mine.length,
      mine: Math.round(mean(mine.map((r) => dim(r, 'season_dc_score_norm')))),
      best: best.length ? Math.round(mean(best)) : null,
      // 75 is the same threshold squadNarrative uses to call somebody a
      // specialist, so the count here and the line below it agree.
      specialists: mine.filter((r) => dim(r, 'season_dc_score_norm') >= 75).map((r) => String(r.web_name)),
    }
  }, [chosen, pool])

  return createPortal(
    // The panel scrolls inside itself and never grows past the viewport. It
    // used to grow, and on a phone the overflow ran off the TOP — taking the
    // close button with it, which left no way out but a refresh.
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" onClick={onClose} role="dialog" aria-modal="true">
      {/* 620px was a phone sheet that happened to also open on a desktop. The
          panel is four position bars, a Def Con line, a list of narrative
          sentences and two columns of names — all of which read better with
          room, and none of which needs more than a comfortable measure. */}
      <div className="flex max-h-[90dvh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-line bg-surface-1" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line p-4">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Squad rating</div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="metallic-num font-num text-4xl leading-none font-extrabold tabular-nums">{squadScore ?? '—'}</span>
              <span className="text-sm text-ink-2">average of the fifteen</span>
            </div>
            <div className="mt-1 text-sm text-ink-2">Best XI <b className="font-num font-bold text-accent tabular-nums">{bestXI ?? '—'}</b> — the eleven that actually start</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-mid text-ink-2 hover:text-ink"><Icon name="x" size={16} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
        <Exportable title="My squad — the rating, broken down">
          <div className="flex flex-col gap-5 p-4">
            {/* the arithmetic */}
            <div>
              <div className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Where the number comes from</div>
              <div className="flex flex-col gap-2.5">
                {byPos.map((b) => (
                  <div key={b.pos} className="grid grid-cols-[104px_minmax(0,1fr)_98px] items-center gap-3">
                    <span className="text-[13px] font-medium text-ink-2">{POS_LABEL[b.pos]}<span className="text-ink-3"> ({b.n})</span></span>
                    <span className="relative h-2.5 rounded-full bg-surface-3">
                      <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${b.mine ?? 0}%` }} />
                      {b.best != null && (
                        <span className="absolute inset-y-[-3px] w-px bg-ink-2" style={{ left: `${b.best}%` }} title={`Best ${b.n} available average ${b.best}`} />
                      )}
                    </span>
                    <span className="text-right font-num text-[13px] font-bold tabular-nums text-ink">
                      {b.mine ?? '—'}
                      {b.mine != null && b.best != null && (
                        <span className={`ml-1.5 whitespace-nowrap text-[11px] font-semibold ${b.mine >= b.best ? 'text-good' : 'text-ink-3'}`}>
                          {b.mine >= b.best ? 'at the ceiling' : `${b.mine - b.best} vs best`}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-xs text-ink-3">
                The bar is your average for that position. The tick is the average of the best {byPos.map((b) => b.n).join('/')} rated
                players available in that position — the ceiling for a squad of your shape, ignoring budget. The figure on the right is
                how far under it you are, so it is a gap to close rather than a pat on the back.
              </div>
            </div>

            {/* def con */}
            {defcon && (
              <div>
                <div className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Defensive contributions</div>
                <div className="grid grid-cols-[104px_minmax(0,1fr)_98px] items-center gap-3">
                  <span className="text-[13px] font-medium text-ink-2">Def Con<span className="text-ink-3"> ({defcon.n})</span></span>
                  <span className="relative h-2.5 rounded-full bg-surface-3">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${defcon.mine}%` }} />
                    {defcon.best != null && (
                      <span className="absolute inset-y-[-3px] w-px bg-ink-2" style={{ left: `${defcon.best}%` }} title={`Best ${defcon.n} available average ${defcon.best}`} />
                    )}
                  </span>
                  <span className="text-right font-num text-[13px] font-bold tabular-nums text-ink">
                    {defcon.mine}
                    {defcon.best != null && (
                      <span className={`ml-1.5 whitespace-nowrap text-[11px] font-semibold ${defcon.mine >= defcon.best ? 'text-good' : 'text-ink-3'}`}>
                        {defcon.mine >= defcon.best ? 'at the ceiling' : `${defcon.mine - defcon.best} vs best`}
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-2 text-xs text-ink-3">
                  {defcon.specialists.length
                    ? <>Your {defcon.n} outfielders average {defcon.mine} on defensive work. <b className="font-semibold text-ink-2">{defcon.specialists.join(', ')}</b> {defcon.specialists.length === 1 ? 'clears' : 'clear'} the threshold often enough to score without a clean sheet — that is +2 a week each, in wins and defeats alike.</>
                    : <>Your {defcon.n} outfielders average {defcon.mine} on defensive work, and none of them clears the threshold often enough to bank on. It is the cheapest floor in the game and you have none of it.</>}
                </div>
              </div>
            )}

            {/* the character */}
            {lines.length > 0 && (
              <div>
                <div className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">What kind of squad this is</div>
                <ul className="flex flex-col gap-2.5">
                  {lines.map((l, i) => (
                    <li key={i} className="grid grid-cols-[10px_minmax(0,1fr)] gap-2.5">
                      <span className={`mt-[7px] size-2.5 rounded-full ${l.tone === 'good' ? 'bg-good' : l.tone === 'warn' ? 'bg-warn' : 'bg-ink-3'}`} />
                      <span className="text-[14px] leading-snug text-ink">
                        <b className="font-bold">{l.head}.</b> <span className="text-ink-2">{l.body}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* who carries it */}
            {ranked.length >= 4 && (
              <div>
                <div className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Best and worst rated</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[ranked.slice(0, 3), ranked.slice(-3).reverse()].map((grp, gi) => (
                    <div key={gi} className="rounded-xl border border-line bg-surface-2/50 p-3">
                      <div className="mb-1.5 text-[10px] font-semibold tracking-[0.12em] text-ink-3 uppercase">{gi === 0 ? 'Carrying it' : 'Weakest links'}</div>
                      {grp.map((r) => (
                        <div key={r.element} className="flex items-baseline justify-between gap-2 py-0.5 text-[13px]">
                          <span className="truncate text-ink">{String(r.web_name)}<span className="text-ink-3"> {String(r.team)} · £{num(r, 'price')}m</span></span>
                          <span className="font-num font-bold tabular-nums text-ink-2">{ov(r)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Exportable>
        </div>
      </div>
    </div>,
    document.body,
  )
}
