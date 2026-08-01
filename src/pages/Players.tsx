import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageShell, EmptyState } from '../components/PageShell'
import { SectionBanner } from '../components/SectionBanner'
import { SearchBox } from '../components/SearchBox'
import { StarRating, ratingTo100, exactTo100 } from '../components/StarRating'
import { MiniBar, ConcentrationBar, CHART_COLORS, type Tone } from '../components/viz'
import { InfoTip } from '../components/InfoTip'
import { Icon, type IconName } from '../components/Icon'
import { TeamBadge, PositionIcon } from '../components/badges'
import { PageSkeleton } from '../components/Skeleton'
import { PlayerPhoto as PhotoImg } from '../components/PlayerPhoto'
import { ShareCard } from '../components/ShareCard'
import { Exportable } from '../components/ExportPanel'
import { FixtureChips } from '../components/FixtureChips'
import { MatchupBars, UnknownModules, minutesRead, formRead, valueRead, defConRead } from '../components/PlayerStory'
import { PlayerZoneMap } from '../components/ShotMap'
import { useCore } from '../lib/useData'
import { useWide } from '../lib/useWide'
import { num, str, bool } from '../lib/rows'
import { useAvailability, availFor, availBadge, SEV_COLOUR, type AvailBadgeInfo, type AvailPlayer, type Availability } from '../lib/availability'
import { xpForGw, useXpModel, useMarketOdds, useShotProfiles } from '../lib/xp'
import { teamFullNames, teamColors, searchText, TOOLTIPS, FDR_COLORS } from '../lib/util'
import { buildPlayerBundle, buildPlayerVerdict } from '../lib/insights/narrative'
import { buildMovedFrom } from '../lib/moved'
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
          getSearchText={(p) => searchText(p.web_name)}
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
  const avail = useAvailability()

  // Key related tables by the player's element (unique), never web_name.
  const p4 = data.personas4.find((p) => p.element === r.element) ?? null
  const std = data.seasonToDate.find((p) => p.element === r.element) ?? null
  const streak = std ? String(std.streak ?? '') : ''

  const verdict = useMemo(() => {
    const bundle = buildPlayerBundle(r.element, data)
    return bundle ? buildPlayerVerdict(bundle, data) : null
  }, [r.element, data])

  const personas = (p4 && str(p4, 'personas') && str(p4, 'personas') !== 'None') ? String(p4.personas).split(', ') : []
  const status = p4 && str(p4, 'status') ? String(p4.status).split(', ') : []
  const flags = p4 && str(p4, 'flags') ? String(p4.flags).split(', ') : []
  // Live layer first: set-piece duty changes with transfers and manager whim,
  // so the daily availability refresh outranks the season snapshot.
  const live = availFor(avail, num(r, 'element'), num(r, 'code'))
  // Only the club's first-choice taker counts; once the live layer has
  // loaded, a missing order there means FPL lists him nowhere.
  const isPenTaker = avail.generatedAt ? live?.pen_order === 1 : bool(r, 'is_pen_taker')
  const isSpTaker = live && (live.corner_order != null || live.fk_order != null)
    ? (live.corner_order ?? 9) <= 2 || (live.fk_order ?? 9) <= 2
    : bool(r, 'is_setpiece_taker')
  const availFlag = availBadge(live)

  const unknown = num(r, 'season_overall_score') == null

  // Positional peers with a real rating — powers the rank, the bullet
  // gauge's scale and the market scatter.
  const peers = useMemo(
    () => (data.ratings as RatingRow[]).filter((p) => p.position === pos && ratingTo100(num(p, 'season_overall_score')) != null),
    [data.ratings, pos],
  )

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-1/50">
      <IdentStrip r={r} peers={peers} personas={personas} status={status} flags={flags} isPenTaker={isPenTaker} isSpTaker={isSpTaker} streak={streak} availFlag={availFlag} />

      {/* The Brief flow: narrative first, evidence second, receipts folded.
          Unknown players get the honest know/don't-know page instead. */}
      <div className="px-4 pb-5 md:px-6 md:pb-6">
        {unknown ? (
          <>
            <div className="mt-5 grid gap-3 md:grid-cols-2"><UnknownModules r={r} /></div>
            {data.fixtureEase.some((fx) => fx.team === String(r.team)) && (
              <div className="mt-4 rounded-xl border border-line bg-surface-1 p-4">
                <div className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Next fixtures</div>
                <FixtureChips fixtureEase={data.fixtureEase} team={String(r.team)} n={6} />
              </div>
            )}
          </>
        ) : (
          <>
            {/* Wide screens: the brief and the market chart read down the
                left, while the evidence and the receipts stack into a right
                rail — the rail spans both rows, so a short brief leaves a gap
                in one column rather than a dead half across the page. */}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start">
              {/* The identity strip is at the top of the page, outside this
                  node, so a shared brief arrived as sentences about an unnamed
                  player. Face, rating and personas go into the picture. */}
              <Exportable title={`${r.web_name} — the brief`} ident={<ShareIdent r={r} peers={peers} personas={personas} />}>
                <TheBrief r={r} data={data} verdict={verdict} />
              </Exportable>
              <div className="min-w-0 lg:row-span-2">
                <Exportable title={`${r.web_name} — promise vs delivery`}><EvidenceBand r={r} peers={peers} /></Exportable>
                <Receipts r={r} data={data} name={name} />
              </div>
              <div className="min-w-0">
                <Exportable title={`${r.web_name} — the market`}><MarketScatter r={r} peers={peers} /></Exportable>
                <TransferFlow live={live} avail={avail} price={num(r, 'price')} />
              </div>
            </div>
          </>
        )}

        <div className="mt-8 flex justify-center">
          <ShareCard r={r} fixtureEase={data.fixtureEase} />
        </div>
      </div>
    </div>
  )
}

/* ═══ Receipts — the deep tables, one tab at a time ═══════════════════════ */

function Receipts({ r, data, name }: { r: RatingRow; data: CoreData; name: string }) {
  const pos = r.position
  const dims = pos === 'GKP' ? GKP_DIMS : pos === 'DEF' ? DEF_DIMS : ATT_POS_DIMS
  const tabs = [
    { id: 'engine', label: 'Points engine' },
    { id: 'dims', label: 'Dimensions' },
    { id: 'matchups', label: 'Matchups' },
    ...(pos !== 'GKP' ? [{ id: 'zones', label: 'Shot zones' }] : []),
  ]
  const [tab, setTab] = useState('engine')
  return (
    <div className="mt-7">
      <h3 className="mb-3 text-sm font-semibold tracking-wide text-ink-2 uppercase">Receipts</h3>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-9 rounded-full border px-3.5 text-[13px] font-semibold transition-colors ${
              tab === t.id ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Exportable title={`${r.web_name} — ${tabs.find((t) => t.id === tab)?.label ?? 'receipts'}`}>
        {tab === 'engine' && <PointsEngine r={r} />}
        {tab === 'dims' && <DimBars r={r} dims={dims} overall={['season_overall_score', 'gw4_overall_score']} />}
        {tab === 'matchups' && <MatchupBars element={r.element} tierPerf={data.tierPerf} />}
        {tab === 'zones' && pos !== 'GKP' && <PlayerZoneMap element={r.element} name={name} />}
      </Exportable>
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

function HeroSilhouette() {
  return (
    <svg viewBox="0 0 200 300" className="h-[92%]" aria-hidden="true">
      <path d="M100 20 a34 34 0 1 1 0 68 a34 34 0 1 1 0-68 M40 300 C40 210 62 160 100 160 C138 160 160 210 160 300 Z" fill="#151a24" />
    </svg>
  )
}

function HeroPill({ children, gold, ident, warn, title }: { children: ReactNode; gold?: boolean; ident?: boolean; warn?: boolean; title?: string }) {
  const base = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold'
  if (gold) return <span title={title} className={`${base} text-[#10131b]`} style={{ background: 'linear-gradient(120deg,#ead188,#c9a227)' }}>{children}</span>
  // Identity is filled and squared off — it is the thing worth reading first.
  if (ident) return <span title={title} className={`${base} rounded-[7px] font-extrabold`} style={{ background: 'rgba(226,192,106,.2)', color: '#f4efe3' }}>{children}</span>
  return <span title={title} className={base} style={{ border: '1px dashed rgba(201,162,39,.28)', color: warn ? '#e8b04a' : '#cfc9bb', background: 'transparent' }}>{children}</span>
}

// Fingerprint dimensions — five per position, the same score fields the
// dimension bars use, so the dot pattern and the receipts always agree.
const FP_DIMS: Record<string, [string, string][]> = {
  GKP: [['Saves', 'season_save_score_rating'], ['Clean sheets', 'season_cs_score_rating'], ['BPS / Bonus', 'season_bps_score_rating'], ['Value', 'season_value_score_rating'], ['Reliability', 'season_reliability_score_rating']],
  DEF: [['Clean sheets', 'season_cs_score_rating'], ['Def con', 'season_dc_score_rating'], ['Attacking', 'season_attacking_score_rating'], ['Set pieces', 'season_set_piece_score_rating'], ['Reliability', 'season_reliability_score_rating']],
  ATT: [['Goal threat', 'season_goal_score_rating'], ['Creativity', 'season_creative_score_rating'], ['Set pieces', 'season_set_piece_score_rating'], ['Def con', 'season_dc_score_rating'], ['Reliability', 'season_reliability_score_rating']],
}

/* ═══ Ident strip — identity only, 72px of it ═════════════════════════════
   Always-dark band. The name sizes fluidly with a small floor and may wrap,
   and the rating chip is part of the flex row, so long names shrink instead
   of clipping on mobile. */

function IdentStrip({ r, peers, personas, status, flags, isPenTaker, isSpTaker, streak, availFlag }: {
  r: RatingRow
  peers: RatingRow[]
  personas: string[]
  status: string[]
  flags: string[]
  isPenTaker: boolean
  isSpTaker: boolean
  streak: string
  availFlag?: AvailBadgeInfo | null
}) {
  const name = String(r.web_name)
  const team = String(r.team)
  const tc = teamColors[team] ?? '#7ad1ff'
  const pos = r.position
  const rating = ratingTo100(num(r, 'season_overall_score'))
  const rank = rating != null ? 1 + peers.filter((p) => (ratingTo100(num(p, 'season_overall_score')) ?? -1) > rating).length : null

  return (
    <div className="relative overflow-hidden" style={{ background: `radial-gradient(560px 300px at 92% 0%, ${tc}2e, transparent 62%), linear-gradient(118deg,#12100b 0%,#0b0908 52%,#060504 100%)` }}>
      <div className="relative z-10 flex items-center gap-3.5 px-4 py-3.5 md:px-6 md:py-4">
        <div className="relative flex-none" aria-hidden="true">
          <PhotoImg hero code={r.code} element={r.element} className="h-[64px] w-auto object-contain md:h-[76px]" style={{ filter: 'drop-shadow(0 8px 16px rgba(0,0,0,.55))' }} placeholder={<div className="flex h-[64px] w-[46px] items-end justify-center md:h-[76px]"><HeroSilhouette /></div>} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="leading-[1.05] font-extrabold tracking-[-.02em]" style={{ fontSize: 'clamp(20px,4.4vw,32px)', overflowWrap: 'anywhere', color: '#f5f2ea' }}>{name}</h2>
          <div className="mt-1 text-[13px] font-medium" style={{ color: '#a9a294' }}>
            {POS_LABEL[pos] ?? pos} · <b className="font-semibold" style={{ color: tc }}>{teamFullNames[team] || team}</b> · £{r.price}m · {r.selected_by_percent}% owned
            {streak === '🔥 Hot' && <span className="ml-2 inline-flex items-center gap-1 text-hot"><Icon name="flame" size={12} solid /> Hot</span>}
            {streak === '🧊 Cold' && <span className="ml-2 inline-flex items-center gap-1 text-cold"><Icon name="snow" size={12} /> Cold</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {availFlag && (
              <span
                title={availFlag.title}
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-extrabold tracking-wide"
                style={{ background: SEV_COLOUR[availFlag.sev].chip, color: SEV_COLOUR[availFlag.sev].ink }}
              >
                {availFlag.label === 'INJ' ? 'Injured' : availFlag.label === 'SUS' ? 'Suspended' : availFlag.label === 'OUT' ? 'Unavailable' : `${availFlag.label} fit`}
              </span>
            )}
            {isPenTaker && <HeroPill gold title="First-choice penalty taker — extra, high-value goal route.">ⓒ Penalties</HeroPill>}
            {isSpTaker && <HeroPill title="Primary corner / free-kick taker — extra assist and goal routes.">Set pieces</HeroPill>}
            {/* Identity reads solid, status reads quiet. They answer different
                questions — what kind of player he is, versus what happens to be
                true this month — and the second must never out-shout the first. */}
            {personas.slice(0, 2).map((p) => <HeroPill key={p} ident title={personaTip(p)}>{p}</HeroPill>)}
            {status.slice(0, 2).map((s) => <HeroPill key={s} title={personaTip(s)}>{s}</HeroPill>)}
            {flags.slice(0, 1).map((fl) => <HeroPill key={fl} warn={fl === 'Minutes risk'} title={personaTip(fl)}>{fl}</HeroPill>)}
          </div>
        </div>
        {rating != null && (
          <div className="flex-none text-center">
            <div className="metallic-num font-display text-[38px] leading-[.85] md:text-[46px]">{rating}</div>
            {rank != null && <div className="mt-1 text-[11px] font-semibold whitespace-nowrap" style={{ color: '#a9a294' }}>#{rank} of {peers.length} {pos}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

/** Who the brief is about, for the exported picture only (`capture-only`).
 *  Deliberately the same facts and the same order as the page's IdentStrip —
 *  photo, name, position/club/price, personas, rating — at a size that suits a
 *  panel rather than a page header. */
function ShareIdent({ r, peers, personas }: { r: RatingRow; peers: RatingRow[]; personas: string[] }) {
  const team = String(r.team)
  const tc = teamColors[team] ?? '#7ad1ff'
  const rating = ratingTo100(num(r, 'season_overall_score'))
  const rank = rating != null ? 1 + peers.filter((p) => (ratingTo100(num(p, 'season_overall_score')) ?? -1) > rating).length : null
  return (
    <div className="mb-3 flex items-center gap-3 rounded-xl border border-line bg-surface-2/50 px-3 py-2.5">
      <PhotoImg
        hero code={r.code} element={r.element}
        className="h-[58px] w-auto shrink-0 object-contain"
        placeholder={<div className="flex h-[58px] w-[42px] items-end justify-center"><HeroSilhouette /></div>}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[19px] leading-tight font-extrabold tracking-[-0.01em] text-ink">{String(r.web_name)}</div>
        <div className="mt-0.5 text-[12.5px] text-ink-2">
          {POS_LABEL[r.position] ?? r.position} · <b className="font-semibold" style={{ color: tc }}>{teamFullNames[team] || team}</b> · £{r.price}m
        </div>
        {personas.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {personas.slice(0, 2).map((p) => <HeroPill key={p} ident>{p}</HeroPill>)}
          </div>
        )}
      </div>
      {rating != null && (
        <div className="shrink-0 text-center">
          <div className="metallic-num font-display text-[34px] leading-[.85]">{rating}</div>
          {rank != null && <div className="mt-1 text-[10.5px] font-semibold whitespace-nowrap text-ink-3">#{rank} of {peers.length}</div>}
        </div>
      )}
    </div>
  )
}

/* ═══ The Brief — the narrative, front and centre ═════════════════════════
   A verdict line plus up to five generated sentences, each carrying its
   receipt inline. Built from the corrected reads (starts-when-fit, def-con
   percentile) so the page can't state what the data doesn't support. */

const READ_TONE: Record<string, string> = { good: 'text-good', warn: 'text-warn', bad: 'text-bad', info: 'text-info', cold: 'text-cold' }

interface BriefLine { key: string; lead: string; tone: string; rest?: string; receipt?: string }

function briefLines(r: RatingRow, data: CoreData): BriefLine[] {
  const lines: BriefLine[] = []
  const pos = r.position
  const m = data.metrics.find((x) => x.element === r.element) ?? null
  const teamRating = (data.teamRatings ?? []).find((t) => t.team === String(r.team) && str(t, 'window') === 'season')
  const defRank = teamRating ? num(teamRating, 'defence_rank') : null

  /* 1 · minutes — unless he has just moved, in which case last season's start
     rate describes a job at a club he has left. Dubravka started 92% of games
     at Burnley and this line read "Nailed" under a Spurs badge, where he is
     third choice. There is no honest replacement figure, so the line says what
     we actually know. */
  const movedFrom = buildMovedFrom(data).get(Number(r.element)) ?? null
  if (movedFrom) {
    lines.push({
      key: 'mins',
      lead: `New at ${teamFullNames[String(r.team)] || r.team}.`,
      tone: 'warn',
      receipt: `Last season's minutes were at ${teamFullNames[movedFrom] || movedFrom} — his role here is unknown until he plays`,
    })
  } else {
    const mr = minutesRead(r)
    lines.push({ key: 'mins', lead: `${mr.word}.`, tone: mr.tone, receipt: mr.sub })
  }

  // 2 · position core
  if (pos === 'DEF' || pos === 'GKP') {
    const cs = num(r, 'season_m_cs_rate')
    // A clean-sheet rate is his old defence's record, not his new one. The
    // rank still belongs here, because that IS the side he plays for now.
    if (cs != null && movedFrom) {
      lines.push({ key: 'cs', lead: defRank != null && defRank <= 6 ? 'He joins a strong defence —' : defRank != null && defRank >= 15 ? 'He joins a leaky defence —' : 'A mid-pack defence —', tone: defRank != null && defRank <= 6 ? 'good' : defRank != null && defRank >= 15 ? 'warn' : 'info', rest: defRank != null ? `the league's #${defRank}.` : '', receipt: `His ${Math.round(cs * 100)}% clean-sheet rate was earned at ${teamFullNames[movedFrom] || movedFrom}` })
    } else if (cs != null) {
      const who = pos === 'GKP' ? 'in front of him' : 'behind him'
      if (defRank != null && defRank <= 6) lines.push({ key: 'cs', lead: `A real clean-sheet floor —`, tone: 'good', rest: `the league's #${defRank} defence plays ${who}.`, receipt: `Clean sheets in ${Math.round(cs * 100)}% of starts` })
      else if (defRank != null && defRank >= 15) lines.push({ key: 'cs', lead: `The clean-sheet case is thin —`, tone: 'warn', rest: `a #${defRank}-ranked defence ${who}.`, receipt: `Clean sheets in just ${Math.round(cs * 100)}% of starts` })
      else lines.push({ key: 'cs', lead: `Clean sheets in ${Math.round(cs * 100)}% of starts`, tone: 'info', rest: defRank != null ? `— a mid-pack #${defRank} defence.` : '.' })
    }
    if (pos === 'DEF') {
      const d = defConRead(r)
      if (d) lines.push({ key: 'dc', lead: '__dc__', tone: d.hit >= 0.55 || (d.pctl ?? 0) >= 70 ? 'good' : d.hit >= 0.3 ? 'info' : 'warn', receipt: d.support })
    }
    if (pos === 'GKP') {
      const prevented = num(r, 'season_m_prevented')
      const faced = num(r, 'season_m_shots_faced')
      if (prevented != null) {
        const busy = faced != null && faced >= 4.3
        lines.push({
          key: 'gk',
          lead: prevented >= 0.08 ? 'An above-the-line shot-stopper.' : prevented <= -0.08 ? 'The shot-stopping runs below the line.' : 'League-average shot-stopping.',
          tone: prevented >= 0.08 ? 'good' : prevented <= -0.08 ? 'bad' : 'info',
          receipt: `${prevented >= 0 ? '+' : ''}${prevented.toFixed(2)} goals prevented per 90${faced != null ? ` · ${faced.toFixed(1)} shots faced a game${busy ? ' — save points are a real floor' : ' — his value is the clean sheet, not the stops'}` : ''}`,
        })
      }
    }
  } else {
    // talisman share
    const xgShare = m ? (num(m, 'xg_share_season') ?? num(m, 'xg_share_4gw')) : null
    const xaShare = m ? (num(m, 'xa_share_season') ?? num(m, 'xa_share_4gw')) : null
    const share = xgShare == null && xaShare == null ? null : ((xgShare ?? 0) + (xaShare ?? 0)) / 2
    if (share != null && share >= 0.13) {
      lines.push({
        key: 'tal',
        lead: share >= 0.3 ? 'The talisman.' : share >= 0.2 ? 'The focal point.' : 'A key piece of the attack.',
        tone: 'good',
        receipt: `${Math.round(share * 100)}% of ${r.team}'s combined xG + xA runs through him`,
      })
    }
    // finishing
    const tg = num(r, 'season_total_goals'), txg = num(r, 'season_total_xg')
    if (tg != null && txg != null && txg >= 1.5) {
      const delta = tg - txg
      lines.push({
        key: 'fin',
        lead: delta >= 1.5 ? 'Finishing above the chances.' : delta <= -1.5 ? 'The luck debt is owed to him.' : 'Scoring exactly what the chances deserve.',
        tone: delta >= 1.5 ? 'warn' : delta <= -1.5 ? 'cold' : 'good',
        receipt: `${tg} goals from ${txg.toFixed(1)} xG${delta >= 1.5 ? ' — hot finishing rarely holds' : delta <= -1.5 ? ' — this gap historically closes' : ' — sustainable output'}`,
      })
    }
    // creation, if it's the stronger suit
    const xa = num(r, 'season_m_xa')
    const paXa = num(r, 'season_pct_xa')
    if (xa != null && paXa != null && paXa >= 65 && lines.length < 4) {
      lines.push({ key: 'cr', lead: 'A genuine creator.', tone: 'good', receipt: `${xa.toFixed(2)} xA per 90 — top ${Math.max(1, 100 - Math.round(paXa))}% of the position` })
    }
    // defensive mids
    const d = defConRead(r)
    if (d && (num(r, 'season_pct_dc_hit') ?? 0) >= 55 && lines.length < 4) {
      lines.push({ key: 'dc', lead: 'A def-con floor most attackers lack.', tone: 'good', receipt: d.support })
    }
  }

  // 3 · form vs expected
  const fr = formRead(r)
  if (fr) lines.push({ key: 'form', lead: `${fr.word}.`, tone: fr.tone, receipt: fr.sub })

  // 4 · value / the catch
  const vr = valueRead(r)
  if (vr) {
    const price = num(r, 'price') ?? 0
    const peersP = (data.ratings as RatingRow[]).filter((p) => p.position === pos && num(p, 'price') != null)
    const topBand = peersP.length ? price >= [...peersP].map((p) => num(p, 'price') as number).sort((a, b) => b - a)[Math.max(0, Math.floor(peersP.length * 0.05))] : false
    lines.push({
      key: 'value',
      lead: topBand ? 'The catch: you pay for all of it.' : vr.tone === 'good' ? 'And the price is fair.' : 'Priced for what he is.',
      tone: topBand ? 'warn' : vr.tone,
      receipt: `${vr.word} · ${vr.sub}`,
    })
  }

  return lines.slice(0, 5)
}

function TheBrief({ r, data, verdict }: { r: RatingRow; data: CoreData; verdict: ReturnType<typeof buildPlayerVerdict> }) {
  const lines = briefLines(r, data)
  const d = r.position === 'DEF' ? defConRead(r) : null
  const hasFix = data.fixtureEase.some((fx) => fx.team === String(r.team))
  return (
    <div className="mt-5">
      <div className="mb-2 text-[10px] font-extrabold tracking-[0.24em] text-accent uppercase">The Brief</div>
      {verdict?.verdict && <p className="text-[19px] leading-snug font-bold tracking-[-0.01em] text-ink">{verdict.verdict}.</p>}
      <div className="mt-2">
        {lines.map((l) => (
          <p key={l.key} className="border-t border-line py-2.5 text-[16px] leading-snug font-semibold text-ink first:border-t-0">
            {l.lead === '__dc__' && d ? <span className="[&_em]:not-italic [&_em]:text-accent-2">{d.sentence}</span> : <span className={READ_TONE[l.tone] ?? 'text-ink'}>{l.lead}</span>}
            {l.rest && <span> {l.rest}</span>}
            {l.receipt && <span className="mt-0.5 block text-[13px] font-normal text-ink-3">{l.receipt}</span>}
          </p>
        ))}
      </div>
      {hasFix && <FixtureOutlook r={r} data={data} />}
    </div>
  )
}

/* ── The run ahead ──────────────────────────────────────────────────────────
   Four fixtures is what fits on a phone; a desktop has room for eight, and
   with room for eight there is room to say what each one is worth. Every
   gameweek carries its own projection from the same xP model the planner
   uses, so the run reads as points rather than as a colour. */

const FIX_MOBILE = 4
const FIX_DESKTOP = 8

function FixtureOutlook({ r, data }: { r: RatingRow; data: CoreData }) {
  const avail = useAvailability()
  const xpModel = useXpModel()
  const market = useMarketOdds()
  const profiles = useShotProfiles()
  const wide = useWide()
  const n = wide ? FIX_DESKTOP : FIX_MOBILE

  const up = useMemo(
    () => data.fixtureEase.filter((fx) => fx.team === String(r.team)).sort((a, b) => a.gw - b.gw).slice(0, n),
    [data.fixtureEase, r.team, n],
  )
  // One projection per gameweek, not per fixture: a double counts once, as
  // the week's total, which is what a manager actually banks.
  const xpByGw = useMemo(() => {
    const gws = [...new Set(up.map((fx) => fx.gw))]
    const m = new Map<number, number | null>()
    for (const gw of gws) m.set(gw, xpForGw(r, gw, data.fixtureEase, avail, xpModel, market, profiles))
    return m
  }, [up, r, data.fixtureEase, avail, xpModel, market, profiles])

  if (!up.length) return null

  const avg = up.reduce((s, fx) => s + (fx.fdr || 3), 0) / up.length
  const kind = up.filter((fx) => (fx.fdr ?? 3) <= 2).length
  const hard = up.filter((fx) => (fx.fdr ?? 3) >= 4).length
  const read =
    avg <= 2.4 ? { tone: 'text-good', word: 'A kind run.', sub: `${kind} of the next ${up.length} rate 2 or easier — the window to own him.` }
    : avg >= 3.6 ? { tone: 'text-bad', word: 'A tough run.', sub: `${hard} of the next ${up.length} rate 4 or harder — expect the ceiling to dip.` }
    : { tone: 'text-warn', word: 'A mixed run.', sub: `Averages ${avg.toFixed(1)} difficulty over the next ${up.length}${kind ? ` — ${kind} kind, ${hard} awkward` : ''}.` }

  // Every projection we have, so the desktop total never quietly counts a
  // week the model couldn't price.
  const priced = [...xpByGw.values()].filter((v): v is number => v != null)
  const total = priced.length === xpByGw.size && priced.length ? priced.reduce((s, v) => s + v, 0) : null
  const best = priced.length ? Math.max(...priced) : null

  return (
    <div className="border-t border-line pt-2.5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[10px] font-bold tracking-[0.14em] text-ink-3 uppercase">Next fixtures</span>
        <span className="text-[10px] font-bold tracking-[0.14em] text-ink-3 uppercase">Projected points</span>
      </div>
      <div className={`grid gap-1.5 ${wide ? 'grid-cols-8' : 'grid-cols-4'}`}>
        {up.map((fx, i) => {
          const [bg, fg] = FDR_COLORS[fx.fdr] || FDR_COLORS[3]
          const xp = xpByGw.get(fx.gw) ?? null
          // A double gameweek prices once, on its first fixture — repeating
          // the week's total against both games would double-count it by eye.
          const first = up.findIndex((f) => f.gw === fx.gw) === i
          return (
            <div key={`${fx.gw}-${fx.opponent}-${i}`} className="min-w-0">
              <div className="mb-0.5 text-center text-[10px] font-bold tracking-[0.08em] text-ink-3 uppercase">GW{fx.gw}</div>
              <div
                className="truncate rounded px-1 py-1 text-center text-[11px] font-bold"
                style={{ background: bg, color: fg }}
                title={`GW${fx.gw} ${fx.venue === 'H' ? 'vs' : 'at'} ${teamFullNames[fx.opponent] || fx.opponent} (difficulty ${fx.fdr})`}
              >
                {fx.opponent} <span className="font-medium">({fx.venue})</span>
              </div>
              <div className="mt-0.5 text-center text-[12px] font-extrabold tabular-nums">
                {!first ? <span className="text-ink-3">—</span>
                  : xp == null ? <span className="text-ink-3">—</span>
                  : <span className={best != null && xp === best ? 'metallic-num' : 'text-ink-2'}>{xp.toFixed(1)}</span>}
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[13.5px] leading-snug font-semibold text-ink">
        <span className={read.tone}>{read.word}</span>
        <span className="mt-0.5 block text-[13px] font-normal text-ink-3">
          {read.sub}
          {total != null && <> Projected <b className="metallic-num">{total.toFixed(1)}</b> points across the {xpByGw.size} gameweeks shown.</>}
        </span>
      </p>
    </div>
  )
}

/* ═══ Evidence band — the two charts that earn their place ════════════════ */

/** Promise vs delivery: expected pts/game as the gold fill, actual as the
 * ink marker, both on a scale set by the position's best. */
function BulletGauge({ r, peers }: { r: RatingRow; peers: RatingRow[] }) {
  const xpg = num(r, 'season_xpts_per_game')
  const ppg = num(r, 'season_ppg')
  if (xpg == null || ppg == null) return null
  const scale = Math.max(...peers.map((p) => Math.max(num(p, 'season_xpts_per_game') ?? 0, num(p, 'season_ppg') ?? 0)), xpg, ppg) || 1
  const delta = ppg - xpg
  const read = delta > 0.35 ? 'running hot — output above the underlying numbers' : delta < -0.35 ? 'running under — due an uptick' : 'delivering right on expectation'
  return (
    <div>
      <div className="mb-2 text-[10px] font-extrabold tracking-[0.18em] text-ink-3 uppercase">Promise vs delivery — pts / game</div>
      <div className="relative h-4 rounded-full bg-white/8">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (xpg / scale) * 100)}%`, background: 'linear-gradient(90deg, var(--accent-strong), var(--accent-2))' }} />
        <span className="absolute -top-1 -bottom-1 w-[3px] rounded-sm" style={{ left: `${Math.min(100, (ppg / scale) * 100)}%`, background: 'var(--ink-1)', boxShadow: '0 0 8px rgba(0,0,0,.4)' }} />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[12px] text-ink-2">
        <span><b className="metallic-num">{xpg.toFixed(1)} expected</b> (fill)</span>
        <span><b className="text-ink">{ppg.toFixed(1)} actual</b> (marker) — {read}</span>
      </div>
    </div>
  )
}

/** The fingerprint: five percentile dots on tracks, positional average at the
 * midline. The dot pattern is the player. */
function Fingerprint({ r }: { r: RatingRow }) {
  const dims = FP_DIMS[r.position === 'GKP' ? 'GKP' : r.position === 'DEF' ? 'DEF' : 'ATT']
  const rows = dims.map(([label, col]) => [label, exactTo100(r, col)] as const)
  if (rows.every(([, v]) => v == null)) return null
  return (
    <div>
      <div className="mb-3 text-[10px] font-extrabold tracking-[0.18em] text-ink-3 uppercase">The fingerprint — percentile vs all {r.position}</div>
      <div className="grid gap-2.5">
        {rows.map(([label, v]) => (
          <div key={label} className="grid grid-cols-[92px_1fr_34px] items-center gap-2.5">
            <span className="text-[10px] font-bold tracking-[.06em] text-ink-2 uppercase">{label}</span>
            <div className="relative h-[5px] rounded-full bg-white/8">
              <span className="absolute -top-0.5 -bottom-0.5 left-1/2 w-px bg-ink-3/60" />
              {v != null && (
                <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${v}%`, background: 'radial-gradient(circle at 35% 30%, var(--accent-2), var(--accent-strong))', boxShadow: '0 0 8px color-mix(in srgb, var(--accent) 55%, transparent)' }} />
              )}
            </div>
            <span className={`text-right text-[12px] font-extrabold tabular-nums ${v == null ? 'text-ink-3' : 'metallic-num'}`}>{v ?? '—'}</span>
          </div>
        ))}
      </div>
      <div className="mt-2.5 text-[11px] text-ink-3">Centre line = positional average. The dot pattern <i>is</i> the player.</div>
    </div>
  )
}

function EvidenceBand({ r, peers }: { r: RatingRow; peers: RatingRow[] }) {
  return (
    <div className="mt-5 grid gap-6 rounded-xl border border-line bg-surface-1 p-4 md:grid-cols-2 md:items-start lg:mt-0 lg:grid-cols-1">
      <BulletGauge r={r} peers={peers} />
      <Fingerprint r={r} />
    </div>
  )
}

/* ═══ The market — price × rating scatter ═════════════════════════════════
   Every positional peer as a faint dot, this player in gold, with a fair-
   price trend line: above the line = under-priced for the rating. Rendered
   in the themed area below the hero so it works in light and dark. */

/** Horizontal-scroll wrapper that starts scrolled so the highlighted player
 *  is in view when the chart is wider than the screen.
 *
 *  On a phone the chart is no longer wider than the screen — see the portrait
 *  geometry in `MarketScatter` — so this wraps nothing and the effect is a
 *  no-op. It stays for the in-between widths where 640 units still overflow. */
function ScrollToPlayer({ frac, onWidth, children }: { frac: number; onWidth: (w: number) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, frac * el.scrollWidth - el.clientWidth / 2)
  }, [frac])
  // The plot sizes its viewBox from this width, so it is measured here and
  // watched — a rotation or a resized window has to re-scale the axis text.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => onWidth(el.clientWidth)
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [onWidth])
  return <div ref={ref} className="overflow-x-auto">{children}</div>
}

/* ═══ Transfer flow — where the market is moving on him this gameweek ═════ */

/** FPL publishes three numbers per player per gameweek: transfers in,
 *  transfers out, and the price move those have already caused. It does not
 *  publish the threshold for the next move, so this block reports what has
 *  happened and ranks it against the rest of the game — no countdown, no
 *  "will rise tonight" guess. Renders nothing before the first deadline,
 *  when every count is still zero. */
function TransferFlow({ live, avail, price }: { live: AvailPlayer | null; avail: Availability; price: number | null }) {
  const rank = useMemo(() => {
    const all = [...avail.byElement.values()]
    const active = all.filter((p) => (p.tin ?? 0) + (p.tout ?? 0) > 0)
    if (!active.length || !live) return null
    const net = (p: AvailPlayer) => (p.tin ?? 0) - (p.tout ?? 0)
    const mine = net(live)
    const bought = [...active].sort((a, b) => net(b) - net(a))
    const sold = [...active].sort((a, b) => net(a) - net(b))
    const list = mine >= 0 ? bought : sold
    const i = list.findIndex((p) => p.element === live.element)
    return i < 0 ? null : { place: i + 1, of: active.length, dir: mine >= 0 ? 'in' as const : 'out' as const }
  }, [avail, live])

  if (!live) return null
  const tin = live.tin ?? 0
  const tout = live.tout ?? 0
  if (tin + tout === 0) return null

  const net = tin - tout
  const move = (live.dprice ?? 0) / 10
  const big = Math.max(tin, tout) || 1
  const nf = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-1 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Transfer flow this gameweek</div>
        {rank && (
          <div className="text-[12px] text-ink-2">
            <span className="font-num font-bold text-ink">#{rank.place}</span> {rank.dir === 'in' ? 'most bought' : 'most sold'} in FPL
            <span className="text-ink-3"> · {rank.of} players traded</span>
          </div>
        )}
      </div>

      {/* Two bars off a shared baseline: the gap between them IS the net, and
          both directions stay visible — a contested player and a consensus
          buy can share a net figure but never share this shape. */}
      <div className="space-y-2">
        {([['In', tin, 'var(--good)'], ['Out', tout, 'var(--bad)']] as [string, number, string][]).map(([label, v, colour]) => (
          <div key={label} className="flex items-center gap-2.5">
            <div className="w-7 shrink-0 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">{label}</div>
            <div className="h-3.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full" style={{ width: `${Math.max(2, (v / big) * 100)}%`, background: colour }} />
            </div>
            <div className="font-num w-14 shrink-0 text-right text-[13px] font-bold tabular-nums text-ink">{nf(v)}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Tile
          value={<span className={net > 0 ? 'text-good' : net < 0 ? 'text-bad' : undefined}>{net > 0 ? '+' : net < 0 ? '−' : ''}{nf(Math.abs(net))}</span>}
          label="Net"
        />
        <Tile
          value={move ? <span className={move > 0 ? 'text-good' : 'text-bad'}>{move > 0 ? '▲' : '▼'} £{Math.abs(move).toFixed(1)}m</span> : <span className="text-ink-3">Held</span>}
          label="Price move"
        />
        <Tile
          value={live.own != null ? `${live.own.toFixed(1)}%` : price != null ? `£${price.toFixed(1)}m` : '—'}
          label={live.own != null ? 'Owned' : 'Price'}
        />
      </div>

      <p className="mt-2.5 text-[11px] leading-relaxed text-ink-3">
        Counts are FPL's own, reset at every deadline. The price move is what has already happened this gameweek — FPL does not publish the threshold for the next one.
      </p>
    </div>
  )
}

function MarketScatter({ r, peers }: { r: RatingRow; peers: RatingRow[] }) {
  const pos = r.position
  const myRating = ratingTo100(num(r, 'season_overall_score'))
  const myPrice = num(r, 'price')
  const [hovered, setHovered] = useState<number | null>(null)
  // Both above every early return — they decide the plot's shape further down.
  const roomy = useWide(640)
  const [boxW, setBoxW] = useState(0)

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
  //
  // A 640-unit box with a 540px floor meant 238px of the chart sat off a
  // phone screen behind a scrollbar, and the right-hand side of a scatter is
  // where the premiums are. Below 640px the plot goes portrait instead: the
  // same data, taller than it is wide, with no sideways scroll.
  //
  // The narrow plot takes its user-unit width from the container it is in,
  // measured, so the viewBox scale is exactly 1 and a 10-unit axis label
  // renders at 10px. A fixed width instead put those labels at 8.7px on an
  // iPhone 13 and 6.7px on a 320px phone, which is how the chart traded one
  // legibility problem for another. The floor is only there so a collapsed
  // container cannot produce a degenerate plot; real phones sit above it.
  const W = roomy ? 640 : Math.max(200, boxW || 330)
  const H = roomy ? 300 : 370
  // The narrow plot's padding is not just the wide one scaled down. Its right
  // edge has to clear the highlighted dot's 10-unit halo — at 12 the gold ring
  // was cut in half for anyone priced at the top of his position — and its top
  // and bottom have to keep the axis titles off the tick labels, which they
  // were sitting on at 8 units apart.
  const PAD = roomy ? { l: 34, r: 16, t: 14, b: 30 } : { l: 28, r: 22, t: 22, b: 42 }
  const xs = pts.map((d) => d.x), ys = pts.map((d) => d.y)
  const xMin = Math.floor(Math.min(...xs) - 0.3), xMax = Math.ceil(Math.max(...xs) + 0.3)
  const yMin = Math.max(0, Math.floor((Math.min(...ys) - 4) / 10) * 10), yMax = Math.min(100, Math.ceil((Math.max(...ys) + 4) / 10) * 10)
  const X = (v: number) => PAD.l + ((v - xMin) / (xMax - xMin)) * (W - PAD.l - PAD.r)
  const Y = (v: number) => H - PAD.b - ((v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b)
  // £2.5m ticks would collide on the narrow plot — half as many, twice as far.
  const tickStep = roomy ? 2.5 : 5
  const priceTicks: number[] = []
  for (let t = Math.ceil(xMin / tickStep) * tickStep; t <= xMax; t += tickStep) priceTicks.push(t)
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
        <ScrollToPlayer frac={(X(myPrice) - PAD.l) / (W - PAD.l - PAD.r)} onWidth={setBoxW}>
        <svg viewBox={`0 0 ${W} ${H}`} className={`w-full ${roomy ? 'min-w-[540px]' : ''}`} role="img" aria-label={`Price versus rating scatter for all ${pos}`}>
          {/* gridlines + axis labels */}
          {[25, 50, 75, 100].filter((v) => v > yMin && v <= yMax).map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={Y(v)} y2={Y(v)} stroke="var(--line)" strokeWidth="1" />
              <text x={PAD.l - 6} y={Y(v) + 3} textAnchor="end" fontSize="10" fill="var(--ink-3)">{v}</text>
            </g>
          ))}
          {priceTicks.map((t) => (
            <g key={t}>
              <line x1={X(t)} x2={X(t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--line)" strokeWidth="1" />
              <text x={X(t)} y={H - PAD.b + 16} textAnchor="middle" fontSize="10" fill="var(--ink-3)">£{t}m</text>
            </g>
          ))}
          <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="var(--line-mid)" />
          <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="var(--line-mid)" />
          {/* fair-price line */}
          <line x1={X(xMin)} y1={Y(clampY(fit(xMin)))} x2={X(xMax)} y2={Y(clampY(fit(xMax)))} stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.55" />
          {/* peers */}
          {pts.filter((d) => d.p.element !== r.element).map((d) => (
            <circle
              key={String(d.p.element)}
              cx={X(d.x)} cy={Y(d.y)}
              r={hovered === d.p.element ? 5.5 : 3.5}
              fill={hovered === d.p.element ? 'var(--ink-2)' : 'var(--ink-3)'}
              opacity={hovered === d.p.element ? 0.9 : 0.35}
              onMouseEnter={() => setHovered(d.p.element)}
              onMouseLeave={() => setHovered(null)}
            >
              <title>{String(d.p.web_name)} — {d.y} at £{d.x}m</title>
            </circle>
          ))}
          {/* this player */}
          <circle cx={X(myPrice)} cy={Y(myRating)} r="10" fill="var(--accent)" opacity="0.18" />
          <circle cx={X(myPrice)} cy={Y(myRating)} r="6" fill="var(--accent)" stroke="var(--surface-1)" strokeWidth="1.5" />
          <text x={X(myPrice) + (myPrice > (xMin + xMax) / 2 ? -12 : 12)} y={Math.max(16, Y(myRating) - 10)} textAnchor={myPrice > (xMin + xMax) / 2 ? 'end' : 'start'} fontSize="12" fontWeight="700" fill="var(--accent)">{String(r.web_name)} · {myRating}</text>
          {/* instant hover label */}
          {hovered != null && (() => {
            const d = pts.find((p) => p.p.element === hovered)
            if (!d) return null
            return (
              <text
                x={X(d.x) + (d.x > (xMin + xMax) / 2 ? -9 : 9)}
                y={Math.max(16, Y(d.y) - 8)}
                textAnchor={d.x > (xMin + xMax) / 2 ? 'end' : 'start'}
                fontSize="11.5" fontWeight="700" fill="var(--ink-1)"
                stroke="var(--surface-1)" strokeWidth="4" style={{ paintOrder: 'stroke' }}
                className="pointer-events-none"
              >
                {String(d.p.web_name)} · {d.y} · £{d.x}m
              </text>
            )
          })()}
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
        const s = exactTo100(r, sCol)
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
