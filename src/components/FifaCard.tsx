import type { ReactNode } from 'react'
import { PlayerPhoto } from './PlayerPhoto'
import { TeamBadge } from './badges'
import { Icon } from './Icon'
import { num } from '../lib/rows'
import { teamFullNames } from '../lib/util'
import type { RatingRow } from '../lib/types'

// FIFA-ultimate-team-style player card. Big overall + position + photo + team,
// and six position-appropriate sub-ratings drawn from our rating engine.
// `compact` shrinks everything so a full XI of cards fits in a formation grid.

const POS_SHORT: Record<string, string> = { GKP: 'GK', DEF: 'DEF', MID: 'MID', FWD: 'FWD' }

// key = ratings field; norm=true means it's a 0–5 field to scale ×20 → 0–100.
interface Stat { label: string; key: string; norm?: boolean }
const STAT_SETS: Record<string, Stat[]> = {
  GKP: [
    { label: 'Clean Sheet', key: 'season_cs_score' },
    { label: 'Shot Stop', key: 'season_save_score' },
    { label: 'Bonus', key: 'season_bps_score' },
    { label: 'Reliability', key: 'season_reliability_score_norm', norm: true },
    { label: 'Value', key: 'season_value_score_norm', norm: true },
    { label: 'Form', key: 'gw4_overall_score', norm: true },
  ],
  DEF: [
    { label: 'Clean Sheet', key: 'season_cs_score' },
    { label: 'Def Con', key: 'season_dc_score' },
    { label: 'Attack', key: 'season_attacking_score' },
    { label: 'Reliability', key: 'season_reliability_score_norm', norm: true },
    { label: 'Value', key: 'season_value_score_norm', norm: true },
    { label: 'Form', key: 'gw4_overall_score', norm: true },
  ],
  MID: [
    { label: 'Goal Threat', key: 'season_goal_score' },
    { label: 'Creator', key: 'season_creative_score' },
    { label: 'Def Con', key: 'season_dc_score' },
    { label: 'Reliability', key: 'season_reliability_score_norm', norm: true },
    { label: 'Value', key: 'season_value_score_norm', norm: true },
    { label: 'Form', key: 'gw4_overall_score', norm: true },
  ],
  FWD: [
    { label: 'Goal Threat', key: 'season_goal_score' },
    { label: 'Creator', key: 'season_creative_score' },
    { label: 'Def Con', key: 'season_dc_score' },
    { label: 'Reliability', key: 'season_reliability_score_norm', norm: true },
    { label: 'Value', key: 'season_value_score_norm', norm: true },
    { label: 'Form', key: 'gw4_overall_score', norm: true },
  ],
}

/** A rating field coerced to a 0–100 integer (or null when absent). */
function stat100(r: RatingRow, s: Stat): number | null {
  const v = num(r, s.key)
  if (v == null) return null
  return Math.round(s.norm ? v * 20 : v)
}
export function overall100(r: RatingRow): number | null {
  const v = num(r, 'season_overall_score') // 0–5
  return v == null ? null : Math.round(v * 20)
}

// Diagonal-stripe photo panel background — the FIFA "chrome".
const PANEL_BG =
  'repeating-linear-gradient(115deg, rgba(255,255,255,0.03) 0 10px, rgba(255,255,255,0) 10px 20px)'

function StatBar({ label, value, compact }: { label: string; value: number | null; compact?: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-1">
        <span className={`font-semibold tracking-[0.08em] text-ink-2 uppercase ${compact ? 'text-[9px]' : 'text-[11px] tracking-[0.12em]'}`}>{label}</span>
        <span className={`font-display leading-none text-accent tabular-nums ${compact ? 'text-[14px]' : 'text-[17px]'}`}>{value ?? '—'}</span>
      </div>
      <div className={`overflow-hidden rounded-full bg-white/10 ${compact ? 'mt-1 h-[3px]' : 'mt-1.5 h-[3px]'}`}>
        <div
          className="h-full rounded-full"
          style={{ width: `${value ?? 0}%`, background: 'linear-gradient(90deg, var(--accent-strong), var(--accent-2))' }}
        />
      </div>
    </div>
  )
}

/**
 * Full FIFA-style player card. `compact` fits it into a formation grid; `onClick`
 * makes the whole card a button (e.g. through to the detail page).
 */
export function FifaCard({
  r,
  badge,
  className,
  compact,
  onClick,
  captain,
  viceCaptain,
  streak,
}: {
  r: RatingRow
  badge?: ReactNode
  className?: string
  compact?: boolean
  onClick?: () => void
  captain?: boolean
  viceCaptain?: boolean
  streak?: string | null
}) {
  const ov = overall100(r)
  const stats = STAT_SETS[String(r.position)] ?? STAT_SETS.MID
  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag
      onClick={onClick}
      className={`group relative w-full overflow-hidden text-left ${compact ? 'rounded-2xl p-3' : 'rounded-[22px] p-5 shadow-modal'} ${onClick ? 'transition-transform hover:-translate-y-0.5' : ''} ${className ?? ''}`}
      style={{
        background: 'linear-gradient(165deg, #211d16 0%, #14110c 55%, #0d0b08 100%)',
        border: '1px solid rgba(217,180,92,0.28)',
      }}
    >
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: 'var(--grad-accent)' }} />
      {badge}
      {captain && <span className={`absolute z-10 grid place-items-center rounded-full bg-accent font-bold text-accent-contrast ${compact ? 'top-2 right-2 size-5 text-[10px]' : 'top-3 right-3 size-6 text-[11px]'}`}>C</span>}
      {viceCaptain && <span className={`absolute z-10 grid place-items-center rounded-full bg-surface-3 font-bold text-ink ${compact ? 'top-2 right-2 size-5 text-[10px]' : 'top-3 right-3 size-6 text-[11px]'}`}>V</span>}
      {!captain && !viceCaptain && streak === '🔥 Hot' && <span className={`absolute z-10 text-hot ${compact ? 'top-2 right-2' : 'top-3 right-3'}`}><Icon name="flame" size={compact ? 13 : 16} solid /></span>}
      {!captain && !viceCaptain && streak === '🧊 Cold' && <span className={`absolute z-10 text-cold ${compact ? 'top-2 right-2' : 'top-3 right-3'}`}><Icon name="snow" size={compact ? 13 : 16} /></span>}

      <div className={`flex ${compact ? 'gap-3' : 'gap-4'}`}>
        {/* overall + position */}
        <div className="flex shrink-0 flex-col items-center pt-1" style={{ minWidth: compact ? 52 : 76 }}>
          <div className={`font-display text-accent tabular-nums leading-[0.9] ${compact ? 'text-[40px]' : 'text-[58px]'}`}>{ov ?? '—'}</div>
          <div className={`font-display leading-none tracking-[0.06em] text-accent-2 ${compact ? 'text-[14px]' : 'text-[19px]'}`}>{POS_SHORT[String(r.position)] ?? r.position}</div>
          <div className={`mt-1 font-semibold tracking-[0.2em] text-ink-3 uppercase ${compact ? 'text-[8px]' : 'text-[10px]'}`}>Overall</div>
        </div>

        {/* photo panel */}
        <div className="relative flex-1 overflow-hidden rounded-2xl" style={{ background: '#191510', minHeight: compact ? 104 : 150 }}>
          <div className="absolute inset-0" style={{ background: PANEL_BG }} />
          <PlayerPhoto
            code={r.code}
            element={r.element}
            hero
            className={`absolute inset-x-0 bottom-0 mx-auto w-auto object-contain object-bottom drop-shadow-[0_6px_16px_rgba(0,0,0,0.55)] ${compact ? 'h-[104px]' : 'h-[150px]'}`}
            placeholder={
              <div className={`grid w-full place-items-center text-ink-3 ${compact ? 'h-[104px]' : 'h-[150px]'}`}>
                <Icon name="users" size={compact ? 24 : 34} />
              </div>
            }
          />
          <div className={compact ? 'absolute top-1.5 right-1.5' : 'absolute top-2.5 right-2.5'}>
            <TeamBadge team={String(r.team)} size={compact ? 18 : 26} />
          </div>
        </div>
      </div>

      {/* name + team */}
      <div className={compact ? 'mt-2.5' : 'mt-4'}>
        <div className={`font-display leading-none tracking-[0.01em] text-ink uppercase ${compact ? 'truncate text-[17px]' : 'text-[26px]'}`}>{String(r.web_name)}</div>
        <div className={`mt-1.5 flex items-center gap-1.5 font-semibold text-accent-2 ${compact ? 'text-[11px]' : 'text-[14px]'}`}>
          <TeamBadge team={String(r.team)} size={compact ? 12 : 15} />
          <span className="truncate">{teamFullNames[String(r.team)] || r.team}</span>
          <span className="shrink-0 text-ink-3">· £{r.price}m</span>
        </div>
      </div>

      <div className={`h-px ${compact ? 'my-2.5' : 'my-4'}`} style={{ background: 'linear-gradient(90deg, transparent, rgba(217,180,92,0.35), transparent)' }} />

      {/* six sub-ratings */}
      <div className={`grid grid-cols-2 ${compact ? 'gap-x-3 gap-y-2' : 'gap-x-6 gap-y-3.5'}`}>
        {stats.map((s) => (
          <StatBar key={s.label} label={s.label} value={stat100(r, s)} compact={compact} />
        ))}
      </div>
    </Tag>
  )
}
