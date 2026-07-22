import type { ReactNode } from 'react'
import { PlayerPhoto } from './PlayerPhoto'
import { TeamBadge } from './badges'
import { Icon } from './Icon'
import { num } from '../lib/rows'
import { teamFullNames } from '../lib/util'
import type { RatingRow } from '../lib/types'

// FIFA-ultimate-team-style player card. Big overall + position + photo + team,
// and six position-appropriate sub-ratings drawn from our rating engine. Two
// exports: <FifaCard> (full, for a tap-through / modal) and <MiniFifaCard>
// (compact pitch token).

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

function StatBar({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold tracking-[0.12em] text-ink-2 uppercase">{label}</span>
        <span className="font-display text-[17px] leading-none text-accent tabular-nums">{value ?? '—'}</span>
      </div>
      <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full"
          style={{ width: `${value ?? 0}%`, background: 'linear-gradient(90deg, var(--accent-strong), var(--accent-2))' }}
        />
      </div>
    </div>
  )
}

/**
 * Full FIFA-style card. `badge` slot lets callers overlay captaincy etc.
 */
export function FifaCard({ r, badge, className }: { r: RatingRow; badge?: ReactNode; className?: string }) {
  const ov = overall100(r)
  const stats = STAT_SETS[String(r.position)] ?? STAT_SETS.MID

  return (
    <div
      className={`relative w-full overflow-hidden rounded-[22px] p-5 shadow-modal ${className ?? ''}`}
      style={{
        background: 'linear-gradient(165deg, #211d16 0%, #14110c 55%, #0d0b08 100%)',
        border: '1px solid rgba(217,180,92,0.28)',
      }}
    >
      {/* gold top edge */}
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: 'var(--grad-accent)' }} />
      {badge}

      <div className="flex gap-4">
        {/* overall + position */}
        <div className="flex shrink-0 flex-col items-center pt-1" style={{ minWidth: 76 }}>
          <div className="font-display text-[58px] leading-[0.9] text-accent tabular-nums">{ov ?? '—'}</div>
          <div className="font-display text-[19px] leading-none tracking-[0.06em] text-accent-2">{POS_SHORT[String(r.position)] ?? r.position}</div>
          <div className="mt-1 text-[10px] font-semibold tracking-[0.2em] text-ink-3 uppercase">Overall</div>
        </div>

        {/* photo panel */}
        <div className="relative flex-1 overflow-hidden rounded-2xl" style={{ background: '#191510', minHeight: 150 }}>
          <div className="absolute inset-0" style={{ background: PANEL_BG }} />
          <PlayerPhoto
            code={r.code}
            element={r.element}
            hero
            className="absolute inset-x-0 bottom-0 mx-auto h-[150px] w-auto object-contain object-bottom drop-shadow-[0_6px_16px_rgba(0,0,0,0.55)]"
            placeholder={
              <div className="grid h-[150px] w-full place-items-center text-ink-3">
                <Icon name="users" size={34} />
              </div>
            }
          />
          <div className="absolute top-2.5 right-2.5">
            <TeamBadge team={String(r.team)} size={26} />
          </div>
        </div>
      </div>

      {/* name + team */}
      <div className="mt-4">
        <div className="font-display text-[26px] leading-none tracking-[0.01em] text-ink uppercase">{String(r.web_name)}</div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[14px] font-semibold text-accent-2">
          <TeamBadge team={String(r.team)} size={15} />
          {teamFullNames[String(r.team)] || r.team}
          <span className="text-ink-3">· £{r.price}m</span>
        </div>
      </div>

      <div className="my-4 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(217,180,92,0.35), transparent)' }} />

      {/* six sub-ratings */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3.5">
        {stats.map((s) => (
          <StatBar key={s.label} label={s.label} value={stat100(r, s)} />
        ))}
      </div>
    </div>
  )
}

/**
 * Compact pitch token — a mini FIFA card. Gold overall + position, photo,
 * name and team badge. Click bubbles up via `onClick`.
 */
export function MiniFifaCard({
  r,
  onClick,
  captain,
  viceCaptain,
  streak,
  bench,
}: {
  r: RatingRow
  onClick?: () => void
  captain?: boolean
  viceCaptain?: boolean
  streak?: string | null
  bench?: boolean
}) {
  const ov = overall100(r)
  return (
    <button
      onClick={onClick}
      className={`group relative min-w-0 flex-1 basis-0 overflow-hidden rounded-xl p-1.5 text-center transition-transform hover:-translate-y-0.5 md:p-2 ${
        bench ? 'opacity-95' : ''
      }`}
      style={{
        maxWidth: 112,
        background: 'linear-gradient(165deg, #221e17 0%, #14110c 60%, #100d09 100%)',
        border: '1px solid rgba(217,180,92,0.22)',
        boxShadow: '0 6px 16px rgba(0,0,0,0.35)',
      }}
      title={`${r.web_name} · ${r.position} · ${teamFullNames[String(r.team)] || r.team} · £${r.price}m`}
    >
      <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: 'var(--grad-accent)' }} />
      {/* overall + pos, top-left */}
      <div className="absolute top-1 left-1.5 z-10 flex flex-col items-center leading-none">
        <span className="font-display text-[17px] text-accent tabular-nums">{ov ?? '—'}</span>
        <span className="font-display text-[8px] tracking-[0.06em] text-accent-2">{POS_SHORT[String(r.position)] ?? r.position}</span>
      </div>
      {captain && <span className="absolute top-1 right-1 z-10 grid size-4 place-items-center rounded-full bg-accent text-[9px] font-bold text-accent-contrast">C</span>}
      {viceCaptain && <span className="absolute top-1 right-1 z-10 grid size-4 place-items-center rounded-full bg-surface-3 text-[9px] font-bold text-ink">V</span>}
      {!captain && !viceCaptain && streak === '🔥 Hot' && <span className="absolute top-1 right-1 z-10 text-hot"><Icon name="flame" size={11} solid /></span>}
      {!captain && !viceCaptain && streak === '🧊 Cold' && <span className="absolute top-1 right-1 z-10 text-cold"><Icon name="snow" size={11} /></span>}

      <PlayerPhoto
        code={r.code}
        element={r.element}
        hero
        className="mx-auto h-14 w-auto object-contain object-bottom"
        placeholder={<div className="mx-auto grid h-14 w-10 place-items-center text-ink-3"><Icon name="users" size={16} /></div>}
      />
      <div className="mt-0.5 truncate text-[11px] font-semibold text-ink">{String(r.web_name)}</div>
      <div className="mt-0.5 flex items-center justify-center gap-1 text-[9px] text-ink-2">
        <TeamBadge team={String(r.team)} size={11} />
        £{r.price}m
      </div>
    </button>
  )
}
