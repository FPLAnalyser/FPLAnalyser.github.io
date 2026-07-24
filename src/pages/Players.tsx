import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader, PageShell, EmptyState } from '../components/PageShell'
import { SearchBox } from '../components/SearchBox'
import { StarRating, ratingTo100 } from '../components/StarRating'
import { Radar, MiniBar, ConcentrationBar, CHART_COLORS, type Tone } from '../components/viz'
import { AnimatedCounter } from '../components/AnimatedCounter'
import { InfoTip } from '../components/InfoTip'
import { Icon, type IconName } from '../components/Icon'
import { TeamBadge, PositionIcon } from '../components/badges'
import { PageSkeleton } from '../components/Skeleton'
import { PlayerPhoto as PhotoImg } from '../components/PlayerPhoto'
import { ShareCard } from '../components/ShareCard'
import { PlayerScatterMap, PlayerZoneMap } from '../components/ShotMap'
import { useCore } from '../lib/useData'
import { num, str, bool } from '../lib/rows'
import { teamFullNames, teamColors, TOOLTIPS } from '../lib/util'
import { buildPlayerBundle, buildPlayerVerdict } from '../lib/insights/narrative'
import type { CoreData, RatingRow, Row } from '../lib/types'

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
const ATT_COMBINED_DIMS: Dim[] = [
  ['Goal Threat', 'season_att_goal_score_rating', 'gw4_att_goal_score_rating'],
  ['Creativity', 'season_att_creative_score_rating', 'gw4_att_creative_score_rating'],
  ['Def Contribution', 'season_att_dc_score_rating', 'gw4_att_dc_score_rating'],
  ['BPS / Bonus', 'season_att_bps_score_rating', 'gw4_att_bps_score_rating'],
  ['Value', 'season_att_value_score_rating', 'gw4_att_value_score_rating'],
  ['Reliability', 'season_att_reliability_rating', 'gw4_att_reliability_rating'],
  ['90 Mins', 'season_att_mins90_rating', 'gw4_att_mins90_rating'],
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
        <PageHeader title="Player Search" subtitle="Search for any player to see their FPL Analyser ratings, stats and form" />
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
      <PageHeader title="Player Search" subtitle="Search for any player to see their FPL Analyser ratings, stats and form" />
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

const TONE_TEXT: Record<string, string> = { good: 'text-good', warn: 'text-warn', bad: 'text-bad', info: 'text-info' }

function PlayerCard({ player: r, data }: { player: RatingRow; data: CoreData }) {
  const name = String(r.web_name)
  const pos = r.position
  const isAtt = pos === 'MID' || pos === 'FWD'

  // Key related tables by the player's element (unique), never web_name.
  const p4 = data.personas4.find((p) => p.element === r.element) ?? null
  const m = data.metrics.find((p) => p.element === r.element) ?? null
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
  const ptsDelta = std ? num(std, 'pts_delta') : null
  const xgShare = m ? num(m, 'xg_share_4gw') : null
  const xaShare = m ? num(m, 'xa_share_4gw') : null
  const n2 = (v: number | null, f: 1 | 2 = 2) => (v != null ? <AnimatedCounter value={v} format={f === 1 ? '1dp' : '2dp'} /> : 'N/A')

  const xptsRank = useMemo(() => {
    const v = num(r, 'season_xpts_per_game')
    if (v == null) return null
    let ahead = 0
    for (const p of data.ratings) { const x = num(p, 'season_xpts_per_game'); if (x != null && x > v) ahead++ }
    return ahead + 1
  }, [data.ratings, r])

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-1/50">
      <PlayerHero r={r} verdict={verdict} personas={personas} flags={flags} isPenTaker={isPenTaker} isSpTaker={isSpTaker} streak={streak} isAtt={isAtt} />

      {/* Single scroll — every section visible, no tabs. Order mirrors the
          rating's own construction: receipts → stats → profile → underlying →
          reliability → context → shots. */}
      <div className="px-5 pb-5 md:px-6 md:pb-6">
        <div className="relative z-10 -mt-12 mb-6 flex flex-wrap justify-center gap-3">
          {heroChips(r, xptsRank).map((c) => <BigChip key={c.k} label={c.k} value={c.v} sub={c.sub} />)}
        </div>
        <div className="mb-8 flex justify-center">
          <ShareCard r={r} fixtureEase={data.fixtureEase} />
        </div>

        <PointsEngine r={r} />

        <Section title={`Rating Profile — vs ${pos} players`}>
          <div className="grid gap-5 lg:grid-cols-[300px_1fr] lg:items-center">
            <Radar axes={radarAxes(r, dims)} seriesALabel="Season" seriesBLabel="Last 4GW" />
            <DimBars r={r} dims={dims} overall={['season_overall_score', 'gw4_overall_score']} />
          </div>
        </Section>

        <UnderlyingQuality r={r} pos={pos} />

        {isAtt && (
          <Section title="Attacking Share (Last 4GW)">
            <div className="grid grid-cols-2 gap-2">
              <Tile value={xgShare != null ? `${(xgShare * 100).toFixed(1)}%` : 'N/A'} label="Team xG Share" />
              <Tile value={xaShare != null ? `${(xaShare * 100).toFixed(1)}%` : 'N/A'} label="Team xA Share" />
            </div>
          </Section>
        )}
        {isAtt && (
          <Section title="Attacker Ratings — vs all MID & FWD players">
            <DimBars r={r} dims={ATT_COMBINED_DIMS} overall={['season_att_overall_score', 'gw4_att_overall_score']} />
          </Section>
        )}

        <Section title="Reliability & Risk">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile value={num(r, 'season_start_rate') != null ? <AnimatedCounter value={num(r, 'season_start_rate')! * 100} suffix="%" /> : 'N/A'} label="Start Rate" />
            <Tile value={num(r, 'season_mins90_rate') != null ? <AnimatedCounter value={num(r, 'season_mins90_rate')! * 100} suffix="%" /> : 'N/A'} label="90 Mins Rate" />
            <Tile value={n2(m ? num(m, 'sortino_4gw') : null)} label={<>Sortino <InfoTip text={TOOLTIPS.sortino as string} /></>} />
            <Tile value={n2(m ? num(m, 'consistency_4gw') : null)} label={<>Consistency <InfoTip text={TOOLTIPS.consistency as string} /></>} />
            <Tile value={n2(m ? num(m, 'alpha_4gw') : null)} label={<>Alpha <InfoTip text={TOOLTIPS.alpha as string} /></>} />
            <Tile value={n2(m ? num(m, 'sharpe_4gw') : null)} label={<>Sharpe <InfoTip text={TOOLTIPS.sharpe as string} /></>} />
            <Tile value={n2(m ? num(m, 'home_avg_season') : null, 1)} label="Home Avg Pts" />
            <Tile value={n2(m ? num(m, 'away_avg_season') : null, 1)} label="Away Avg Pts" />
            <Tile value={std && num(std, 'pts_per90_season') != null ? <AnimatedCounter value={num(std, 'pts_per90_season')!} format="2dp" /> : 'N/A'} label="Pts / 90" />
            <Tile value={ptsDelta != null ? `${ptsDelta > 0 ? '+' : ''}${ptsDelta.toFixed(2)}` : 'N/A'} label="Form Delta" />
          </div>
        </Section>

        <TierTable element={r.element} tierPerf={data.tierPerf} />

        {pos !== 'GKP' && (
          <>
            <Section title="Shot Map"><PlayerScatterMap element={r.element} /></Section>
            <Section title="Shot Zones"><PlayerZoneMap element={r.element} name={name} /></Section>
          </>
        )}
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

/** Season per-90 quality metrics — the data layer beneath the xPts model. */
function UnderlyingQuality({ r, pos }: { r: RatingRow; pos: string }) {
  const f = (k: string, d = 2) => { const v = num(r, `season_m_${k}`); return v == null ? 'N/A' : v.toFixed(d) }
  const pc = (k: string) => { const v = num(r, `season_m_${k}`); return v == null ? 'N/A' : `${Math.round(v * 100)}%` }
  if (pos === 'GKP') {
    return (
      <Section title="Underlying Quality (Season)">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Tile value={f('saves')} label="Saves / 90" />
          <Tile value={f('xgc')} label="xGC / 90" />
          <Tile value={f('prevented')} label="Goals Prevented / 90" />
          <Tile value={f('shots_faced', 1)} label="Shots Faced / Game" />
          <Tile value={pc('box_faced')} label="Box Share Faced" />
          <Tile value={`${f('dist_faced', 1)} yd`} label="Avg Shot Dist Faced" />
        </div>
      </Section>
    )
  }
  return (
    <Section title="Underlying Quality (Season)">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile value={f('xg')} label="xG / 90" />
        <Tile value={f('xa')} label="xA / 90" />
        <Tile value={f('shot_quality', 3)} label={<>npxG / Shot <InfoTip text={TOOLTIPS.shot_quality as string} /></>} />
        <Tile value={pc('box_share')} label="Box Shot %" />
        <Tile value={pc('sot_rate')} label="Shots on Target %" />
        <Tile value={f('touches_box', 1)} label="Touches in Box / 90" />
        <Tile value={f('big_chances')} label="Big Chances / 90" />
        <Tile value={f('set_piece', 1)} label="SP Deliveries / 90" />
      </div>
    </Section>
  )
}

/* ═══ Editorial player hero ═══════════════════════════════════════════════
   Always-dark cinematic band (like the shot maps): club-coloured glow, ghost
   watermark + rating numeral, display-type name, PL cutout figure, season
   numbers, biggest hauls and the verdict as headlines. */

const POS_LABEL: Record<string, string> = { GKP: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' }
const HERO_DIM = '#8e94a3'
const HERO_INK = '#f1efe9'
const HERO_GOLD = '#ead188' // logo-gold highlight (bright, legible on near-black)
const HERO_PANEL: CSSProperties = { borderColor: 'rgba(201,162,39,.18)', background: 'rgba(16,20,30,.72)', backdropFilter: 'blur(10px)' }

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
  return <span title={title} className={base} style={{ border: '1px solid rgba(201,162,39,.18)', color: warn ? '#e8b04a' : '#cfd3db', background: 'rgba(255,255,255,.02)' }}>{children}</span>
}

function BigNum({ v, sub, k }: { v: ReactNode; sub?: string; k: string }) {
  return (
    <div>
      <div className="font-cond text-[30px] leading-none font-extrabold md:text-[38px]" style={{ color: HERO_INK }}>
        {v}{sub && <span className="ml-1.5 text-[14px] font-semibold md:text-[16px]" style={{ color: HERO_GOLD }}>{sub}</span>}
      </div>
      <div className="font-cond mt-1 text-[10px] font-semibold tracking-[.28em] uppercase" style={{ color: HERO_DIM }}>{k}</div>
    </div>
  )
}

function MiniRating({ k, v }: { k: string; v: number | null }) {
  const c = v == null ? HERO_DIM : v >= 80 ? HERO_GOLD : v >= 65 ? '#3ddc7a' : v >= 50 ? HERO_INK : '#f0736f'
  return (
    <div className="font-cond flex items-baseline gap-2">
      <span className="text-[10px] font-semibold tracking-[.24em] uppercase" style={{ color: HERO_DIM }}>{k}</span>
      <span className="text-[19px] font-extrabold" style={{ color: c }}>{v ?? '—'}</span>
    </div>
  )
}

function BigChip({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-[150px] max-w-[240px] flex-1 rounded-2xl p-px" style={{ background: 'linear-gradient(160deg, rgba(201,162,39,.7), rgba(201,162,39,.08) 45%, rgba(201,162,39,.35))' }}>
      <div className="rounded-[15px] px-4 py-3 text-center" style={{ background: 'linear-gradient(180deg,#12161f,#0c0f16)' }}>
        <div className="font-cond text-[10px] font-semibold tracking-[.28em] uppercase" style={{ color: HERO_DIM }}>{label}</div>
        <div className="font-cond mt-1 text-[26px] leading-none font-extrabold md:text-[30px]" style={{ color: HERO_INK }}>
          {value}{sub && <small className="ml-1 text-[15px] font-semibold" style={{ color: HERO_GOLD }}>{sub}</small>}
        </div>
      </div>
    </div>
  )
}

function heroChips(r: RatingRow, xptsRank: number | null): { k: string; v: string; sub?: string }[] {
  const f = (k: string, d = 1) => { const v = num(r, `season_m_${k}`); return v == null ? null : v.toFixed(d) }
  const pcv = (k: string) => { const v = num(r, `season_m_${k}`); return v == null ? null : String(Math.round(v * 100)) }
  const chips: { k: string; v: string; sub?: string }[] = []
  const xp = num(r, 'season_xpts_per_game')
  if (xp != null) chips.push({ k: 'xPts / Game', v: xp.toFixed(2), sub: xptsRank != null ? `#${xptsRank}` : undefined })
  if (r.position === 'GKP') {
    const s = f('saves', 2); if (s) chips.push({ k: 'Saves / 90', v: s })
    const sf = f('shots_faced', 1); if (sf) chips.push({ k: 'Shots Faced / Gm', v: sf })
    const pr = f('prevented', 2); if (pr) chips.push({ k: 'Goals Prevented / 90', v: pr })
  } else if (r.position === 'DEF') {
    const cs = pcv('cs_rate'); if (cs) chips.push({ k: 'Clean Sheets', v: cs, sub: '%' })
    const xgc = f('xgc', 2); if (xgc) chips.push({ k: 'xGC / 90', v: xgc })
    const tb = f('touches_box', 1); if (tb) chips.push({ k: 'Touches in Box / 90', v: tb })
  } else {
    const b = pcv('box_share'); if (b) chips.push({ k: 'Box Shots', v: b, sub: '%' })
    const s = pcv('sot_rate'); if (s) chips.push({ k: 'Shots on Target', v: s, sub: '%' })
    const tb = f('touches_box', 1); if (tb) chips.push({ k: 'Touches in Box / 90', v: tb })
  }
  return chips
}

function PlayerHero({ r, verdict, personas, flags, isPenTaker, isSpTaker, streak, isAtt }: {
  r: RatingRow
  verdict: ReturnType<typeof buildPlayerVerdict>
  personas: string[]
  flags: string[]
  isPenTaker: boolean
  isSpTaker: boolean
  streak: string
  isAtt: boolean
}) {
  const name = String(r.web_name)
  const team = String(r.team)
  const tc = teamColors[team] ?? '#7ad1ff'
  const pos = r.position
  const isGk = pos === 'GKP'
  const rating = ratingTo100(num(r, 'season_overall_score'))
  const gw4 = ratingTo100(num(r, 'gw4_overall_score'))
  const next4 = ratingTo100(str(r, 'next4_overall_rating'))
  const att = ratingTo100(num(r, 'season_att_overall_score'))
  const tp = num(r, 'season_total_points')
  const tg = num(r, 'season_total_goals'), txg = num(r, 'season_total_xg')
  const ta = num(r, 'season_total_assists'), txa = num(r, 'season_total_xa')
  const mins = num(r, 'total_mins')
  const hauls: { gw: number; pts: number; home: boolean; g: number; a: number }[] = (() => {
    try { const s = str(r, 'season_hauls'); return s ? JSON.parse(s) : [] } catch { return [] }
  })()
  const bullets = verdict?.bullets ?? []

  return (
    <div className="relative overflow-hidden pb-20" style={{ background: `radial-gradient(900px 620px at 86% 22%, ${tc}30, transparent 62%), radial-gradient(700px 520px at 4% 100%, rgba(201,162,39,.12), transparent 60%), linear-gradient(118deg,#0d1119 0%,#0a0d13 52%,#070a10 100%)` }}>
      <div className="pointer-events-none absolute inset-0 opacity-50" style={{ background: 'repeating-linear-gradient(118deg, transparent 0 140px, rgba(255,255,255,.016) 140px 142px)' }} />
      <div className="font-display pointer-events-none absolute -left-2 top-2 leading-none whitespace-nowrap uppercase select-none" style={{ fontSize: 'clamp(70px,15vw,168px)', color: 'transparent', WebkitTextStroke: '1px rgba(255,255,255,.05)' }}>{teamFullNames[team] || team}</div>
      {rating != null && (
        <div className="font-display pointer-events-none absolute right-[3%] -bottom-8 leading-[.8] select-none" style={{ fontSize: 'clamp(160px,28vw,340px)', color: 'transparent', WebkitTextStroke: '2px rgba(201,162,39,.16)' }}>{rating}</div>
      )}

      <div className="relative z-10 grid items-end gap-x-4 px-5 pt-6 md:grid-cols-[1.2fr_.9fr] md:px-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-cond rounded-[3px] px-3 py-1 text-[11px] font-extrabold tracking-[.3em] uppercase text-[#10131b]" style={{ background: 'linear-gradient(120deg,#ead188,#c9a227)' }}>{POS_LABEL[pos] ?? pos}</span>
            <span className="font-cond text-[12.5px] font-semibold tracking-[.16em] uppercase" style={{ color: HERO_DIM }}>
              <b style={{ color: tc }}>{teamFullNames[team] || team}</b> · £{r.price}m · {r.selected_by_percent}% owned
            </span>
            {streak === '🔥 Hot' && <span className="flex items-center gap-1 text-[12px] text-hot"><Icon name="flame" size={12} solid /> Hot</span>}
            {streak === '🧊 Cold' && <span className="flex items-center gap-1 text-[12px] text-cold"><Icon name="snow" size={12} /> Cold</span>}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-3">
            <h1 className="font-display leading-[.9] tracking-[-.015em] uppercase" style={{ fontSize: 'clamp(44px,8vw,92px)', background: 'linear-gradient(180deg,#fff 12%,#e4e6ea 48%,#8f96a5 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 10px 34px rgba(0,0,0,.65))' }}>{name}</h1>
            {rating != null && (
              <div className="relative grid h-16 w-16 flex-none place-items-center rounded-full" style={{ background: 'radial-gradient(circle at 32% 26%, #202636, #10141d 70%)', boxShadow: '0 0 0 1.5px #c9a227, 0 0 0 6px rgba(10,13,19,.9), 0 0 0 7px rgba(201,162,39,.25), 0 0 42px rgba(201,162,39,.3)' }}>
                <b className="metallic-num font-display text-[23px]">{rating}</b>
                <span className="font-cond absolute bottom-2 text-[6.5px] font-semibold tracking-[.3em] uppercase" style={{ color: HERO_DIM }}>Rating</span>
              </div>
            )}
          </div>

          <div className="mt-2 text-[15px]" style={{ color: '#c9cdd6' }}>
            {verdict?.verdict && <>{verdict.verdict}. </>}
            {!isGk && tg != null && txg != null && <span className="font-semibold" style={{ color: HERO_GOLD }}>{tg} goals from {txg} xG</span>}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {isPenTaker && <HeroPill gold title="First-choice penalty taker — extra, high-value goal route.">ⓒ Penalty taker</HeroPill>}
            {isSpTaker && <HeroPill title="Primary corner / free-kick taker — extra assist and goal routes.">Set-piece taker</HeroPill>}
            {personas.slice(0, 3).map((p) => <HeroPill key={p} title={personaTip(p)}>{p}</HeroPill>)}
            {flags.map((f) => <HeroPill key={f} warn={!f.includes('Monster')} title={personaTip(f)}>{f}</HeroPill>)}
          </div>

          <div className="mt-7 grid w-max grid-cols-3 gap-x-8 gap-y-4 md:gap-x-11">
            <BigNum v={tp ?? '—'} k="Points" />
            {!isGk && <BigNum v={tg ?? '—'} sub={txg != null ? `/ ${txg} xG` : undefined} k="Goals" />}
            {!isGk && <BigNum v={ta ?? '—'} sub={txa != null ? `/ ${txa} xA` : undefined} k="Assists" />}
            <BigNum v={mins != null ? mins.toLocaleString() : '—'} k="Minutes" />
            <BigNum v={num(r, 'total_starts') ?? '—'} k="Starts" />
            <BigNum v={num(r, 'season_ppg')?.toFixed(2) ?? '—'} k="Pts / Game" />
          </div>

          <div className="font-cond mt-6 flex flex-wrap gap-x-8 gap-y-2">
            <MiniRating k="Last 4GW" v={gw4} />
            <MiniRating k="Next 4 · Fixtures" v={next4} />
            {isAtt && <MiniRating k="vs Attackers" v={att} />}
          </div>

          {(hauls.length > 0 || bullets.length > 0) && (
            <div className="mt-7 grid max-w-2xl gap-3 lg:grid-cols-[236px_1fr]">
              {hauls.length > 0 && (
                <div className="rounded-xl border p-3.5" style={HERO_PANEL}>
                  <h4 className="font-cond mb-1.5 text-[11px] font-extrabold tracking-[.34em] uppercase" style={{ color: HERO_GOLD }}>Biggest Hauls</h4>
                  {hauls.map((h) => (
                    <div key={h.gw} className="flex items-center gap-3 border-t border-white/5 py-1.5 first:border-0">
                      <div className="font-cond w-11 text-[24px] leading-none font-extrabold" style={{ color: tc }}>{h.pts}<small className="text-[11px] font-semibold" style={{ color: HERO_DIM }}>pts</small></div>
                      <div className="font-cond text-[13px] font-semibold tracking-wide uppercase" style={{ color: '#cfd3db' }}>
                        Gameweek {h.gw}
                        <small className="block text-[10px] tracking-[.2em]" style={{ color: HERO_DIM }}>{h.home ? 'Home' : 'Away'} · {h.g}G · {h.a}A</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {bullets.length > 0 && (
                <div className="rounded-xl border p-3.5" style={HERO_PANEL}>
                  <h4 className="font-cond mb-1.5 text-[11px] font-extrabold tracking-[.34em] uppercase" style={{ color: HERO_GOLD }}>Headlines</h4>
                  {bullets.map((b: { iconId: string; tone: string; html: string }, i: number) => (
                    <div key={i} className="flex gap-2.5 border-t border-white/5 py-1.5 text-[13.5px] first:border-0" style={{ color: '#c9cdd6' }}>
                      <span className={`mt-0.5 ${TONE_TEXT[b.tone] || 'text-info'}`}><Icon name={b.iconId as IconName} size={13} /></span>
                      <span dangerouslySetInnerHTML={{ __html: b.html }} />
                    </div>
                  ))}
                  {verdict?.financeLine && <div className="mt-2 border-t border-white/5 pt-2 text-xs" style={{ color: HERO_DIM }} dangerouslySetInnerHTML={{ __html: verdict.financeLine }} />}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="relative order-first h-[250px] md:order-none md:h-[500px]" aria-hidden="true">
          <div className="absolute bottom-6 left-1/2 h-[min(56vw,400px)] w-[min(56vw,400px)] -translate-x-1/2 rounded-full border" style={{ borderColor: `${tc}3d`, background: `radial-gradient(circle at 50% 38%, ${tc}22, ${tc}08 58%, transparent 72%)` }} />
          <div className="absolute bottom-2 left-1/2 h-12 w-3/4 -translate-x-1/2 rounded-[50%]" style={{ background: 'radial-gradient(closest-side, rgba(0,0,0,.7), transparent)' }} />
          <div className="absolute inset-x-0 bottom-3 flex items-end justify-center">
            <PhotoImg hero code={r.code} element={r.element} className="h-[235px] w-auto object-contain md:h-[480px]" style={{ filter: 'drop-shadow(0 24px 44px rgba(0,0,0,.6))' }} placeholder={<HeroSilhouette />} />
          </div>
        </div>
      </div>
    </div>
  )
}

// Short axis labels so the radar stays legible with many dimensions.
const RADAR_SHORT: Record<string, string> = {
  'Def Contribution': 'Def Contrib', 'Creativity Depth': 'Creat. Depth', 'Finishing Skill': 'Finishing',
  'Shot Quality': 'Shot Qual', 'BPS / Bonus': 'BPS', 'Clean Sheet': 'Clean Sht', 'Set Pieces': 'Set Piece',
  'Goal Threat': 'Goals', 'Reliability': 'Reliab.', 'Creativity': 'Creativity',
}
function radarAxes(r: RatingRow, dims: Dim[]) {
  return dims.map(([label, sCol, gCol]) => ({ label: RADAR_SHORT[label] ?? label, a: ratingTo100(str(r, sCol)), b: ratingTo100(str(r, gCol)) }))
}

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

function TierTable({ element, tierPerf }: { element: number; tierPerf: Row[] }) {
  const rows = tierPerf.filter((t) => num(t, 'element') === element)
  const byTier = (t: string) => rows.find((x) => str(x, 'opponent_tier') === t) ?? null
  const tiers: [string, string, Row | null][] = [
    ['Tier 1 — Top 6', 'Tier 1 - Top 6', byTier('Tier 1 - Top 6')],
    ['Tier 2 — Mid Upper', 'Tier 2 - Mid Upper', byTier('Tier 2 - Mid Upper')],
    ['Tier 3 — Rest', 'Tier 3 - Rest', byTier('Tier 3 - Rest')],
  ]
  return (
    <Section title="Performance by Opponent Tier">
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line-mid text-[11px] tracking-[0.1em] text-ink-3 uppercase">
              {['Tier', 'Games', 'Avg Pts', 'Goals', 'Assists', 'Avg Bonus'].map((h, i) => (
                <th key={h} className={`px-4 py-3 font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tiers.map(([label, , tier]) => (
              <tr key={label} className="border-b border-line last:border-0">
                <td className="px-4 py-3 text-ink-2">{label}</td>
                {tier ? (
                  <>
                    <td className="px-4 py-3 text-right font-num tabular-nums">{num(tier, 'games_played')}</td>
                    <td className="px-4 py-3 text-right font-num tabular-nums text-accent">{(num(tier, 'avg_pts') ?? 0).toFixed(1)}</td>
                    <td className="px-4 py-3 text-right font-num tabular-nums">{num(tier, 'total_goals')}</td>
                    <td className="px-4 py-3 text-right font-num tabular-nums">{num(tier, 'total_assists')}</td>
                    <td className="px-4 py-3 text-right font-num tabular-nums">{(num(tier, 'avg_bonus') ?? 0).toFixed(1)}</td>
                  </>
                ) : (
                  <td colSpan={5} className="px-4 py-3 text-right text-ink-3">No data</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

export function PlayerNotFound() {
  return <EmptyState icon={<Icon name="search" size={44} />}>Search for a player to see their analysis</EmptyState>
}
