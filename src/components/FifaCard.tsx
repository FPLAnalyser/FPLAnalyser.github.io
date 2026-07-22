import { PlayerPhoto } from './PlayerPhoto'
import { TeamBadge } from './badges'
import { FixtureChips } from './FixtureChips'
import { Icon } from './Icon'
import { num } from '../lib/rows'
import { teamFullNames } from '../lib/util'
import type { FixtureEaseRow, RatingRow } from '../lib/types'

// FIFA-ultimate-team-style player card. Big overall + position + photo + team,
// six position-appropriate sub-ratings, next-four fixtures, and a rarity frame
// driven by the overall (bronze→silver→gold→elite) with a distinct differential
// treatment for low-owned gems. `window` switches every rating between season
// and the last-4-gameweek snapshot. `compact` fits a full XI into a grid.

export type RatingWindow = 'season' | 'gw4'
const POS_SHORT: Record<string, string> = { GKP: 'GK', DEF: 'DEF', MID: 'MID', FWD: 'FWD' }

// ── Rarity frames ────────────────────────────────────────────────────────────
type Tier = 'bronze' | 'silver' | 'gold' | 'elite' | 'diff'
function tierOf(ov: number | null, ownership: number | null): Tier {
  if (ownership != null && ownership < 7 && ov != null && ov >= 65 && ov < 90) return 'diff'
  if (ov == null) return 'gold'
  if (ov >= 90) return 'elite'
  if (ov >= 80) return 'gold'
  if (ov >= 60) return 'silver'
  return 'bronze'
}
interface TierStyle { bg: string; border: string; edge: string; a: string; a2: string; as: string; glow?: string }
const TIER: Record<Tier, TierStyle> = {
  bronze: { bg: 'linear-gradient(165deg,#241a12,#160f0a)', border: 'rgba(176,124,74,.45)', edge: 'linear-gradient(135deg,#c8965a,#7a5230)', a: '#d69b63', a2: '#e0b385', as: '#8a5f34' },
  silver: { bg: 'linear-gradient(165deg,#20232a,#121317)', border: 'rgba(185,194,207,.45)', edge: 'linear-gradient(135deg,#dce3ec,#8b96a6)', a: '#ccd5e1', a2: '#e6ecf3', as: '#8b96a6' },
  gold: { bg: 'linear-gradient(165deg,#211d16,#0d0b08)', border: 'rgba(217,180,92,.5)', edge: 'linear-gradient(135deg,#e7c877,#b98f3f)', a: '#e6c36a', a2: '#e7c877', as: '#b98f3f' },
  elite: { bg: 'linear-gradient(165deg,#2a2212,#171208)', border: 'rgba(231,200,119,.85)', edge: 'linear-gradient(135deg,#fff6d8,#e7c877,#b98f3f)', a: '#ffe9a8', a2: '#ffe08a', as: '#c79a45', glow: '0 0 0 1px rgba(231,200,119,.22), 0 16px 46px rgba(231,200,119,.16)' },
  diff: { bg: 'linear-gradient(165deg,#122223,#0a1415)', border: 'rgba(90,200,190,.5)', edge: 'linear-gradient(135deg,#6fe3d2,#2c8f86)', a: '#7fe7d6', a2: '#a6f0e6', as: '#2c8f86' },
}

// suffix = field name without the season_/gw4_ window prefix.
interface Stat { label: string; suffix: string; norm?: boolean }
const CORE: Record<string, Stat[]> = {
  GKP: [
    { label: 'Clean Sheet', suffix: 'cs_score' },
    { label: 'Shot Stop', suffix: 'save_score' },
    { label: 'Bonus', suffix: 'bps_score' },
    { label: 'Reliability', suffix: 'reliability_score_norm', norm: true },
    { label: 'Value', suffix: 'value_score_norm', norm: true },
  ],
  DEF: [
    { label: 'Clean Sheet', suffix: 'cs_score' },
    { label: 'Def Con', suffix: 'dc_score' },
    { label: 'Attack', suffix: 'attacking_score' },
    { label: 'Reliability', suffix: 'reliability_score_norm', norm: true },
    { label: 'Value', suffix: 'value_score_norm', norm: true },
  ],
  MID: [
    { label: 'Goal Threat', suffix: 'goal_score' },
    { label: 'Creator', suffix: 'creative_score' },
    { label: 'Def Con', suffix: 'dc_score' },
    { label: 'Reliability', suffix: 'reliability_score_norm', norm: true },
    { label: 'Value', suffix: 'value_score_norm', norm: true },
  ],
  FWD: [
    { label: 'Goal Threat', suffix: 'goal_score' },
    { label: 'Creator', suffix: 'creative_score' },
    { label: 'Def Con', suffix: 'dc_score' },
    { label: 'Reliability', suffix: 'reliability_score_norm', norm: true },
    { label: 'Value', suffix: 'value_score_norm', norm: true },
  ],
}

function field100(r: RatingRow, prefix: string, s: Stat): number | null {
  const v = num(r, `${prefix}_${s.suffix}`)
  if (v == null) return null
  return Math.round(s.norm ? v * 20 : v)
}
function overallOf(r: RatingRow, prefix: string): number | null {
  const v = num(r, `${prefix}_overall_score`) // 0–5
  return v == null ? null : Math.round(v * 20)
}
export function overall100(r: RatingRow): number | null {
  return overallOf(r, 'season')
}

/** Next-4 fixtures + a 0–100 ease rating from average FDR (100 = easiest run). */
function fixtureSummary(fixtureEase: FixtureEaseRow[] | undefined, team: string) {
  const up = (fixtureEase || []).filter((f) => f.team === team).sort((a, b) => a.gw - b.gw).slice(0, 4)
  if (!up.length) return null
  const avgFdr = up.reduce((s, f) => s + (f.fdr || 3), 0) / up.length
  return { rating: Math.round(((5 - avgFdr) / 4) * 100) }
}

const PANEL_BG = 'repeating-linear-gradient(115deg, rgba(255,255,255,0.03) 0 10px, rgba(255,255,255,0) 10px 20px)'

function StatBar({ label, value, compact }: { label: string; value: number | null; compact?: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-1">
        <span className={`font-semibold text-ink-2 uppercase ${compact ? 'text-[9px] tracking-[0.06em]' : 'text-[11px] tracking-[0.12em]'}`}>{label}</span>
        <span className={`font-display leading-none text-accent tabular-nums ${compact ? 'text-[14px]' : 'text-[17px]'}`}>{value ?? '—'}</span>
      </div>
      <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${value ?? 0}%`, background: 'linear-gradient(90deg, var(--accent-strong), var(--accent-2))' }} />
      </div>
    </div>
  )
}

export function FifaCard({
  r,
  className,
  compact,
  onClick,
  captain,
  viceCaptain,
  streak,
  window = 'season',
  fixtureEase,
}: {
  r: RatingRow
  className?: string
  compact?: boolean
  onClick?: () => void
  captain?: boolean
  viceCaptain?: boolean
  streak?: string | null
  window?: RatingWindow
  fixtureEase?: FixtureEaseRow[]
}) {
  const prefix = window === 'gw4' ? 'gw4' : 'season'
  const ov = overallOf(r, prefix)
  const ownership = num(r, 'selected_by_percent')
  const tier = tierOf(ov, ownership)
  const T = TIER[tier]
  const core = CORE[String(r.position)] ?? CORE.MID
  const contrast =
    window === 'gw4'
      ? { label: 'Season', value: overallOf(r, 'season') }
      : { label: 'Form', value: overallOf(r, 'gw4') }
  const stats = [...core.map((s) => ({ label: s.label, value: field100(r, prefix, s) })), contrast]
  const fix = fixtureSummary(fixtureEase, String(r.team))
  const mins = num(r, 'total_mins')
  const thinSample = mins != null && mins < 1200
  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag
      onClick={onClick}
      className={`group relative w-full overflow-hidden text-left ${compact ? 'rounded-2xl p-3' : 'rounded-[22px] p-5'} ${onClick ? 'transition-transform hover:-translate-y-0.5' : ''} ${className ?? ''}`}
      style={{
        background: T.bg,
        border: `1px solid ${T.border}`,
        boxShadow: T.glow,
        // Retint every gold element to the tier accent.
        ['--accent' as string]: T.a,
        ['--accent-2' as string]: T.a2,
        ['--accent-strong' as string]: T.as,
      }}
    >
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: T.edge }} />
      {tier === 'elite' && (
        <div className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ background: 'conic-gradient(from 0deg,#e7c877,#fff6d8,#b98f3f,#e7c877,#fff6d8,#b98f3f,#e7c877)' }} />
      )}
      {captain && <span className={`absolute z-10 grid place-items-center rounded-full bg-accent font-bold text-accent-contrast ${compact ? 'top-2 right-2 size-5 text-[10px]' : 'top-3 right-3 size-6 text-[11px]'}`}>C</span>}
      {viceCaptain && <span className={`absolute z-10 grid place-items-center rounded-full bg-surface-3 font-bold text-ink ${compact ? 'top-2 right-2 size-5 text-[10px]' : 'top-3 right-3 size-6 text-[11px]'}`}>V</span>}

      <div className={`relative flex ${compact ? 'gap-3' : 'gap-4'}`}>
        {/* overall + position */}
        <div className="flex shrink-0 flex-col items-center pt-1" style={{ minWidth: compact ? 52 : 76 }}>
          <div className={`font-display text-accent tabular-nums leading-[0.9] ${compact ? 'text-[40px]' : 'text-[58px]'}`}>{ov ?? '—'}</div>
          <div className={`font-display leading-none tracking-[0.06em] text-accent-2 ${compact ? 'text-[14px]' : 'text-[19px]'}`}>{POS_SHORT[String(r.position)] ?? r.position}</div>
          <div className={`mt-1 font-semibold tracking-[0.2em] text-ink-3 uppercase ${compact ? 'text-[8px]' : 'text-[10px]'}`}>{window === 'gw4' ? 'Last 4' : 'Overall'}</div>
          {thinSample && (
            <span className="mt-1 inline-block size-[7px] rounded-full bg-warn" title={mins != null ? `Thin sample — ${Math.round(mins)} mins played` : 'Thin sample'} />
          )}
        </div>

        {/* photo panel */}
        <div className="relative flex-1 overflow-hidden rounded-2xl" style={{ background: 'rgba(0,0,0,0.28)', minHeight: compact ? 104 : 150 }}>
          <div className="absolute inset-0" style={{ background: PANEL_BG }} />
          <PlayerPhoto
            code={r.code}
            element={r.element}
            hero
            className={`absolute inset-x-0 bottom-0 mx-auto w-auto object-contain object-bottom drop-shadow-[0_6px_16px_rgba(0,0,0,0.55)] ${compact ? 'h-[104px]' : 'h-[150px]'}`}
            placeholder={<div className={`grid w-full place-items-center text-ink-3 ${compact ? 'h-[104px]' : 'h-[150px]'}`}><Icon name="users" size={compact ? 24 : 34} /></div>}
          />
        </div>
      </div>

      {/* name (+ streak / gem) + team */}
      <div className={`relative ${compact ? 'mt-2.5' : 'mt-4'}`}>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`min-w-0 truncate font-display leading-none tracking-[0.01em] text-ink uppercase ${compact ? 'text-[17px]' : 'text-[26px]'}`}>{String(r.web_name)}</span>
          {streak === '🔥 Hot' && <span className="shrink-0 text-hot" title="Hot streak"><Icon name="flame" size={compact ? 13 : 16} solid /></span>}
          {streak === '🧊 Cold' && <span className="shrink-0 text-cold" title="Cold streak"><Icon name="snow" size={compact ? 13 : 16} /></span>}
          {tier === 'diff' && ownership != null && (
            <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-bold tracking-[0.08em] uppercase" style={{ background: 'rgba(127,231,214,.16)', color: '#7fe7d6' }} title="Low-owned differential">Gem · {ownership.toFixed(0)}%</span>
          )}
        </div>
        <div className={`mt-1.5 flex items-center gap-1.5 font-semibold text-accent-2 ${compact ? 'text-[11px]' : 'text-[14px]'}`}>
          <TeamBadge team={String(r.team)} size={compact ? 12 : 15} />
          <span className="truncate">{teamFullNames[String(r.team)] || r.team}</span>
          <span className="shrink-0 text-ink-3">· £{r.price}m</span>
        </div>
      </div>

      <div className={`relative h-px ${compact ? 'my-2.5' : 'my-4'}`} style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.14), transparent)' }} />

      {/* six sub-ratings */}
      <div className={`relative grid grid-cols-2 ${compact ? 'gap-x-3 gap-y-2' : 'gap-x-6 gap-y-3.5'}`}>
        {stats.map((s) => (
          <StatBar key={s.label} label={s.label} value={s.value} compact={compact} />
        ))}
      </div>

      {/* next-4 fixtures (renders only when upcoming fixtures are known) */}
      {fix && (
        <>
          <div className={`relative h-px ${compact ? 'my-2.5' : 'my-4'}`} style={{ background: 'rgba(255,255,255,0.08)' }} />
          <div className="relative flex items-center justify-between gap-2">
            <span className={`shrink-0 font-semibold tracking-[0.08em] text-ink-3 uppercase ${compact ? 'text-[8px]' : 'text-[10px]'}`}>Next 4</span>
            <span className="min-w-0">
              <FixtureChips fixtureEase={fixtureEase!} team={String(r.team)} n={4} />
            </span>
            <span className={`shrink-0 font-display text-accent tabular-nums ${compact ? 'text-[14px]' : 'text-[17px]'}`} title="Fixture ease over the next 4 (100 = easiest)">{fix.rating}</span>
          </div>
        </>
      )}
    </Tag>
  )
}
