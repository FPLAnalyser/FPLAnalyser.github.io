import { useMemo, type CSSProperties, type ReactNode } from 'react'
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

const TONE_TEXT: Record<string, string> = { good: 'text-good', warn: 'text-warn', bad: 'text-bad', info: 'text-info' }

function PlayerCard({ player: r, data }: { player: RatingRow; data: CoreData }) {
  const name = String(r.web_name)
  const pos = r.position
  const isAtt = pos === 'MID' || pos === 'FWD'

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

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-1/50">
      <PlayerHero r={r} verdict={verdict} personas={personas} flags={flags} isPenTaker={isPenTaker} isSpTaker={isSpTaker} streak={streak} isAtt={isAtt} />

      {/* Story-first flow: decision row → story modules → receipts → matchup
          → shot evidence. Every module opens with a sentence; the numbers are
          the supporting cast. Unknown players get the know/don't-know page. */}
      <div className="px-5 pb-5 md:px-6 md:pb-6">
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

/* ═══ Editorial player hero ═══════════════════════════════════════════════
   Always-dark cinematic band (like the shot maps): club-coloured glow, ghost
   watermark + rating numeral, display-type name, PL cutout figure, season
   numbers, biggest hauls and the verdict as headlines. */

const POS_LABEL: Record<string, string> = { GKP: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' }
const HERO_DIM = '#a89f8c'
const HERO_INK = '#f1efe9'
const HERO_GOLD = '#ead188' // logo-gold highlight (bright, legible on near-black)
const HERO_PANEL: CSSProperties = { borderColor: 'rgba(201,162,39,.18)', background: 'rgba(20,17,12,.72)', backdropFilter: 'blur(10px)' }

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
  const bullets = verdict?.bullets ?? []

  return (
    <div className="relative overflow-hidden pb-20" style={{ background: `radial-gradient(900px 620px at 86% 22%, ${tc}30, transparent 62%), radial-gradient(700px 520px at 4% 100%, rgba(201,162,39,.12), transparent 60%), linear-gradient(118deg,#12100b 0%,#0b0908 52%,#060504 100%)` }}>
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
            <h1 className="font-display leading-[.9] tracking-[-.015em] uppercase" style={{ fontSize: 'clamp(44px,8vw,92px)', background: 'linear-gradient(180deg,#fff 12%,#eee9dd 48%,#a1988a 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 10px 34px rgba(0,0,0,.65))' }}>{name}</h1>
            {rating != null && (
              <div className="relative grid h-16 w-16 flex-none place-items-center rounded-full" style={{ background: 'radial-gradient(circle at 32% 26%, #2b241a, #151109 70%)', boxShadow: '0 0 0 1.5px #c9a227, 0 0 0 6px rgba(12,10,7,.9), 0 0 0 7px rgba(201,162,39,.25), 0 0 42px rgba(201,162,39,.3)' }}>
                <b className="metallic-num font-display text-[23px]">{rating}</b>
                <span className="font-cond absolute bottom-2 text-[6.5px] font-semibold tracking-[.3em] uppercase" style={{ color: HERO_DIM }}>Rating</span>
              </div>
            )}
          </div>

          <div className="mt-2 text-[15px]" style={{ color: '#d6d0c2' }}>
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

          {bullets.length > 0 && (
            <div className="mt-7 grid max-w-2xl gap-3">
              {bullets.length > 0 && (
                <div className="rounded-xl border p-3.5" style={HERO_PANEL}>
                  <h4 className="font-cond mb-1.5 text-[11px] font-extrabold tracking-[.34em] uppercase" style={{ color: HERO_GOLD }}>Headlines</h4>
                  {bullets.map((b: { iconId: string; tone: string; html: string }, i: number) => (
                    <div key={i} className="flex gap-2.5 border-t border-white/5 py-1.5 text-[13.5px] first:border-0" style={{ color: '#d6d0c2' }}>
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
