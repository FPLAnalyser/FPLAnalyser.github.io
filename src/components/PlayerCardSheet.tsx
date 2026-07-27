import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { PlayerPhoto } from './PlayerPhoto'
import { ratingTo100, exactTo100 } from './StarRating'
import { Icon } from './Icon'
import { Exportable } from './ExportPanel'
import { num } from '../lib/rows'
import {
  useAvailability, availFor, availBadge, returnsInGw, returnDateFrom, newsAge,
  SEV_COLOUR, STATUS_WORD,
} from '../lib/availability'
import { FDR_COLORS } from '../lib/util'
import { playerHref, teamLabel } from '../lib/util'
import type { FixtureEaseRow, RatingRow } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   The card drill-down: tap a player card anywhere (Squad Builder, My Team,
   Team of the Week) and get the rating broken into its parts plus a
   head-to-head against the nearest alternative — without leaving the page.
   ════════════════════════════════════════════════════════════════════════ */

const DIMS: Record<string, [string, string][]> = {
  GKP: [['Saves', 'season_save_score_rating'], ['Clean sheets', 'season_cs_score_rating'], ['BPS / Bonus', 'season_bps_score_rating'], ['Reliability', 'season_reliability_score_rating'], ['Value', 'season_value_score_rating']],
  DEF: [['Clean sheets', 'season_cs_score_rating'], ['Def con', 'season_dc_score_rating'], ['Attacking', 'season_attacking_score_rating'], ['Set pieces', 'season_set_piece_score_rating'], ['Reliability', 'season_reliability_score_rating'], ['Value', 'season_value_score_rating']],
  ATT: [['Goal threat', 'season_goal_score_rating'], ['Creativity', 'season_creative_score_rating'], ['Set pieces', 'season_set_piece_score_rating'], ['Def con', 'season_dc_score_rating'], ['Reliability', 'season_reliability_score_rating'], ['Value', 'season_value_score_rating']],
}
const dimsFor = (pos: string) => DIMS[pos === 'GKP' ? 'GKP' : pos === 'DEF' ? 'DEF' : 'ATT']

function Bar({ label, value, tone }: { label: string; value: number | null; tone?: 'good' | 'bad' }) {
  const grad =
    tone === 'good' ? 'linear-gradient(90deg,#1d7a49,#3ddc7a)'
    : tone === 'bad' ? 'linear-gradient(90deg,#8f2f2c,#f0736f)'
    : 'linear-gradient(90deg, var(--accent-strong), var(--accent-2))'
  return (
    <div className="grid grid-cols-[100px_1fr_38px] items-center gap-2.5">
      <span className="text-[11px] font-bold tracking-[0.06em] text-ink-2 uppercase">{label}</span>
      <div className="h-[7px] overflow-hidden rounded-full bg-white/8">
        <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, value ?? 0))}%`, background: grad }} />
      </div>
      <span className={`text-right text-[13px] font-extrabold tabular-nums ${tone === 'bad' ? 'text-bad' : 'metallic-num'}`}>{value ?? '—'}</span>
    </div>
  )
}

/** Mirrored comparison row: A on the left growing right-to-left, B on the
 * right growing left-to-right, winner in green. */
function CompareRow({ label, a, b }: { label: string; a: number | null; b: number | null }) {
  const aw = a != null && (b == null || a > b)
  const bw = b != null && (a == null || b > a)
  return (
    <div className="grid grid-cols-[1fr_104px_1fr] items-center gap-2 border-t border-line py-1.5 text-[13px]">
      <span className="flex items-center gap-2">
        <span className={`w-8 text-right font-extrabold tabular-nums ${aw ? 'text-good' : 'text-ink-2'}`}>{a ?? '—'}</span>
        <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/7">
          <span className="absolute inset-y-0 right-0 rounded-full" style={{ width: `${a ?? 0}%`, background: 'linear-gradient(270deg, var(--accent-strong), var(--accent-2))' }} />
        </span>
      </span>
      <span className="text-center text-[10px] font-extrabold tracking-[0.08em] text-ink-3 uppercase">{label}</span>
      <span className="flex flex-row-reverse items-center gap-2">
        <span className={`w-8 font-extrabold tabular-nums ${bw ? 'text-good' : 'text-ink-2'}`}>{b ?? '—'}</span>
        <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/7">
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${b ?? 0}%`, background: 'linear-gradient(90deg,#2f5fa8,#6ea8ff)' }} />
        </span>
      </span>
    </div>
  )
}

export function PlayerCardSheet({ player, pool, fixtureEase, onClose, onSwap, actions }: {
  player: RatingRow
  /** Candidates for the compare tab — normally every rated player. */
  pool: RatingRow[]
  /** Upcoming fixtures, so the card can show the run rather than the maths. */
  fixtureEase?: FixtureEaseRow[]
  onClose: () => void
  /** Optional: perform a transfer in the caller's squad. */
  onSwap?: (out: RatingRow, incoming: RatingRow) => void
  /** Optional: squad controls (captain, bench, transfer) when the card is
   *  opened from a team the reader owns rather than from a browse list. */
  actions?: ReactNode
}) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'rating' | 'compare'>('rating')
  const avail = useAvailability()
  const [show, setShow] = useState<'rating' | 'xpts'>('rating')
  const [rivalId, setRivalId] = useState<number | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const pos = String(player.position)
  const rating = ratingTo100(num(player, 'season_overall_score'))
  const price = num(player, 'price')
  const peers = useMemo(
    () => pool.filter((p) => p.position === pos && p.element !== player.element && ratingTo100(num(p, 'season_overall_score')) != null),
    [pool, pos, player.element],
  )
  // Default rival: the best-rated cheaper player — the question you were
  // about to ask anyway.
  const defaultRival = useMemo(() => {
    if (rating == null || price == null) return peers[0] ?? null
    const cheaper = peers.filter((p) => (num(p, 'price') ?? 99) < price)
    const sorted = [...(cheaper.length ? cheaper : peers)].sort(
      (a, b) => (ratingTo100(num(b, 'season_overall_score')) ?? 0) - (ratingTo100(num(a, 'season_overall_score')) ?? 0),
    )
    return sorted[0] ?? null
  }, [peers, rating, price])
  const rival = rivalId != null ? peers.find((p) => p.element === rivalId) ?? defaultRival : defaultRival

  const adjusted = num(player, 'season_xpts_adjusted')
  const next = useMemo(
    () => (fixtureEase ?? []).filter((f) => f.team === player.team).sort((a, b) => a.gw - b.gw).slice(0, 4),
    [fixtureEase, player.team],
  )

  const dims = dimsFor(pos)
  // Exact, not star-quantised: the norm column has the value to the number.
  const dimVal = (r: RatingRow, col: string) => exactTo100(r, col)
  const weakest = dims.reduce<{ label: string; v: number } | null>((acc, [label, col]) => {
    const v = dimVal(player, col)
    return v != null && (acc == null || v < acc.v) ? { label, v } : acc
  }, null)

  const rivalRating = rival ? ratingTo100(num(rival, 'season_overall_score')) : null
  const rivalPrice = rival ? num(rival, 'price') : null
  const priceGap = price != null && rivalPrice != null ? price - rivalPrice : null

  return createPortal(
    // Same trap as the squad breakdown had: 90vh ignores a phone's browser
    // chrome, so the panel outgrew the visible area and centring pushed the
    // header — and the close button with it — off the top. Cap in dvh, make
    // the header a fixed row and let only the body scroll.
    <div className="fixed inset-0 z-[210] grid place-items-center bg-black/70 p-3 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flex max-h-[88dvh] w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border border-line-mid bg-surface-1 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          <PlayerPhoto
            code={num(player, 'code')} element={num(player, 'element')}
            className="w-11 shrink-0 rounded-lg object-cover object-top" style={{ height: 54 }}
            placeholder={<span className="block w-11 shrink-0 rounded-lg bg-surface-3" style={{ height: 54 }} />}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[18px] font-extrabold tracking-[-0.01em] text-ink">{String(player.web_name)}</div>
            <div className="text-[12.5px] text-ink-2">{pos} · {teamLabel(String(player.team))} · £{price}m{player.selected_by_percent != null ? ` · ${player.selected_by_percent}% owned` : ''}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="metallic-num font-display text-[34px] leading-none">
              {show === 'xpts' ? (adjusted != null ? adjusted.toFixed(1) : '—') : (rating ?? '—')}
            </div>
            <button
              onClick={() => setShow((v) => (v === 'rating' ? 'xpts' : 'rating'))}
              className="mt-0.5 text-[10px] font-extrabold tracking-[0.12em] text-ink-3 uppercase transition-colors hover:text-accent"
              title="Switch between the FPL Analyser rating and expected points a game"
            >
              {show === 'xpts' ? 'xPts / game ⇄' : 'Rating ⇄'}
            </button>
          </div>
          <button onClick={onClose} aria-label="Close" className="shrink-0 rounded-lg p-1.5 text-ink-3 transition-colors hover:text-ink"><Icon name="x" size={18} /></button>
        </div>
        <AvailabilityBand player={player} fixtureEase={fixtureEase} avail={avail} />
        {actions && (
          <div className="shrink-0 border-b border-line bg-surface-2/40 px-4 py-2.5">{actions}</div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">

        {/* tabs */}
        <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
          {([['rating', 'Rating'], ['compare', 'Compare']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`min-h-8 rounded-full border px-3.5 text-[13px] font-semibold transition-colors ${
                tab === id ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => navigate(playerHref(String(player.web_name), num(player, 'code')))}
            className="min-h-8 rounded-full border border-line-mid px-3.5 text-[13px] font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
          >
            Full profile ↗
          </button>
        </div>

        <div className="px-4 py-4">
          {tab === 'rating' ? (
            <Exportable title={`${player.web_name} — rating breakdown`}>
              <div className="rounded-xl border border-line bg-surface-1 p-3.5">
                <div className="mb-2.5 text-[11px] font-extrabold tracking-[0.2em] text-accent uppercase">What the {rating ?? '—'} is made of</div>
                <div className="grid gap-2">
                  {dims.map(([label, col]) => {
                    const v = dimVal(player, col)
                    return <Bar key={label} label={label} value={v} tone={v != null && v >= 80 ? 'good' : v != null && v < 40 ? 'bad' : undefined} />
                  })}
                </div>
                {/* The next four fixtures, not the derivation. What the rating
                    is made of belongs on the card; how it is calculated does
                    not need to be printed for anyone to copy. */}
                {next.length > 0 && (
                  <div className="mt-3.5 rounded-lg border border-line bg-surface-2/60 px-3 py-2.5">
                    <div className="mb-1.5 text-[10px] font-extrabold tracking-[0.16em] text-ink-3 uppercase">Next {next.length}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {next.map((f) => {
                        const [bg, fg] = FDR_COLORS[f.fdr] || FDR_COLORS[3]
                        return (
                          <span key={f.gw} className="rounded px-2 py-1 text-[12px] font-bold" style={{ background: bg, color: fg }}>
                            {f.opponent} ({f.venue})<span className="ml-1 opacity-70">GW{f.gw}</span>
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}
                {weakest && (
                  <p className="mt-3 border-t border-line pt-2.5 text-[13.5px] text-ink-2">
                    Weakest link: <b className="text-ink">{weakest.label} at {weakest.v}</b>
                    {weakest.label === 'Value' ? ' — the premium you accept for the rest.' : ' — the part of his game to cover elsewhere.'}
                  </p>
                )}
              </div>
            </Exportable>
          ) : rival ? (
            <Exportable title={`${player.web_name} vs ${rival.web_name}`}>
              <div className="rounded-xl border border-line bg-surface-1 p-3.5">
                <div className="mb-3 grid grid-cols-[1fr_44px_1fr] items-center gap-2">
                  <div className="text-center">
                    <div className="metallic-num font-display text-[26px] leading-none">{rating ?? '—'}</div>
                    <div className="mt-1 truncate text-[13px] font-bold text-ink">{String(player.web_name)}</div>
                    <div className="text-[11px] text-ink-3">{player.team} · £{price}m</div>
                  </div>
                  <div className="text-center text-[10px] font-extrabold tracking-[0.1em] text-ink-3">VS</div>
                  <div className="text-center">
                    <div className="font-display text-[26px] leading-none text-info">{rivalRating ?? '—'}</div>
                    <div className="mt-1 truncate text-[13px] font-bold text-ink">{String(rival.web_name)}</div>
                    <div className="text-[11px] text-ink-3">{rival.team} · £{rivalPrice}m</div>
                  </div>
                </div>
                {dims.map(([label, col]) => (
                  <CompareRow key={label} label={label} a={dimVal(player, col)} b={dimVal(rival, col)} />
                ))}
                {priceGap != null && rating != null && rivalRating != null && (
                  <p className="mt-3 border-t border-line pt-2.5 text-[13.5px] text-ink-2">
                    {Math.abs(rating - rivalRating) <= 3
                      ? <>Effectively level on rating, <b className="text-ink">£{Math.abs(priceGap).toFixed(1)}m apart</b> — the cheaper man frees money for elsewhere.</>
                      : rating > rivalRating
                        ? <><b className="text-ink">{String(player.web_name)}</b> is {rating - rivalRating} rating points better for £{Math.abs(priceGap).toFixed(1)}m more.</>
                        : <><b className="text-ink">{String(rival.web_name)}</b> rates {rivalRating - rating} higher and costs £{Math.abs(priceGap).toFixed(1)}m {priceGap > 0 ? 'less' : 'more'}.</>}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-[12px] text-ink-2">
                    Compare with
                    <select
                      value={rival.element}
                      onChange={(e) => setRivalId(Number(e.target.value))}
                      className="min-h-8 max-w-[190px] rounded-lg border border-line-mid bg-surface-2 px-2 text-[13px] text-ink focus:border-line-strong focus:outline-none"
                    >
                      {[...peers]
                        .sort((a, b) => (ratingTo100(num(b, 'season_overall_score')) ?? 0) - (ratingTo100(num(a, 'season_overall_score')) ?? 0))
                        .slice(0, 60)
                        .map((p) => (
                          <option key={p.element} value={p.element}>
                            {String(p.web_name)} · {ratingTo100(num(p, 'season_overall_score'))} · £{num(p, 'price')}m
                          </option>
                        ))}
                    </select>
                  </label>
                  {onSwap && (
                    <button
                      onClick={() => { onSwap(player, rival); onClose() }}
                      className="min-h-9 rounded-lg border border-accent bg-accent-soft px-3.5 text-[13px] font-semibold text-accent"
                    >
                      Swap in {String(rival.web_name)}
                    </button>
                  )}
                </div>
              </div>
            </Exportable>
          ) : (
            <p className="py-6 text-center text-sm text-ink-3">No rated alternatives in this position yet.</p>
          )}
        </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** What FPL says about a flagged player, and the one thing it doesn't: which
 *  gameweek you actually get him back for.
 *
 *  The board can only afford a colour and three letters. This is where the
 *  detail belongs — the club's own wording, how old it is, and the fixture
 *  he is expected to return in, worked out by the same rule the projection
 *  uses so the two can never disagree. Renders nothing for a fit player. */
function AvailabilityBand({ player, fixtureEase, avail }: {
  player: RatingRow
  fixtureEase?: FixtureEaseRow[]
  avail: ReturnType<typeof useAvailability>
}) {
  const live = availFor(avail, num(player, 'element'), num(player, 'code'))
  const flag = availBadge(live)
  if (!live || !flag) return null

  const gws = [...new Set((fixtureEase ?? []).map((f) => f.gw))].sort((a, b) => a - b)
  const fromGw = gws[0]
  const back = fromGw != null ? returnsInGw(live, avail, fromGw) : null
  const backFix = back != null
    ? (fixtureEase ?? []).find((f) => f.team === player.team && f.gw === back)
    : undefined
  const age = newsAge(live.news_added)
  const c = SEV_COLOUR[flag.sev]
  const missing = back != null && fromGw != null ? back - fromGw : null
  // FPL's chance-of-playing lags its own news line: a player whose return
  // date is this weekend can still be carrying a stale 0%. Where a date
  // exists the model uses it and ignores the percentage, so showing both
  // would put a contradiction on the card. Only the one being used is shown.
  const dated = returnDateFrom(live) != null

  return (
    <div className="shrink-0 border-b border-line" style={{ background: `color-mix(in oklab, ${c.bar} 12%, transparent)` }}>
      <span className="block h-1 w-full" style={{ background: c.bar }} />
      <div className="flex items-start gap-2.5 px-4 py-2.5">
        <span className="mt-[3px] size-2.5 shrink-0 rounded-full" style={{ background: c.bar }} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[13.5px] font-extrabold text-ink">{STATUS_WORD[live.status] ?? 'Flagged'}</span>
            {!dated && live.chance != null && (
              <span className="text-[12.5px] text-ink-2">{live.chance}% chance of playing</span>
            )}
            {age && <span className="ml-auto text-[11px] text-ink-3">reported {age}</span>}
          </div>
          {live.news && <div className="mt-0.5 text-[12.5px] text-ink-2">{live.news}</div>}
          <div className="mt-1 text-[12.5px]">
            {back == null ? (
              <span className="text-ink-3">No return date given — treated as out until FPL says otherwise.</span>
            ) : !dated ? (
              <span className="text-ink-3">No return date given — the chance of playing above is all FPL has said.</span>
            ) : (
              <span className="text-ink">
                Back for <span className="font-bold">GW{back}</span>
                {backFix ? ` ${backFix.venue === 'H' ? 'vs' : 'away to'} ${teamLabel(String(backFix.opponent))}` : ''}
                {missing ? <span className="text-ink-3"> — misses {missing} {missing === 1 ? 'gameweek' : 'gameweeks'} before that</span> : <span className="text-ink-3"> — available this week</span>}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
