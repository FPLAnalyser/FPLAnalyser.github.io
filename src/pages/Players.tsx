import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageShell, EmptyState } from '../components/PageShell'
import { SectionBanner } from '../components/SectionBanner'
import { SearchBox } from '../components/SearchBox'
import { StarRating, ratingTo100 } from '../components/StarRating'
import { MiniBar, ConcentrationBar, CHART_COLORS, type Tone } from '../components/viz'
import { InfoTip } from '../components/InfoTip'
import { Icon, type IconName } from '../components/Icon'
import { TeamBadge, PositionIcon } from '../components/badges'
import { PageSkeleton } from '../components/Skeleton'
import { PlayerPhoto as PhotoImg } from '../components/PlayerPhoto'
import { ShareCard } from '../components/ShareCard'
import { DecisionRow, StoryModules, MatchupBars } from '../components/PlayerStory'
import { PlayerZoneMap } from '../components/ShotMap'
import { useCore } from '../lib/useData'
import { num, str, bool } from '../lib/rows'
import { teamFullNames, teamColors, TOOLTIPS } from '../lib/util'
import { buildPlayerBundle, buildPlayerVerdict } from '../lib/insights/narrative'
import type { CoreData, RatingRow } from '../lib/types'

const personaTip = (name: string): string | undefined => (TOOLTIPS.personas as Record<string, string>)[name]
const metricTip = (key: string): string | undefined => { const v = TOOLTIPS[key]; return typeof v === 'string' ? v : undefined }

// Dimension rows by position: [label, seasonCol, gw4Col, tipKey?]
type Dim = [string, string, string, string?]
const GKP_DIMS: Dim[] = [
  ['Save', 'season_save_score_rating', 'gw4_save_score_rating', 'save'],
  ['Clean Sheet', 'season_cs_score_rating', 'gw4_cs_score_rating', 'cs'],
  ['BPS / Bonus', 'season_bps_score_rating', 'gw4_bps_score_rating', 'bps'],
  ['Value', 'season_value_score_rating', 'gw4_value_score_rating', 'value'],
  ['Reliability', 'season_reliability_score_rating', 'gw4_reliability_score_rating', 'reliability'],
  ['90 Mins', 'season_mins90_score_rating', 'gw4_mins90_score_rating', 'mins90'],
]
const DEF_DIMS: Dim[] = [
  ['Clean Sheet', 'season_cs_score_rating', 'gw4_cs_score_rating', 'cs'],
  ['Def Contribution', 'season_dc_score_rating', 'gw4_dc_score_rating', 'dc'],
  ['Attacking', 'season_attacking_score_rating', 'gw4_attacking_score_rating', 'attacking'],
  ['Set Pieces', 'season_set_piece_score_rating', 'gw4_set_piece_score_rating', 'set_piece'],
  ['BPS / Bonus', 'season_bps_score_rating', 'gw4_bps_score_rating', 'bps'],
  ['Value', 'season_value_score_rating', 'gw4_value_score_rating', 'value'],
  ['Reliability', 'season_reliability_score_rating', 'gw4_reliability_score_rating', 'reliability'],
  ['90 Mins', 'season_mins90_score_rating', 'gw4_mins90_score_rating', 'mins90'],
]
const ATT_POS_DIMS: Dim[] = [
  ['Goal Threat', 'season_goal_score_rating', 'gw4_goal_score_rating', 'goal'],
  ['Shot Quality', 'season_shot_quality_score_rating', 'gw4_shot_quality_score_rating', 'shot_quality'],
  ['Finishing Skill', 'season_finishing_skill_score_rating', 'gw4_finishing_skill_score_rating', 'finishing_skill'],
  ['Creativity', 'season_creative_score_rating', 'gw4_creative_score_rating', 'creative'],
  ['Creativity Depth', 'season_creativity_depth_score_rating', 'gw4_creativity_depth_score_rating', 'creativity_depth'],
  ['Set Pieces', 'season_set_piece_score_rating', 'gw4_set_piece_score_rating', 'set_piece'],
  ['Def Contribution', 'season_dc_score_rating', 'gw4_dc_score_rating', 'dc'],
  ['BPS / Bonus', 'season_bps_score_rating', 'gw4_bps_score_rating', 'bps'],
  ['Value', 'season_value_score_rating', 'gw4_value_score_rating', 'value'],
  ['Reliability', 'season_reliability_score_rating', 'gw4_reliability_score_rating', 'reliability'],
  ['90 Mins', 'season_mins90_score_rating', 'gw4_mins90_score_rating', 'mins90'],
]

function PlayerPhoto({ code, element, pos, size }: { code: number | null; element?: number | null; pos: string; size: number }) {
  return (
    <PhotoImg
      code={code}
      element={element}
      className="rounded-lg object-cover object-top"
      style={{ width: size, height: size * 1.25 }}
      placeholder={<div className="grid place-items-center rounded-lg bg-surface-3 text-ink-3" style={{ width: size, height: size * 1.25 }}><PositionIcon pos={pos} size={size / 2.5} /></div>}
    />
  )
}

export default function Players() {
  const { data, error: coreError } = useCore()
  const [params, setParams] = useSearchParams()
  const name = params.get('name')
  const codeParam = params.get('code')

  const ratings = (data?.ratings ?? []) as RatingRow[]

  if (!data) {
    return (
      <PageShell>
        <SectionBanner imgKey="players" title="Player Search" subtitle="Search for any player to see their FPL Analyser ratings, stats and form" />
        <PageSkeleton error={coreError} />
      </PageShell>
    )
  }

  // Resolve by the PERMANENT player code first (web_name collides — e.g. two
  // Hendersons), with name only as a fallback for older/plain links.
  const select = (n: string, code?: number | null) => {
    setParams(code != null ? { name: n, code: String(code) } : n ? { name: n } : {})
    window.scrollTo(0, 0)
  }
  const selected = codeParam
    ? ratings.find((p) => String(num(p, 'code')) === codeParam) ?? (name ? ratings.find((p) => p.web_name === name) : null)
    : name
      ? ratings.find((p) => p.web_name === name)
      : null

  return (
    <PageShell>
      <SectionBanner imgKey="players" title="Player Search" subtitle="Search for any player to see their FPL Analyser ratings, stats and form" />
      <div className="mb-6">
        <SearchBox
          items={ratings.filter((p) => p.web_name)}
          getLabel={(p) => String(p.web_name)}
          renderItem={(p) => (
            <span className="flex w-full items-center justify-between gap-2">
              <span>{String(p.web_name)}</span>
              <span className="flex items-center gap-1.5 text-xs text-ink-3">{p.position} · <TeamBadge team={String(p.team)} size={12} />{p.team} · £{p.price}m</span>
            </span>
          )}
          onSelect={(p) => select(String(p.web_name), num(p, 'code'))}
          placeholder="Search player name…"
          initialValue={name ?? ''}
        />
      </div>

      {selected ? <PlayerCard player={selected} data={data} /> : <MostOwned ratings={ratings} data={data} onSelect={select} />}
    </PageShell>
  )
}

function MostOwned({ ratings, data, onSelect }: { ratings: RatingRow[]; data: CoreData; onSelect: (n: string, code?: number | null) => void }) {
  const top25 = useMemo(
    () => ratings.filter((p) => p.selected_by_percent != null && num(p, 'season_ok') !== 0).filter((p) => p.selected_by_percent).sort((a, b) => (b.selected_by_percent ?? 0) - (a.selected_by_percent ?? 0)).slice(0, 25),
    [ratings],
  )
  const streakByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of data.seasonToDate) m.set(String(s.web_name), String(s.streak ?? ''))
    return m
  }, [data.seasonToDate])

  return (
    <>
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink-2 uppercase">Most Owned Players</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {top25.map((p) => {
          const streak = streakByName.get(String(p.web_name))
          return (
            <button
              key={String(p.element)}
              onClick={() => onSelect(String(p.web_name), num(p, 'code'))}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface-1/60 p-3 text-left transition-colors hover:border-line-mid hover:bg-surface-2/60"
            >
              <PlayerPhoto code={p.code} element={p.element} pos={p.position} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-semibold text-ink">
                  {String(p.web_name)}
                  {streak === '🔥 Hot' && <span className="text-hot"><Icon name="flame" size={12} solid /></span>}
                  {streak === '🧊 Cold' && <span className="text-cold"><Icon name="snow" size={12} /></span>}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-xs text-ink-2">
                  {p.position} · <TeamBadge team={String(p.team)} size={12} />{teamFullNames[String(p.team)] || p.team} · £{p.price}m
                </div>
                <div className="mt-0.5 text-xs text-accent">{p.selected_by_percent}% owned</div>
                <div className="mt-1"><StarRating value={str(p, 'season_overall_rating')} size={10} showNum={false} /></div>
              </div>
            </button>
          )
        })}
      </div>
    </>
  )
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="mb-3 text-sm font-semibold tracking-wide text-ink-2 uppercase">{title}</h3>
      {children}
    </section>
  )
}

function Tile({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-3 py-2.5">
      <div className="font-num text-lg font-semibold tabular-nums text-ink">{value}</div>
      <div className="mt-0.5 flex items-center gap-1 text-[11px] tracking-wide text-ink-2 uppercase">{label}</div>
    </div>
  )
}

function PlayerCard({ player: r, data }: { player: RatingRow; data: CoreData }) {
  const name = String(r.web_name)
  const pos = r.position

  // Key related tables by the player's element (unique), never web_name.
  const p4 = data.personas4.find((p) => p.element === r.element) ?? null
  const std = data.seasonToDate.find((p) => p.element === r.element) ?? null
  const streak = std ? String(std.streak ?? '') : ''

  const verdict = useMemo(() => {
    const bundle = buildPlayerBundle(r.element, data)
    return bundle ? buildPlayerVerdict(bundle, data) : null
  }, [r.element, data])

  const personas = (p4 && str(p4, 'personas') && str(p4, 'personas') !== 'None') ? String(p4.personas).split(', ') : []
  const flags = p4 && str(p4, 'flags') ? String(p4.flags).split(', ') : []
  const isPenTaker = bool(r, 'is_pen_taker')
  const isSpTaker = bool(r, 'is_setpiece_taker')

  const dims = pos === 'GKP' ? GKP_DIMS : pos === 'DEF' ? DEF_DIMS : ATT_POS_DIMS
  const unknown = num(r, 'season_overall_score') == null

  // Positional peers with a real rating — powers the hero rank, the bullet
  // gauge's scale and the market scatter.
  const peers = useMemo(
    () => (data.ratings as RatingRow[]).filter((p) => p.position === pos && ratingTo100(num(p, 'season_overall_score')) != null),
    [data.ratings, pos],
  )

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-1/50">
      <PlayerHero r={r} peers={peers} verdict={verdict} personas={personas} flags={flags} isPenTaker={isPenTaker} isSpTaker={isSpTaker} streak={streak} />

      {/* Story-first flow: market scatter → decision row → story modules →
          receipts → matchup → shot evidence. Every module opens with a
          sentence; the numbers are the supporting cast. Unknown players get
          the know/don't-know page. */}
      <div className="px-5 pb-5 md:px-6 md:pb-6">
        {!unknown && <div className="mt-5"><MarketScatter r={r} peers={peers} /></div>}

        <div className="mt-5 mb-6"><DecisionRow r={r} fixtureEase={data.fixtureEase} /></div>

        <Section title="The Story"><StoryModules r={r} data={data} /></Section>

        {!unknown && <PointsEngine r={r} />}

        {!unknown && (
          <Section title={`Rating Profile — vs ${pos} players`}>
            <DimBars r={r} dims={dims} overall={['season_overall_score', 'gw4_overall_score']} />
          </Section>
        )}

        <div className="mt-6"><MatchupBars element={r.element} tierPerf={data.tierPerf} /></div>

        {pos !== 'GKP' && !unknown && (
          <>
            <Section title="Shot Zones"><PlayerZoneMap element={r.element} name={name} /></Section>
          </>
        )}

        <div className="mt-8 flex justify-center">
          <ShareCard r={r} fixtureEase={data.fixtureEase} />
        </div>
      </div>
    </div>
  )
}

/** The rating's receipts: expected points per game by source, the availability
 * adjustment, and how actual output compares (sustainability read). */
function PointsEngine({ r }: { r: RatingRow }) {
  const xpg = num(r, 'season_xpts_per_game')
  const adj = num(r, 'season_xpts_adjusted')
  const ppg = num(r, 'season_ppg')
  const start = num(r, 'season_start_rate')
  if (xpg == null) return null
  const availFactor = start != null ? Math.pow(Math.max(0, Math.min(1, start)), 0.75) : null
  const parts: [string, number | null][] = [
    ['Goals', num(r, 'season_xpts_goal')],
    ['Assists', num(r, 'season_xpts_assist')],
    ['Clean sheets', num(r, 'season_xpts_cs')],
    ['Def contribution', num(r, 'season_xpts_dc')],
    ['Saves', num(r, 'season_xpts_save')],
    ['Bonus', num(r, 'season_xpts_bonus')],
    ['Appearance', 2],
  ]
  const segments = parts
    .filter(([, v]) => (v ?? 0) > 0.01)
    .map(([label, v], i) => ({ label: `${label} — ${(v as number).toFixed(2)}`, value: v as number, color: CHART_COLORS[i % CHART_COLORS.length] }))
  const delta = ppg != null ? ppg - xpg : null
  const sustain =
    delta == null ? null
    : delta > 0.35 ? { cls: 'text-warn', icon: 'flame' as IconName, text: `Actual output is running ${delta.toFixed(1)} pts/game above expected — hot finishing that may cool.` }
    : delta < -0.35 ? { cls: 'text-good', icon: 'snow' as IconName, text: `Actual output is ${Math.abs(delta).toFixed(1)} pts/game below expected — the underlying numbers suggest an uptick is due.` }
    : { cls: 'text-ink-3', icon: 'target' as IconName, text: 'Delivering right in line with expected points — sustainable output.' }
  return (
    <Section title={<span className="inline-flex items-center gap-1">Points Engine <InfoTip text={TOOLTIPS.xpts as string} /></span>}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile value={xpg.toFixed(2)} label="xPts / Game" />
        <Tile value={availFactor != null ? `×${availFactor.toFixed(2)}` : '—'} label="Availability Factor" />
        <Tile value={adj != null ? adj.toFixed(2) : '—'} label="Adjusted xPts" />
        <Tile value={ppg != null ? ppg.toFixed(2) : '—'} label="Actual Pts / Game" />
      </div>
      {segments.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-[11px] tracking-wide text-ink-3 uppercase">Where the expected points come from</div>
          <ConcentrationBar segments={segments} />
        </div>
      )}
      {sustain && (
        <div className={`mt-3 flex items-start gap-2 text-sm ${sustain.cls}`}>
          <span className="mt-0.5"><Icon name={sustain.icon} size={14} /></span>
          <span>{sustain.text}</span>
        </div>
      )}
    </Section>
  )
}

/* ═══ Editorial player hero — "The Analyst" ═══════════════════════════════
   Always-dark quiet band: identity (photo, name, badges), the metallic
   rating with its positional rank, one-line verdict, then exactly two
   analytical graphics — the promise-vs-delivery bullet gauge and the
   percentile fingerprint. Everything else lives in the story below. */

const POS_LABEL: Record<string, string> = { GKP: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' }
const HERO_DIM = '#a89f8c'
const HERO_INK = '#f1efe9'
const HERO_GOLD = '#ead188' // logo-gold highlight (bright, legible on near-black)

function HeroSilhouette() {
  return (
    <svg viewBox="0 0 200 300" className="h-[92%]" aria-hidden="true">
      <path d="M100 20 a34 34 0 1 1 0 68 a34 34 0 1 1 0-68 M40 300 C40 210 62 160 100 160 C138 160 160 210 160 300 Z" fill="#151a24" />
    </svg>
  )
}

function HeroPill({ children, gold, warn, title }: { children: ReactNode; gold?: boolean; warn?: boolean; title?: string }) {
  const base = 'font-cond inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold tracking-[.14em] uppercase'
  if (gold) return <span title={title} className={`${base} font-extrabold text-[#10131b]`} style={{ background: 'linear-gradient(120deg,#ead188,#c9a227)' }}>{children}</span>
  return <span title={title} className={base} style={{ border: '1px solid rgba(201,162,39,.18)', color: warn ? '#e8b04a' : '#d6d0c2', background: 'rgba(255,255,255,.02)' }}>{children}</span>
}

function StatMini({ v, sub, k }: { v: ReactNode; sub?: string; k: string }) {
  return (
    <div>
      <div className="font-cond text-[22px] leading-none font-extrabold" style={{ color: HERO_INK }}>
        {v}{sub && <span className="ml-1 text-[12px] font-semibold" style={{ color: HERO_GOLD }}>{sub}</span>}
      </div>
      <div className="font-cond mt-1 text-[9.5px] font-semibold tracking-[.22em] uppercase" style={{ color: HERO_DIM }}>{k}</div>
    </div>
  )
}

// Fingerprint dimensions — five per position, the same score fields the
// dimension bars use, so the dot pattern and the receipts always agree.
const FP_DIMS: Record<string, [string, string][]> = {
  GKP: [['Saves', 'season_save_score_rating'], ['Clean sheets', 'season_cs_score_rating'], ['BPS / Bonus', 'season_bps_score_rating'], ['Value', 'season_value_score_rating'], ['Reliability', 'season_reliability_score_rating']],
  DEF: [['Clean sheets', 'season_cs_score_rating'], ['Def con', 'season_dc_score_rating'], ['Attacking', 'season_attacking_score_rating'], ['Set pieces', 'season_set_piece_score_rating'], ['Reliability', 'season_reliability_score_rating']],
  ATT: [['Goal threat', 'season_goal_score_rating'], ['Creativity', 'season_creative_score_rating'], ['Set pieces', 'season_set_piece_score_rating'], ['Def con', 'season_dc_score_rating'], ['Reliability', 'season_reliability_score_rating']],
}

/** Promise vs delivery: expected pts/game as the gold fill, actual as the
 * white marker, both on a scale set by the position's best. */
function BulletGauge({ r, peers }: { r: RatingRow; peers: RatingRow[] }) {
  const xpg = num(r, 'season_xpts_per_game')
  const ppg = num(r, 'season_ppg')
  if (xpg == null || ppg == null) return null
  const scale = Math.max(...peers.map((p) => Math.max(num(p, 'season_xpts_per_game') ?? 0, num(p, 'season_ppg') ?? 0)), xpg, ppg) || 1
  const delta = ppg - xpg
  const read = delta > 0.35 ? 'running hot — output above the underlying numbers' : delta < -0.35 ? 'running under — due an uptick' : 'delivering right on expectation'
  return (
    <div className="mt-5 max-w-xl">
      <div className="font-cond mb-2 text-[10px] font-extrabold tracking-[.2em] uppercase" style={{ color: HERO_DIM }}>Promise vs delivery — pts / game</div>
      <div className="relative h-4 rounded-full" style={{ background: 'rgba(255,255,255,.07)' }}>
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (xpg / scale) * 100)}%`, background: 'linear-gradient(90deg,#9a761c,#ead188)' }} />
        <span className="absolute -top-1 -bottom-1 w-[3px] rounded-sm bg-white" style={{ left: `${Math.min(100, (ppg / scale) * 100)}%`, boxShadow: '0 0 8px rgba(255,255,255,.6)' }} />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[12px]" style={{ color: HERO_DIM }}>
        <span><b style={{ color: HERO_GOLD }}>{xpg.toFixed(1)} expected</b> (gold)</span>
        <span><b className="text-white">{ppg.toFixed(1)} actual</b> (marker) — {read}</span>
      </div>
    </div>
  )
}

/** The fingerprint: five percentile dots on tracks, positional average at the
 * midline. The dot pattern is the player. */
function Fingerprint({ r }: { r: RatingRow }) {
  const dims = FP_DIMS[r.position === 'GKP' ? 'GKP' : r.position === 'DEF' ? 'DEF' : 'ATT']
  const rows = dims.map(([label, col]) => [label, ratingTo100(str(r, col))] as const)
  if (rows.every(([, v]) => v == null)) return null
  return (
    <div className="w-full max-w-md">
      <div className="font-cond mb-3 text-[10px] font-extrabold tracking-[.2em] uppercase" style={{ color: HERO_DIM }}>The fingerprint — percentile vs all {r.position}</div>
      <div className="grid gap-2.5">
        {rows.map(([label, v]) => (
          <div key={label} className="grid grid-cols-[92px_1fr_34px] items-center gap-2.5">
            <span className="font-cond text-[10px] font-bold tracking-[.08em] uppercase" style={{ color: HERO_DIM }}>{label}</span>
            <div className="relative h-[5px] rounded-full" style={{ background: 'rgba(255,255,255,.08)' }}>
              <span className="absolute -top-0.5 -bottom-0.5 left-1/2 w-px" style={{ background: 'rgba(255,255,255,.25)' }} />
              {v != null && (
                <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${v}%`, background: 'radial-gradient(circle at 35% 30%, #ead188, #9a761c)', boxShadow: '0 0 10px rgba(201,162,39,.5)' }} />
              )}
            </div>
            <span className="text-right text-[12px] font-extrabold tabular-nums" style={{ color: v == null ? HERO_DIM : HERO_GOLD }}>{v ?? '—'}</span>
          </div>
        ))}
      </div>
      <div className="mt-2.5 text-[11px]" style={{ color: HERO_DIM }}>White line = positional average. The dot pattern <i>is</i> the player.</div>
    </div>
  )
}

function PlayerHero({ r, peers, verdict, personas, flags, isPenTaker, isSpTaker, streak }: {
  r: RatingRow
  peers: RatingRow[]
  verdict: ReturnType<typeof buildPlayerVerdict>
  personas: string[]
  flags: string[]
  isPenTaker: boolean
  isSpTaker: boolean
  streak: string
}) {
  const name = String(r.web_name)
  const team = String(r.team)
  const tc = teamColors[team] ?? '#7ad1ff'
  const pos = r.position
  const isGk = pos === 'GKP'
  const rating = ratingTo100(num(r, 'season_overall_score'))
  const rank = rating != null ? 1 + peers.filter((p) => (ratingTo100(num(p, 'season_overall_score')) ?? -1) > rating).length : null
  const tp = num(r, 'season_total_points')
  const tg = num(r, 'season_total_goals'), txg = num(r, 'season_total_xg')
  const ta = num(r, 'season_total_assists'), txa = num(r, 'season_total_xa')
  const mins = num(r, 'total_mins')

  return (
    <div className="relative overflow-hidden" style={{ background: `radial-gradient(700px 480px at 88% 0%, ${tc}30, transparent 62%), radial-gradient(600px 420px at 0% 100%, rgba(201,162,39,.1), transparent 60%), linear-gradient(118deg,#12100b 0%,#0b0908 52%,#060504 100%)` }}>
      <div className="pointer-events-none absolute inset-0 opacity-50" style={{ background: 'repeating-linear-gradient(118deg, transparent 0 140px, rgba(255,255,255,.016) 140px 142px)' }} />

      <div className="relative z-10 grid gap-x-8 gap-y-6 px-5 py-6 md:grid-cols-[1.1fr_1fr] md:items-center md:px-8 md:py-7">
        <div className="min-w-0">
          <div className="flex items-center gap-4">
            <div className="relative flex-none" aria-hidden="true">
              <div className="absolute inset-x-0 bottom-0 h-6 rounded-[50%]" style={{ background: `radial-gradient(closest-side, ${tc}40, transparent)` }} />
              <PhotoImg hero code={r.code} element={r.element} className="h-[120px] w-auto object-contain md:h-[150px]" style={{ filter: 'drop-shadow(0 12px 24px rgba(0,0,0,.6))' }} placeholder={<div className="flex h-[120px] w-[80px] items-end justify-center md:h-[150px] md:w-[100px]"><HeroSilhouette /></div>} />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-display leading-[.92] tracking-[-.01em] uppercase" style={{ fontSize: 'clamp(30px,5.5vw,52px)', background: 'linear-gradient(180deg,#fff 12%,#eee9dd 48%,#a1988a 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,.6))' }}>{name}</h1>
              <div className="font-cond mt-1.5 text-[12px] font-semibold tracking-[.14em] uppercase" style={{ color: HERO_DIM }}>
                {POS_LABEL[pos] ?? pos} · <b style={{ color: tc }}>{teamFullNames[team] || team}</b> · £{r.price}m · {r.selected_by_percent}% owned
                {streak === '🔥 Hot' && <span className="ml-2 inline-flex items-center gap-1 text-hot normal-case tracking-normal"><Icon name="flame" size={11} solid /> Hot</span>}
                {streak === '🧊 Cold' && <span className="ml-2 inline-flex items-center gap-1 text-cold normal-case tracking-normal"><Icon name="snow" size={11} /> Cold</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {isPenTaker && <HeroPill gold title="First-choice penalty taker — extra, high-value goal route.">ⓒ Penalties</HeroPill>}
                {isSpTaker && <HeroPill title="Primary corner / free-kick taker — extra assist and goal routes.">Set pieces</HeroPill>}
                {personas.slice(0, 2).map((p) => <HeroPill key={p} title={personaTip(p)}>{p}</HeroPill>)}
                {flags.slice(0, 1).map((f) => <HeroPill key={f} warn={!f.includes('Monster')} title={personaTip(f)}>{f}</HeroPill>)}
              </div>
            </div>
            {rating != null && (
              <div className="flex-none text-center">
                <div className="metallic-num font-display text-[52px] leading-[.85] md:text-[64px]">{rating}</div>
                {rank != null && <div className="font-cond mt-1.5 text-[10px] font-bold tracking-[.12em] uppercase" style={{ color: HERO_DIM }}>#{rank} of {peers.length} {pos}</div>}
              </div>
            )}
          </div>

          {verdict?.verdict && <p className="mt-4 max-w-xl text-[14.5px]" style={{ color: '#d6d0c2' }}>{verdict.verdict}.</p>}

          <BulletGauge r={r} peers={peers} />

          <div className="mt-6 flex flex-wrap gap-x-7 gap-y-3">
            <StatMini v={tp ?? '—'} k="Points" />
            {!isGk && <StatMini v={tg ?? '—'} sub={txg != null ? `/ ${txg} xG` : undefined} k="Goals" />}
            {!isGk && <StatMini v={ta ?? '—'} sub={txa != null ? `/ ${txa} xA` : undefined} k="Assists" />}
            <StatMini v={mins != null ? mins.toLocaleString() : '—'} k="Minutes" />
            <StatMini v={num(r, 'season_ppg')?.toFixed(2) ?? '—'} k="Pts / Game" />
          </div>
        </div>

        <Fingerprint r={r} />
      </div>
    </div>
  )
}

/* ═══ The market — price × rating scatter ═════════════════════════════════
   Every positional peer as a faint dot, this player in gold, with a fair-
   price trend line: above the line = under-priced for the rating. Rendered
   in the themed area below the hero so it works in light and dark. */

/** Horizontal-scroll wrapper that starts scrolled so the highlighted player
 * is in view when the chart is wider than the screen (mobile). */
function ScrollToPlayer({ frac, children }: { frac: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, frac * el.scrollWidth - el.clientWidth / 2)
  }, [frac])
  return <div ref={ref} className="overflow-x-auto">{children}</div>
}

function MarketScatter({ r, peers }: { r: RatingRow; peers: RatingRow[] }) {
  const pos = r.position
  const myRating = ratingTo100(num(r, 'season_overall_score'))
  const myPrice = num(r, 'price')

  const pts = useMemo(
    () =>
      peers
        .map((p) => ({ p, x: num(p, 'price'), y: ratingTo100(num(p, 'season_overall_score')) }))
        .filter((d): d is { p: RatingRow; x: number; y: number } => d.x != null && d.y != null),
    [peers],
  )

  if (myRating == null || myPrice == null || pts.length < 8) return null

  // Least-squares fit of rating on price — the "fair price" line.
  const n = pts.length
  const mx = pts.reduce((s, d) => s + d.x, 0) / n
  const my = pts.reduce((s, d) => s + d.y, 0) / n
  const denom = pts.reduce((s, d) => s + (d.x - mx) ** 2, 0) || 1
  const slope = pts.reduce((s, d) => s + (d.x - mx) * (d.y - my), 0) / denom
  const fit = (x: number) => my + slope * (x - mx)
  const residual = myRating - fit(myPrice)

  // Best cheaper near-rival: highest-rated peer at a lower price within 5
  // rating points of this player (the "is there better value?" answer).
  const rival = pts
    .filter((d) => d.p.element !== r.element && d.x < myPrice && d.y >= myRating - 5)
    .sort((a, b) => b.y - a.y)[0]

  const owned = num(r, 'selected_by_percent')
  const gw4 = ratingTo100(num(r, 'gw4_overall_score'))
  const momentum = gw4 != null && myRating != null ? gw4 - myRating : null

  // Plot geometry (SVG user units; responsive via viewBox).
  const W = 640, H = 300, PAD = { l: 34, r: 16, t: 14, b: 30 }
  const xs = pts.map((d) => d.x), ys = pts.map((d) => d.y)
  const xMin = Math.floor(Math.min(...xs) - 0.3), xMax = Math.ceil(Math.max(...xs) + 0.3)
  const yMin = Math.max(0, Math.floor((Math.min(...ys) - 4) / 10) * 10), yMax = Math.min(100, Math.ceil((Math.max(...ys) + 4) / 10) * 10)
  const X = (v: number) => PAD.l + ((v - xMin) / (xMax - xMin)) * (W - PAD.l - PAD.r)
  const Y = (v: number) => H - PAD.b - ((v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b)
  const priceTicks: number[] = []
  for (let t = Math.ceil(xMin / 2.5) * 2.5; t <= xMax; t += 2.5) priceTicks.push(t)
  const clampY = (v: number) => Math.max(yMin, Math.min(yMax, v))

  const verdictLine =
    residual >= 3
      ? `Sits clearly above the price-performance line — at £${myPrice}m you're getting more rating than the market charges for.`
      : residual <= -3
        ? `Sits below the price-performance line — at £${myPrice}m the market asks a premium over what the rating supports.`
        : `Priced about right — £${myPrice}m is roughly what this rating costs across all ${pos}.`

  return (
    <Section title={<span className="inline-flex items-center gap-1">The Market — price vs rating, all {pos} <InfoTip text={`Every ${pos} with a rating, plotted price (x) against overall rating (y). The line is the least-squares fair-price trend: players above it deliver more rating than their price predicts.`} /></span>}>
      <div className="rounded-xl border border-line bg-surface-1 p-4">
        <p className="mb-1.5 text-sm text-ink-2">
          {verdictLine}
          {rival ? <> Best cheaper near-rival: <b className="text-ink">{String(rival.p.web_name)}</b> ({rival.y} at £{rival.x}m).</> : <> No cheaper {pos} comes within 5 rating points.</>}
        </p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {owned != null && (
            <span className="rounded-full border border-line-mid px-2.5 py-0.5 text-[11px] font-semibold text-ink-2">
              {owned >= 20 ? `Template pick — ${owned}% owned` : owned < 10 ? `Differential — ${owned}% owned` : `${owned}% owned`}
            </span>
          )}
          {momentum != null && Math.abs(momentum) >= 4 && (
            <span className={`rounded-full border border-line-mid px-2.5 py-0.5 text-[11px] font-semibold ${momentum > 0 ? 'text-good' : 'text-bad'}`}>
              Momentum {momentum > 0 ? '▲' : '▼'} last 4
            </span>
          )}
        </div>
        <ScrollToPlayer frac={(X(myPrice) - PAD.l) / (W - PAD.l - PAD.r)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[540px]" role="img" aria-label={`Price versus rating scatter for all ${pos}`}>
          {/* gridlines + axis labels */}
          {[25, 50, 75, 100].filter((v) => v > yMin && v <= yMax).map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={Y(v)} y2={Y(v)} stroke="var(--line)" strokeWidth="1" />
              <text x={PAD.l - 6} y={Y(v) + 3} textAnchor="end" fontSize="10" fill="var(--ink-3)">{v}</text>
            </g>
          ))}
          {priceTicks.map((t) => (
            <text key={t} x={X(t)} y={H - PAD.b + 16} textAnchor="middle" fontSize="10" fill="var(--ink-3)">£{t}m</text>
          ))}
          {/* fair-price line */}
          <line x1={X(xMin)} y1={Y(clampY(fit(xMin)))} x2={X(xMax)} y2={Y(clampY(fit(xMax)))} stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.55" />
          {/* peers */}
          {pts.filter((d) => d.p.element !== r.element).map((d) => (
            <circle key={String(d.p.element)} cx={X(d.x)} cy={Y(d.y)} r="3.5" fill="var(--ink-3)" opacity="0.35">
              <title>{String(d.p.web_name)} — {d.y} at £{d.x}m</title>
            </circle>
          ))}
          {/* this player */}
          <circle cx={X(myPrice)} cy={Y(myRating)} r="10" fill="var(--accent)" opacity="0.18" />
          <circle cx={X(myPrice)} cy={Y(myRating)} r="6" fill="var(--accent)" stroke="var(--surface-1)" strokeWidth="1.5" />
          <text x={X(myPrice) + (myPrice > (xMin + xMax) / 2 ? -12 : 12)} y={Math.max(16, Y(myRating) - 10)} textAnchor={myPrice > (xMin + xMax) / 2 ? 'end' : 'start'} fontSize="12" fontWeight="700" fill="var(--accent)">{String(r.web_name)} · {myRating}</text>
          <text x={PAD.l} y={PAD.t - 2} fontSize="9.5" fill="var(--ink-3)" style={{ textTransform: 'uppercase', letterSpacing: '.12em' }}>Rating ↑</text>
          <text x={W - PAD.r} y={H - 4} textAnchor="end" fontSize="9.5" fill="var(--ink-3)" style={{ textTransform: 'uppercase', letterSpacing: '.12em' }}>Price →</text>
        </svg>
        </ScrollToPlayer>
        <div className="mt-2 text-xs text-ink-3">Every {pos} as a dot · dashed line = fair price for the rating · above it = value. Hover a dot for the name.</div>
      </div>
    </Section>
  )
}

// Short axis labels so the radar stays legible with many dimensions.
/** Dimension breakdown as glanceable 0–100 bars (season) with the compact
 * last-4GW badge alongside — replaces the old star table. */
function DimBars({ r, dims, overall }: { r: RatingRow; dims: Dim[]; overall: [string, string] }) {
  const toneFor = (v: number | null): Tone => (v == null ? 'accent' : v >= 80 ? 'accent' : v >= 65 ? 'good' : v >= 50 ? 'info' : 'bad')
  return (
    <div className="rounded-xl border border-line">
      <div className="flex items-center justify-between gap-3 border-b border-line-mid px-4 py-2.5 text-[11px] tracking-[0.1em] text-ink-3 uppercase">
        <span>Dimension · Season</span>
        <span>4GW</span>
      </div>
      <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <span className="w-28 shrink-0 text-sm font-semibold text-ink sm:w-32">Overall</span>
        <div className="min-w-0 flex-1"><StarRating value={num(r, overall[0])} /></div>
        <span className="shrink-0"><StarRating value={num(r, overall[1])} size={10} /></span>
      </div>
      {dims.map(([label, sCol, gCol, tipKey]) => {
        const s = ratingTo100(str(r, sCol))
        return (
          <div key={label} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
            <span className="inline-flex w-28 shrink-0 items-center gap-1 text-sm text-ink-2 sm:w-32">
              {label}
              {tipKey && metricTip(tipKey) && <InfoTip text={metricTip(tipKey)!} />}
            </span>
            <div className="min-w-0 flex-1">
              <MiniBar value={s} max={100} tone={toneFor(s)} text={s == null ? 'N/A' : String(s)} />
            </div>
            <span className="shrink-0"><StarRating value={str(r, gCol)} size={10} /></span>
          </div>
        )
      })}
    </div>
  )
}

export function PlayerNotFound() {
  return <EmptyState icon={<Icon name="search" size={44} />}>Search for a player to see their analysis</EmptyState>
}
