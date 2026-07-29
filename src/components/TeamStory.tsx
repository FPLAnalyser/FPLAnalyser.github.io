import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { FixtureChips } from './FixtureChips'
import { PlayerPhoto } from './PlayerPhoto'
import { num, str } from '../lib/rows'
import { windowGames } from '../lib/fixtureRuns'
import { playerHref } from '../lib/util'
import type { CoreData, RatingRow, Row, TeamRatingRow } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   Team story layer: verdict → decision row → modules → "the route in".
   Every module ends in a player decision — team analysis without a
   "so buy…" is trivia.
   ════════════════════════════════════════════════════════════════════════ */

const pct = (v: number | null | undefined) => (v == null ? null : `${Math.round(v * 100)}%`)

function Sentence({ children }: { children: ReactNode }) {
  return <p className="text-[16.5px] leading-snug font-semibold tracking-[-0.01em] text-ink [&_em]:not-italic [&_em]:text-accent-2">{children}</p>
}
function Support({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{children}</p>
}
function Kick({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-[11px] font-extrabold tracking-[0.2em] text-accent-2 uppercase">{children}</div>
}
function BarRow({ label, width, value, tone }: { label: string; width: number; value: string; tone?: 'gold' | 'good' | 'warn' | 'bad' | 'info' }) {
  const grad: Record<string, string> = {
    gold: 'linear-gradient(90deg, var(--accent-strong), var(--accent-2))',
    good: 'linear-gradient(90deg, #1d7a49, #3ddc7a)',
    warn: 'linear-gradient(90deg, #a06c19, #e8b04a)',
    bad: 'linear-gradient(90deg, #8f2f2c, #f0736f)',
    info: 'linear-gradient(90deg, #2f5fa8, #6ea8ff)',
  }
  return (
    <div className="grid grid-cols-[100px_1fr_56px] items-center gap-2.5 text-[13px]">
      <span className="text-[11px] font-bold tracking-[0.07em] text-ink-2 uppercase">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-white/8">
        <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.min(100, width))}%`, background: grad[tone ?? 'gold'] }} />
      </div>
      <span className="text-right font-num font-extrabold tabular-nums">{value}</span>
    </div>
  )
}

function DCell({ label, word, tone, sub }: { label: string; word: ReactNode; tone?: string; sub?: string }) {
  return (
    <div className="bg-bg-1 px-4 py-3">
      <div className="mb-1 text-[10px] font-extrabold tracking-[0.16em] text-ink-3 uppercase">{label}</div>
      <div className={`text-[16px] font-extrabold ${tone ?? 'text-ink'}`}>{word}</div>
      {sub && <div className="mt-0.5 text-[12.5px] text-ink-2">{sub}</div>}
    </div>
  )
}


/* ── route-in rows ── */

function BuyRow({ p, why, onOpen }: { p: RatingRow; why: string; onOpen: () => void }) {
  const rating = num(p, 'season_overall_score')
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-2.5 border-t border-line py-2 text-left transition-colors first:border-t-0 hover:bg-surface-2/50">
      <PlayerPhoto
        code={num(p, 'code')} element={num(p, 'element')}
        className="w-8 shrink-0 rounded-md object-cover object-top" style={{ height: 40 }}
        placeholder={<span className="block w-8 shrink-0 rounded-md bg-surface-3" style={{ height: 40 }} />}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold text-ink">{String(p.web_name)}</span>
        <span className="block text-[12.5px] text-ink-2">{String(p.position)} · £{p.price}m{rating != null ? ` · ${Math.round(rating * 20)} rated` : ''}</span>
      </span>
      <span className="max-w-[22ch] text-right text-[12px] leading-tight text-ink-2">{why}</span>
    </button>
  )
}

/* ════════ the component ════════ */

/** Games in a team-metrics window, so totals can normalise to per-game. The
 * season window carries season totals; 4gw/6gw windows carry 4/6-game
 * totals. Never show a window total as a rate — that's the 48.8-xG/game bug. */

/** Rank → verdict tier. The single source of truth for "good": the verdict
 * sentence, the decision cells and the route-in all read from here. */
const tierOf = (rank: number | null): 'strong' | 'mid' | 'weak' | null =>
  rank == null ? null : rank <= 6 ? 'strong' : rank <= 14 ? 'mid' : 'weak'

export function TeamStory({ team, data }: { team: string; data: CoreData }) {
  const navigate = useNavigate()
  const rating = (data.teamRatings as TeamRatingRow[]).find((t) => t.team === team && str(t, 'window') === 'season') ?? null
  const metrics = (data.teamMetrics as Row[]).find((t) => String(t.team) === team && str(t, 'window') === 'season') ?? null
  const hasFix = data.fixtureEase.some((fx) => fx.team === team)

  /* The third decision cell, in priority order: a real set-piece engine, a
     genuine one-man dependency, then the home/away split. The last of those
     replaced a "no single dependency" shrug — the split is never absent and
     never the same for two clubs, so the cell always earns its width. */
  const homePpg = metrics ? num(metrics, 'home_pts_per_gw') : null
  const awayPpg = metrics ? num(metrics, 'away_pts_per_gw') : null

  const players = (data.ratings as RatingRow[]).filter((p) => String(p.team) === team && num(p, 'season_overall_score') != null)
  const rated = (p: RatingRow) => (num(p, 'season_overall_score') ?? 0) * 20
  const byRating = [...players].sort((a, b) => rated(b) - rated(a))

  const aRank = rating ? num(rating, 'attack_rank') : null
  const dRank = rating ? num(rating, 'defence_rank') : null
  const spShare = rating ? num(rating, 'set_piece_share') : null
  const spThreat = rating ? Boolean(rating.set_piece_threat) : false
  const csRate = metrics ? num(metrics, 'cs_rate') : null
  const games = windowGames(metrics, data)
  const xg = metrics && num(metrics, 'team_xg') != null ? (num(metrics, 'team_xg') as number) / games : null
  const xgc = metrics && num(metrics, 'team_xgc') != null ? (num(metrics, 'team_xgc') as number) / games : null
  const top1 = metrics ? str(metrics, 'top1_player') : null
  const top1Share = metrics ? num(metrics, 'top1_share') : null

  /* ── the unknown (promoted) team ── */
  if (!rating && !players.length) {
    return (
      <div className="mb-5 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface-1 p-4">
          <Kick>What we know</Kick>
          <Sentence>Fixtures and squad roles — <em>the two signals that survive promotion</em>.</Sentence>
          {hasFix && <div className="mt-3"><FixtureChips fixtureEase={data.fixtureEase} team={team} n={6} /></div>}
        </div>
        <div className="rounded-xl border border-line bg-surface-1 p-4">
          <Kick>What we don't</Kick>
          <Sentence>Whether last season's level <em className="text-warn">survives this one</em>.</Sentence>
          <div className="mt-3 rounded-lg border border-dashed border-line-mid px-3 py-2.5 text-xs text-ink-3">
            Attack/defence ratings and player percentiles appear once real minutes are played — we don't fabricate evidence.
          </div>
        </div>
      </div>
    )
  }

  /* ── verdict sentence — generated from ranks only, so it can never
        contradict the decision cells ── */
  const aTier = tierOf(aRank)
  const dTier = tierOf(dRank)
  let verdict: ReactNode = null
  if (aTier === 'strong' && dTier === 'strong') verdict = <>A complete FPL ecosystem — <em>top-six at both ends</em> (#{aRank} attack, #{dRank} defence). The question isn't whether to invest, it's which price band.</>
  else if (aTier === 'strong' && dTier === 'weak') verdict = <><em>Buy the front, never the back.</em> A #{aRank} attack bolted to a #{dRank} defence that gives everything up.</>
  else if (dTier === 'strong' && aTier === 'weak') verdict = <>The defence is the product — <em>clean sheets and Def Con</em> from a #{dRank} back line. Attacking routes in are thin (#{aRank}).</>
  else if (aTier === 'weak' && dTier === 'weak') verdict = <>Bottom-third at <em>both ends</em> — #{aRank} attack, #{dRank} defence — so the case here <em className="text-warn">isn't the team, it's individuals</em>. Buy the players, not the badge.</>
  else if (aTier === 'strong') verdict = <>An <em>attack-first</em> side (#{aRank}) — the forward assets carry the FPL value.</>
  else if (dTier === 'strong') verdict = <>A <em>defence-first</em> side (#{dRank}) — the cheap clean-sheet route is the play.</>
  else verdict = <>Mid-table in every sense — #{aRank ?? '–'} attack, #{dRank ?? '–'} defence. <em>The fixtures decide</em> when their players are worth owning.</>

  /* ── decision-row reads (same tiers as the verdict) ── */
  const aWord = aRank == null ? 'Unrated' : aRank <= 4 ? 'Elite' : aTier === 'strong' ? 'Strong' : aTier === 'mid' ? 'Mid-pack' : 'Weak'
  const aTone = aRank == null ? 'text-info' : aTier === 'strong' ? 'text-good' : aTier === 'mid' ? 'text-ink' : 'text-bad'
  const dWord = dRank == null ? 'Unrated' : dRank <= 4 ? 'Best tier' : dTier === 'strong' ? 'Solid' : dTier === 'mid' ? 'Shaky' : 'Avoid'
  const dTone = dRank == null ? 'text-info' : dTier === 'strong' ? 'text-good' : dTier === 'mid' ? 'text-warn' : 'text-bad'

  /* ── route in ── */
  const topAtt = byRating.find((p) => p.position === 'MID' || p.position === 'FWD')
  // The def-con exception: a defender whose hit rate sits in the top decile
  // of the position earns points without clean sheets, so a weak defence
  // doesn't disqualify him. This is what surfaces the Andersens.
  const dcException = byRating.find((p) => p.position === 'DEF' && (num(p, 'season_pct_dc_hit') ?? 0) >= 90)
  const topDefOrGk = byRating.find((p) => (p.position === 'DEF' || p.position === 'GKP') && p !== dcException)
  const defTrap = dTier === 'weak'
  const topValue = [...players]
    .filter((p) => (num(p, 'price') ?? 99) <= 6 && p !== topAtt && p !== topDefOrGk && p !== dcException)
    .sort((a, b) => (num(b, 'season_value_score_rating') ?? 0) - (num(a, 'season_value_score_rating') ?? 0))[0]
  const attWhy = topAtt && top1 && String(topAtt.web_name) === top1 && top1Share != null && top1Share >= 0.15
    ? `The talisman — ${pct(top1Share)} of the team's points`
    : 'The highest-rated route into the attack'
  const dcWhy = dcException
    ? `Def-con floor: +2 in ${pct(num(dcException, 'season_m_dc_hit'))} of starts — top decile. Doesn't need the clean sheets.`
    : ''
  const defWhy = topDefOrGk
    ? (dTier === 'strong'
        ? 'Cheapest share of a real defence'
        : topDefOrGk.position === 'GKP' && defTrap
          ? 'Busy-keeper save points — the defence guarantees shots to stop'
          : (num(topDefOrGk, 'season_m_dc_hit') ?? 0) >= 0.45 ? 'Def Con floor — points without clean sheets' : 'Best of the defensive options')
    : ''
  // In a weak defence, only keepers (save points) and the def-con exception
  // survive; outfield defenders bought for clean sheets are the trap.
  const showTopDef = topDefOrGk != null && (!defTrap || topDefOrGk.position === 'GKP')

  const swing = homePpg != null && awayPpg != null ? homePpg - awayPpg : null
  const sig = spThreat
    ? { label: 'Signature', word: 'Set pieces', tone: 'metallic-num', sub: spShare != null ? `${pct(spShare)} of xG from corners & free kicks` : 'A real dead-ball threat' }
    : top1Share != null && top1Share >= 0.22
      ? { label: 'Signature', word: 'One-man team', tone: 'text-warn', sub: `${top1 ?? 'One player'} takes ${pct(top1Share)} of the points` }
      : swing != null && Math.abs(swing) >= 0.4
        ? {
            label: 'Home & away',
            word: swing > 0 ? 'Home side' : 'Travels well',
            tone: swing > 0 ? 'text-good' : 'text-info',
            sub: `${Math.abs(swing).toFixed(1)} points a game ${swing > 0 ? 'better at home' : 'better away'} — ${homePpg!.toFixed(1)} H · ${awayPpg!.toFixed(1)} A`,
          }
        : swing != null
          ? { label: 'Home & away', word: 'Same anywhere', tone: 'text-ink', sub: `${homePpg!.toFixed(1)} at home · ${awayPpg!.toFixed(1)} away — venue is not the story` }
          : { label: 'Signature', word: 'Appears after GW1', tone: 'text-ink-3', sub: 'Needs a played season to describe' }

  return (
    <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-start">
      <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-line bg-surface-1 p-4">
        <Kick>The brief</Kick>
        <Sentence>{verdict}</Sentence>
        {(xg != null || csRate != null) && (
          <Support>
            {xg != null && <><b className="text-ink">{xg.toFixed(2)} xG/game</b>{aRank != null ? ` (#${aRank})` : ''}</>}
            {xgc != null && <> · <b className="text-ink">{xgc.toFixed(2)} xGC/game</b>{dRank != null ? ` (#${dRank})` : ''}</>}
            {csRate != null && <> · clean sheets in <b className="text-ink">{pct(csRate)}</b> of games</>}
            {top1Share != null && top1 && (top1Share >= 0.22
              ? <> · {top1} alone takes <b className="text-ink">{pct(top1Share)}</b> of the points</>
              : <> · no player takes more than <b className="text-ink">{pct(top1Share)}</b> of the points</>)}
          </Support>
        )}
      </div>

      {/* the one decision band — these facts appear nowhere else.

          The third cell used to fall back to "Spread threat · No single
          dependency", which is a shrug: it fired for most of the league and
          told a reader nothing they could act on. It now falls back to the
          home-and-away split, which is always true, always different between
          clubs, and decides which of two similar players to start.

          The Next 6 chips have gone with the fourth cell — the fixtures are
          laid out properly further down the page, and there is no reason for
          this page to list them twice. */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
        <DCell label="Attack" word={aWord} tone={aTone} sub={aRank != null ? `#${aRank} of 20${xg != null ? ` · ${xg.toFixed(2)} xG/game` : ''}` : 'Appears after GW1'} />
        <DCell label="Clean sheets" word={dWord} tone={dTone} sub={csRate != null ? `CS in ${pct(csRate)}${xgc != null ? ` · ${xgc.toFixed(2)} xGC/game` : ''}` : dRank != null ? `#${dRank} defence` : 'Appears after GW1'} />
        <DCell label={sig.label} word={sig.word} tone={sig.tone} sub={sig.sub} />
      </div>
      </div>

      {/* the route in */}
      {(topAtt || dcException || showTopDef || topValue) && (
        <div className="rounded-xl border border-line bg-surface-1 p-4">
          <Kick>The route in — ranked</Kick>
          <div className="mt-1">
            {dcException && defTrap && <BuyRow p={dcException} why={dcWhy} onOpen={() => navigate(playerHref(String(dcException.web_name), num(dcException, 'code')))} />}
            {topAtt && <BuyRow p={topAtt} why={attWhy} onOpen={() => navigate(playerHref(String(topAtt.web_name), num(topAtt, 'code')))} />}
            {dcException && !defTrap && <BuyRow p={dcException} why={dcWhy} onOpen={() => navigate(playerHref(String(dcException.web_name), num(dcException, 'code')))} />}
            {showTopDef && <BuyRow p={topDefOrGk!} why={defWhy} onOpen={() => navigate(playerHref(String(topDefOrGk!.web_name), num(topDefOrGk!, 'code')))} />}
            {topValue && <BuyRow p={topValue} why="Best value per £ in the squad" onOpen={() => navigate(playerHref(String(topValue.web_name), num(topValue, 'code')))} />}
            {defTrap && (
              <div className="flex items-center gap-2.5 border-t border-line py-2">
                <span className="grid w-8 shrink-0 place-items-center text-lg font-extrabold text-bad">✕</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-ink">The clean-sheet case</span>
                  <span className="block text-[12.5px] text-ink-2">Any defender bought for clean sheets</span>
                </span>
                <span className="max-w-[26ch] text-right text-[11px] leading-tight text-bad">
                  {csRate != null ? `CS in ${pct(csRate)}, ` : ''}#{dRank} defence — buy the def-con, never the clean sheets
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Points-mix receipt (goals / assists / clean sheets share of FPL points) —
 * lives in the folded receipts on the Teams page, stated once. */
export function PointsMix({ team, data }: { team: string; data: CoreData }) {
  const metrics = (data.teamMetrics as Row[]).find((t) => String(t.team) === team && str(t, 'window') === 'season') ?? null
  const rating = (data.teamRatings as TeamRatingRow[]).find((t) => t.team === team && str(t, 'window') === 'season') ?? null
  if (!metrics) return null
  const spThreat = rating ? Boolean(rating.set_piece_threat) : false
  const spShare = rating ? num(rating, 'set_piece_share') : null
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <Kick>Where the points come from</Kick>
      <Sentence>
        {(num(metrics, 'cs_pts_pct') ?? 0) > (num(metrics, 'goal_pts_pct') ?? 0)
          ? <>A <em>defence-led</em> points profile — clean sheets before goals.</>
          : <>An <em>attack-led</em> points profile — goals carry the load.</>}
      </Sentence>
      <div className="mt-3 flex flex-col gap-2">
        {num(metrics, 'goal_pts_pct') != null && <BarRow label="Goals" width={num(metrics, 'goal_pts_pct')! * 180} value={pct(num(metrics, 'goal_pts_pct')) ?? '—'} />}
        {num(metrics, 'assist_pts_pct') != null && <BarRow label="Assists" width={num(metrics, 'assist_pts_pct')! * 180} value={pct(num(metrics, 'assist_pts_pct')) ?? '—'} tone="info" />}
        {num(metrics, 'cs_pts_pct') != null && <BarRow label="Clean sheets" width={num(metrics, 'cs_pts_pct')! * 180} value={pct(num(metrics, 'cs_pts_pct')) ?? '—'} tone="good" />}
      </div>
      {spThreat && spShare != null && (
        <Support>Plus the set-piece engine: {pct(spShare)} of their xG starts from a corner or free kick — their defenders out-score most teams' midfielders.</Support>
      )}
    </div>
  )
}
