import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { FixtureChips } from './FixtureChips'
import { PlayerPhoto } from './PlayerPhoto'
import { num, str } from '../lib/rows'
import { playerHref } from '../lib/util'
import type { CoreData, FixtureEaseRow, RatingRow, Row, TeamRatingRow } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   Team story layer: verdict → decision row → modules → "the route in".
   Every module ends in a player decision — team analysis without a
   "so buy…" is trivia.
   ════════════════════════════════════════════════════════════════════════ */

const pct = (v: number | null | undefined) => (v == null ? null : `${Math.round(v * 100)}%`)

function Sentence({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-snug font-semibold tracking-[-0.01em] text-ink [&_em]:not-italic [&_em]:text-accent-2">{children}</p>
}
function Support({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{children}</p>
}
function Kick({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-[10px] font-extrabold tracking-[0.2em] text-accent-2 uppercase">{children}</div>
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
    <div className="grid grid-cols-[92px_1fr_52px] items-center gap-2.5 text-xs">
      <span className="text-[10px] font-bold tracking-[0.07em] text-ink-2 uppercase">{label}</span>
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
      <div className="mb-1 text-[9px] font-extrabold tracking-[0.16em] text-ink-3 uppercase">{label}</div>
      <div className={`text-[15px] font-extrabold ${tone ?? 'text-ink'}`}>{word}</div>
      {sub && <div className="mt-0.5 text-[11px] text-ink-2">{sub}</div>}
    </div>
  )
}

function fixtureSummary(fixtureEase: FixtureEaseRow[], team: string, n = 6) {
  const up = fixtureEase.filter((fx) => fx.team === team).sort((a, b) => a.gw - b.gw).slice(0, n)
  if (!up.length) return null
  const avgFdr = up.reduce((s, fx) => s + (fx.fdr || 3), 0) / up.length
  return Math.round(((5 - avgFdr) / 4) * 100)
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
        <span className="block truncate text-sm font-bold text-ink">{String(p.web_name)}</span>
        <span className="block text-[11px] text-ink-2">{String(p.position)} · £{p.price}m{rating != null ? ` · ${Math.round(rating * 20)} rated` : ''}</span>
      </span>
      <span className="max-w-[19ch] text-right text-[11px] leading-tight text-ink-2">{why}</span>
    </button>
  )
}

/* ════════ the component ════════ */

export function TeamStory({ team, data }: { team: string; data: CoreData }) {
  const navigate = useNavigate()
  const rating = (data.teamRatings as TeamRatingRow[]).find((t) => t.team === team && str(t, 'window') === 'season') ?? null
  const metrics = (data.teamMetrics as Row[]).find((t) => String(t.team) === team && str(t, 'window') === 'season') ?? null
  const ease6 = fixtureSummary(data.fixtureEase, team)
  const hasFix = data.fixtureEase.some((fx) => fx.team === team)

  const players = (data.ratings as RatingRow[]).filter((p) => String(p.team) === team && num(p, 'season_overall_score') != null)
  const rated = (p: RatingRow) => (num(p, 'season_overall_score') ?? 0) * 20
  const byRating = [...players].sort((a, b) => rated(b) - rated(a))

  const aRank = rating ? num(rating, 'attack_rank') : null
  const dRank = rating ? num(rating, 'defence_rank') : null
  const spShare = rating ? num(rating, 'set_piece_share') : null
  const spThreat = rating ? Boolean(rating.set_piece_threat) : false
  const csRate = metrics ? num(metrics, 'cs_rate') : null
  const xg = metrics ? num(metrics, 'team_xg') : null
  const xgc = metrics ? num(metrics, 'team_xgc') : null
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

  /* ── verdict sentence ── */
  const strongA = aRank != null && aRank <= 6
  const strongD = dRank != null && dRank <= 6
  const weakA = aRank != null && aRank >= 15
  const weakD = dRank != null && dRank >= 15
  let verdict: ReactNode = null
  if (strongA && strongD) verdict = <>A complete FPL ecosystem — <em>attack and defence both elite</em>. The question isn't whether to invest, it's which price band.</>
  else if (strongA && weakD) verdict = <><em>Buy the front, never the back.</em> A real attack bolted to a defence that gives everything up.</>
  else if (strongD && weakA) verdict = <>The defence is the product — <em>clean sheets and Def Con</em>. Attacking routes in are thin.</>
  else if (weakA && weakD) verdict = <>Hard to love: <em className="text-warn">no reliable route in</em> at either end. Enablers and fixture punts only.</>
  else if (strongA) verdict = <>An <em>attack-first</em> side — the forward assets carry the FPL value.</>
  else if (strongD) verdict = <>A <em>defence-first</em> side — the cheap clean-sheet route is the play.</>
  else verdict = <>Mid-table in every sense — <em>the fixtures decide</em> when their players are worth owning.</>

  /* ── decision-row reads ── */
  const aWord = aRank == null ? 'Unrated' : aRank <= 4 ? 'Elite' : aRank <= 8 ? 'Strong' : aRank <= 14 ? 'Mid-pack' : 'Weak'
  const aTone = aRank == null ? 'text-info' : aRank <= 8 ? 'text-good' : aRank <= 14 ? 'text-ink' : 'text-bad'
  const dWord = dRank == null ? 'Unrated' : dRank <= 4 ? 'Best tier' : dRank <= 8 ? 'Solid' : dRank <= 14 ? 'Shaky' : 'Avoid'
  const dTone = dRank == null ? 'text-info' : dRank <= 8 ? 'text-good' : dRank <= 14 ? 'text-warn' : 'text-bad'

  /* ── route in ── */
  const topAtt = byRating.find((p) => p.position === 'MID' || p.position === 'FWD')
  const topDefOrGk = byRating.find((p) => p.position === 'DEF' || p.position === 'GKP')
  const topValue = [...players]
    .filter((p) => (num(p, 'price') ?? 99) <= 6 && p !== topAtt && p !== topDefOrGk)
    .sort((a, b) => (num(b, 'season_value_score_rating') ?? 0) - (num(a, 'season_value_score_rating') ?? 0))[0]
  const attWhy = topAtt && top1 && String(topAtt.web_name) === top1 && top1Share != null
    ? `The talisman — ${pct(top1Share)} of the team's points`
    : 'The highest-rated route into the attack'
  const defWhy = topDefOrGk
    ? (dRank != null && dRank <= 6 ? 'Cheapest share of a real defence' : (num(topDefOrGk, 'season_m_dc_hit') ?? 0) >= 0.45 ? 'Def Con floor — points without sheets' : 'Best of the defensive options')
    : ''
  const defTrap = dRank != null && dRank >= 15

  return (
    <div className="mb-5 flex flex-col gap-4">
      <div className="rounded-xl border border-line bg-surface-1 p-4"><Sentence>{verdict}</Sentence></div>

      {/* decision row */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <DCell label="Attack" word={aWord} tone={aTone} sub={aRank != null ? `#${aRank} of 20${xg != null ? ` · ${xg.toFixed(1)} xG/game` : ''}` : 'Appears after GW1'} />
        <DCell label="Clean-sheet odds" word={dWord} tone={dTone} sub={csRate != null ? `CS in ${pct(csRate)}${xgc != null ? ` · ${xgc.toFixed(1)} xGC/game` : ''}` : dRank != null ? `#${dRank} defence` : 'Appears after GW1'} />
        <DCell
          label="Signature"
          word={spThreat ? 'Set pieces' : top1Share != null && top1Share >= 0.22 ? 'One-man team' : 'Spread threat'}
          tone={spThreat ? 'metallic-num' : top1Share != null && top1Share >= 0.22 ? 'text-warn' : 'text-ink'}
          sub={spThreat && spShare != null ? `${pct(spShare)} of xG from corners & free kicks` : top1Share != null && top1Share >= 0.22 ? `${top1 ?? 'One player'} takes ${pct(top1Share)} of the points` : 'No single dependency'}
        />
        {hasFix && (
          <div className="bg-bg-1 px-4 py-3">
            <div className="mb-1 text-[9px] font-extrabold tracking-[0.16em] text-ink-3 uppercase">Next 6{ease6 != null ? ` · ease ${ease6}` : ''}</div>
            <div className="mt-1.5"><FixtureChips fixtureEase={data.fixtureEase} team={team} n={6} /></div>
          </div>
        )}
      </div>

      {/* modules */}
      <div className="grid items-start gap-3 md:grid-cols-2">
        {metrics && (
          <div className="rounded-xl border border-line bg-surface-1 p-4">
            <Kick>Where the points come from</Kick>
            <Sentence>
              {(num(metrics, 'cs_pts_pct') ?? 0) > (num(metrics, 'goal_pts_pct') ?? 0)
                ? <>A <em>defence-led</em> points profile — sheets before goals.</>
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
        )}

        {xg != null && xgc != null && (
          <div className="rounded-xl border border-line bg-surface-1 p-4">
            <Kick>The two truths</Kick>
            <Sentence>
              {xg >= 1.5 && xgc >= 1.5 ? <>Attack like the good sides, <em className="text-bad">defend like the bad ones</em> — chaos, priced accordingly.</>
                : xg >= 1.5 ? <>Create plenty, <em>concede little</em> — control at both ends.</>
                : xgc <= 1.2 ? <>Low-event football: <em>few goals, fewer conceded</em>. Sheets over hauls.</>
                : <>Out-created more often than not — <em className="text-warn">returns lean on moments</em>.</>}
            </Sentence>
            <div className="mt-3 flex flex-col gap-2">
              <BarRow label="xG / game" width={xg * 38} value={xg.toFixed(1)} tone="good" />
              <BarRow label="xGC / game" width={xgc * 38} value={xgc.toFixed(1)} tone={xgc >= 1.5 ? 'bad' : 'info'} />
            </div>
          </div>
        )}

        {(topAtt || topDefOrGk) && (
          <div className="rounded-xl border border-line bg-surface-1 p-4 md:col-span-2">
            <Kick>The route in — ranked</Kick>
            <div className="mt-1">
              {topAtt && <BuyRow p={topAtt} why={attWhy} onOpen={() => navigate(playerHref(String(topAtt.web_name), num(topAtt, 'code')))} />}
              {topDefOrGk && !defTrap && <BuyRow p={topDefOrGk} why={defWhy} onOpen={() => navigate(playerHref(String(topDefOrGk.web_name), num(topDefOrGk, 'code')))} />}
              {topValue && <BuyRow p={topValue} why="Best value per £ in the squad" onOpen={() => navigate(playerHref(String(topValue.web_name), num(topValue, 'code')))} />}
              {defTrap && (
                <div className="flex items-center gap-2.5 border-t border-line py-2">
                  <span className="grid w-8 shrink-0 place-items-center text-lg font-extrabold text-bad">✕</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-ink">Their defenders</span>
                    <span className="block text-[11px] text-ink-2">Any price</span>
                  </span>
                  <span className="max-w-[24ch] text-right text-[11px] leading-tight text-bad">#{dRank} defence — enablers only, never starters</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
