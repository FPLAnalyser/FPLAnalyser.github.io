import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader, PageShell, EmptyState } from '../components/PageShell'
import { SearchBox } from '../components/SearchBox'
import { Tabs, type TabDef } from '../components/Tabs'
import { StarRating, ratingTo100 } from '../components/StarRating'
import { RadialGauge, Radar, type Tone } from '../components/viz'
import { AnimatedCounter } from '../components/AnimatedCounter'
import { InfoTip } from '../components/InfoTip'
import { Icon, type IconName } from '../components/Icon'
import { TeamBadge, PositionIcon } from '../components/badges'
import { PageSkeleton } from '../components/Skeleton'
import { PlayerPhoto as PhotoImg } from '../components/PlayerPhoto'
import { PlayerScatterMap, PlayerZoneMap } from '../components/ShotMap'
import { useCore } from '../lib/useData'
import { num, str, bool } from '../lib/rows'
import { teamFullNames, TOOLTIPS } from '../lib/util'
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

  const ratings = (data?.ratings ?? []) as RatingRow[]

  if (!data) {
    return (
      <PageShell>
        <PageHeader title="Player Search" subtitle="Search for any player to see their FPL Analyser ratings, stats and form" />
        <PageSkeleton error={coreError} />
      </PageShell>
    )
  }

  const select = (n: string) => { setParams(n ? { name: n } : {}); window.scrollTo(0, 0) }
  const selected = name ? ratings.find((p) => p.web_name === name) : null

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
          onSelect={(p) => select(String(p.web_name))}
          placeholder="Search player name…"
          initialValue={name ?? ''}
        />
      </div>

      {selected ? <PlayerCard player={selected} data={data} /> : <MostOwned ratings={ratings} data={data} onSelect={select} />}
    </PageShell>
  )
}

function MostOwned({ ratings, data, onSelect }: { ratings: RatingRow[]; data: CoreData; onSelect: (n: string) => void }) {
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
              onClick={() => onSelect(String(p.web_name))}
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
  const [tab, setTab] = useState('overview')
  useEffect(() => setTab('overview'), [name])

  const p4 = data.personas4.find((p) => p.web_name === name) ?? null
  const m = data.metrics.find((p) => p.web_name === name) ?? null
  const std = data.seasonToDate.find((p) => p.web_name === name) ?? null
  const streak = std ? String(std.streak ?? '') : ''

  const verdict = useMemo(() => {
    const bundle = buildPlayerBundle(r.element, data)
    return bundle ? buildPlayerVerdict(bundle, data) : null
  }, [r.element, data])

  const personas = (p4 && str(p4, 'personas') && str(p4, 'personas') !== 'None') ? String(p4.personas).split(', ') : []
  const flags = p4 && str(p4, 'flags') ? String(p4.flags).split(', ') : []
  const isPenTaker = bool(r, 'is_pen_taker')
  const isSpTaker = bool(r, 'is_setpiece_taker')

  const tabs: TabDef[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'form', label: 'Form & Fixtures' },
    ...(pos !== 'GKP' ? [{ id: 'shots', label: 'Shots' }] : []),
  ]

  return (
    <div className="rounded-xl border border-line bg-surface-1/50 p-5 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-4">
        <PlayerPhoto code={r.code} element={r.element} pos={pos} size={72} />
        <div className="min-w-0 flex-1">
          <div className="text-2xl font-extrabold tracking-tight text-ink">{name}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-surface-3 px-2 py-0.5 font-semibold text-ink-2">{pos}</span>
            <span className="flex items-center gap-1 rounded bg-surface-3 px-2 py-0.5 text-ink-2"><TeamBadge team={String(r.team)} size={12} />{teamFullNames[String(r.team)] || r.team}</span>
            <span className="rounded bg-surface-3 px-2 py-0.5 text-ink-2">£{r.price}m</span>
            {streak === '🔥 Hot' && <span className="flex items-center gap-1 text-hot"><Icon name="flame" size={12} solid /> Hot Streak</span>}
            {streak === '🧊 Cold' && <span className="flex items-center gap-1 text-cold"><Icon name="snow" size={12} /> Cold Streak</span>}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            <RatingBlock label={<>Season (Position) <InfoTip text={TOOLTIPS.overall as string} /></>} value={num(r, 'season_overall_score')} />
            <RatingBlock label="Last 4GW (Position)" value={num(r, 'gw4_overall_score')} />
            <RatingBlock label={<>Next 4GW (Fixtures) <InfoTip text={TOOLTIPS.next4 as string} /></>} value={str(r, 'next4_overall_rating')} />
            {isAtt && <RatingBlock label="Season (Attacker)" value={num(r, 'season_att_overall_score')} />}
            {isAtt && <RatingBlock label="Last 4GW (Attacker)" value={num(r, 'gw4_att_overall_score')} />}
          </div>
        </div>
      </div>

      {/* Verdict hero */}
      {verdict && (verdict.score != null || verdict.bullets.length > 0) && (
        <div className="mt-5 flex flex-col gap-4 rounded-xl border border-line bg-surface-2/50 p-4 sm:flex-row sm:items-center">
          {verdict.score != null && (
            <div className="shrink-0">
              <RadialGauge value={verdict.score} max={100} label={verdict.scoreLabel} tone={(verdict.tone === 'info' ? 'accent' : verdict.tone) as Tone} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">The verdict</div>
            {verdict.verdict && <div className="mt-0.5 text-lg font-bold text-ink">{verdict.verdict}</div>}
            {(personas.length > 0 || flags.length > 0 || isPenTaker || isSpTaker) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {isPenTaker && <Tag label="Penalty taker" tip="First-choice penalty taker for their club — extra, high-value goal route." tone="good" />}
                {isSpTaker && <Tag label="Set-piece taker" tip="Primary corner / free-kick taker for their club — extra assist and goal routes." />}
                {personas.map((p) => <Tag key={p} label={p} tip={personaTip(p)} />)}
                {flags.map((f) => <Tag key={f} label={f} tip={personaTip(f)} tone={f.includes('Monster') ? 'good' : 'warn'} />)}
              </div>
            )}
            {verdict.bullets.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-sm text-ink-2">
                {verdict.bullets.map((b: { iconId: string; tone: string; html: string }, i: number) => (
                  <li key={i} className="flex gap-2">
                    <span className={`mt-0.5 ${TONE_TEXT[b.tone] || 'text-info'}`}><Icon name={b.iconId as IconName} size={14} /></span>
                    <span dangerouslySetInnerHTML={{ __html: b.html }} />
                  </li>
                ))}
              </ul>
            )}
            {verdict.financeLine && <div className="mt-2 text-xs text-ink-3" dangerouslySetInnerHTML={{ __html: verdict.financeLine }} />}
          </div>
        </div>
      )}

      <div className="mt-5 mb-5">
        <Tabs tabs={tabs} active={tab} onChange={setTab} layoutId={`player-${r.element}`} />
      </div>

      {tab === 'overview' && <OverviewTab r={r} std={std} m={m} pos={pos} isAtt={isAtt} />}
      {tab === 'form' && <FormFixturesTab r={r} m={m} std={std} name={name} tierPerf={data.tierPerf} />}
      {tab === 'shots' && pos !== 'GKP' && (
        <div>
          <Section title="Shot Map"><PlayerScatterMap element={r.element} /></Section>
          <Section title="Shot Zones"><PlayerZoneMap element={r.element} name={name} /></Section>
        </div>
      )}
    </div>
  )
}

function Tag({ label, tip, tone }: { label: string; tip?: string; tone?: 'good' | 'warn' }) {
  const cls = tone === 'good' ? 'border-good/40 text-good' : tone === 'warn' ? 'border-warn/40 text-warn' : 'border-line-mid text-ink-2'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${cls}`}>
      {label}
      {tip && <InfoTip text={tip} />}
    </span>
  )
}

function RatingBlock({ label, value }: { label: ReactNode; value: number | string | null }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1 text-[11px] tracking-wide text-ink-3 uppercase">{label}</div>
      <StarRating value={value} />
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

function OverviewTab({ r, std, m, pos, isAtt }: { r: RatingRow; std: Row | null; m: Row | null; pos: string; isAtt: boolean }) {
  const ptsDelta = std ? num(std, 'pts_delta') : null
  const xgShare = m ? num(m, 'xg_share_4gw') : null
  const xaShare = m ? num(m, 'xa_share_4gw') : null
  const dims = pos === 'GKP' ? GKP_DIMS : pos === 'DEF' ? DEF_DIMS : ATT_POS_DIMS
  return (
    <div>
      <Section title="Key Stats (Season)">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
          <Tile value={num(r, 'season_ppg') != null ? <AnimatedCounter value={num(r, 'season_ppg')!} format="1dp" /> : 'N/A'} label="Pts / Game" />
          <Tile value={num(r, 'season_xpts_per_game') != null ? <AnimatedCounter value={num(r, 'season_xpts_per_game')!} format="1dp" /> : 'N/A'} label={<>xPts / Game <InfoTip text={TOOLTIPS.xpts as string} /></>} />
          <Tile value={std && num(std, 'pts_per90_season') != null ? <AnimatedCounter value={num(std, 'pts_per90_season')!} format="2dp" /> : 'N/A'} label="Pts / 90" />
          <Tile value={num(r, 'total_mins') != null ? <AnimatedCounter value={num(r, 'total_mins')!} /> : 'N/A'} label="Total Mins" />
          <Tile value={num(r, 'season_start_rate') != null ? <AnimatedCounter value={num(r, 'season_start_rate')! * 100} suffix="%" /> : 'N/A'} label="Start Rate" />
          <Tile value={num(r, 'season_mins90_rate') != null ? <AnimatedCounter value={num(r, 'season_mins90_rate')! * 100} suffix="%" /> : 'N/A'} label="90 Mins Rate" />
          <Tile value={ptsDelta != null ? `${ptsDelta > 0 ? '+' : ''}${ptsDelta.toFixed(2)}` : 'N/A'} label="Form Delta" />
        </div>
      </Section>

      <Section title={`Rating Profile — vs ${pos} players`}>
        <div className="grid gap-5 lg:grid-cols-[300px_1fr] lg:items-center">
          <Radar axes={radarAxes(r, dims)} seriesALabel="Season" seriesBLabel="Last 4GW" />
          <DimTable r={r} dims={dims} overall={['season_overall_score', 'gw4_overall_score']} />
        </div>
      </Section>

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
          <DimTable r={r} dims={ATT_COMBINED_DIMS} overall={['season_att_overall_score', 'gw4_att_overall_score']} />
        </Section>
      )}
    </div>
  )
}

function DimTable({ r, dims, overall }: { r: RatingRow; dims: Dim[]; overall: [string, string] }) {
  // `overall` holds the two continuous *_score columns for the header row.
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line-mid text-[11px] tracking-[0.1em] text-ink-3 uppercase">
            <th className="px-4 py-3 text-left font-semibold">Dimension</th>
            <th className="px-4 py-3 text-left font-semibold">Season</th>
            <th className="px-4 py-3 text-left font-semibold">Last 4GW</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line">
            <td className="px-4 py-3 font-semibold text-ink">Overall</td>
            <td className="px-4 py-3"><StarRating value={num(r, overall[0])} /></td>
            <td className="px-4 py-3"><StarRating value={num(r, overall[1])} /></td>
          </tr>
          {dims.map(([label, sCol, gCol, tipKey]) => (
            <tr key={label} className="border-b border-line last:border-0">
              <td className="px-4 py-3">
                <span className="inline-flex items-center gap-1 text-ink-2">{label}{tipKey && metricTip(tipKey) && <InfoTip text={metricTip(tipKey)!} />}</span>
              </td>
              <td className="px-4 py-3"><StarRating value={str(r, sCol)} /></td>
              <td className="px-4 py-3"><StarRating value={str(r, gCol)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FormFixturesTab({ r, m, std, name, tierPerf }: { r: RatingRow; m: Row | null; std: Row | null; name: string; tierPerf: Row[] }) {
  void r
  const n2 = (v: number | null, f: 1 | 2 = 2) => (v != null ? <AnimatedCounter value={v} format={f === 1 ? '1dp' : '2dp'} /> : 'N/A')
  return (
    <div>
      <Section title="Per 90 Stats (Season)">
        <div className="grid grid-cols-2 gap-2">
          <Tile value={n2(std ? num(std, 'xg_per90_season') : null)} label="xG per 90" />
          <Tile value={n2(std ? num(std, 'xa_per90_season') : null)} label="xA per 90" />
        </div>
      </Section>
      <Section title="Finance Metrics (Last 4GW)">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile value={n2(m ? num(m, 'alpha_4gw') : null)} label={<>Alpha <InfoTip text={TOOLTIPS.alpha as string} /></>} />
          <Tile value={n2(m ? num(m, 'sharpe_4gw') : null)} label={<>Sharpe <InfoTip text={TOOLTIPS.sharpe as string} /></>} />
          <Tile value={n2(m ? num(m, 'sortino_4gw') : null)} label={<>Sortino <InfoTip text={TOOLTIPS.sortino as string} /></>} />
          <Tile value={n2(m ? num(m, 'consistency_4gw') : null)} label={<>Consistency <InfoTip text={TOOLTIPS.consistency as string} /></>} />
        </div>
      </Section>
      <Section title="Home vs Away (Season)">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Tile value={n2(m ? num(m, 'home_avg_season') : null, 1)} label="Home Avg Pts" />
          <Tile value={n2(m ? num(m, 'away_avg_season') : null, 1)} label="Away Avg Pts" />
          <Tile value={<span className="text-sm">{m ? str(m, 'form_direction') || '—' : '—'}</span>} label="Form Direction" />
        </div>
      </Section>
      <TierTable name={name} tierPerf={tierPerf} />
    </div>
  )
}

function TierTable({ name, tierPerf }: { name: string; tierPerf: Row[] }) {
  const rows = tierPerf.filter((t) => t.web_name === name)
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
