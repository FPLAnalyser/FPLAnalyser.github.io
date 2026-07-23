import { TeamBadge } from './badges'
import { FixtureChips } from './FixtureChips'
import { num } from '../lib/rows'
import { teamLabel, ordinal } from '../lib/util'
import type { FixtureEaseRow, TeamRatingRow } from '../lib/types'

// Club rating card built from our own Attack / Defence team ratings — the
// same visual language as the player cards, applied to the 20 clubs.

function StatBlock({ v, rank, label }: { v: number | null; rank: number | null; label: string }) {
  return (
    <div className="flex-1 rounded-xl border border-white/8 py-2.5 text-center">
      <div className="font-display text-[30px] leading-none text-accent tabular-nums">{v ?? '—'}</div>
      <div className="mt-1 text-[10px] font-semibold tracking-[0.1em] text-ink-2 uppercase">{label}</div>
      {rank != null && <div className="text-[9px] text-ink-3">{ordinal(rank)}</div>}
    </div>
  )
}

export function ClubCard({
  team,
  season,
  gw4,
  fixtureEase,
  onClick,
}: {
  team: string
  season?: TeamRatingRow
  gw4?: TeamRatingRow
  fixtureEase?: FixtureEaseRow[]
  onClick?: () => void
}) {
  const att = season ? Math.round(num(season, 'attack') ?? 0) : null
  const def = season ? Math.round(num(season, 'defence') ?? 0) : null
  const form = gw4 && num(gw4, 'attack') != null && num(gw4, 'defence') != null
    ? Math.round(((num(gw4, 'attack') ?? 0) + (num(gw4, 'defence') ?? 0)) / 2)
    : null
  const setPiece = season ? Boolean(season.set_piece_threat) : false
  const hasFix = (fixtureEase ?? []).some((f) => f.team === team)
  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag
      onClick={onClick}
      className={`group relative w-full overflow-hidden rounded-2xl p-4 text-left ${onClick ? 'transition-transform hover:-translate-y-0.5' : ''}`}
      style={{ background: 'linear-gradient(165deg,#211d16,#0d0b08)', border: '1px solid rgba(217,180,92,0.3)' }}
    >
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: 'linear-gradient(135deg,#e7c877,#b98f3f)' }} />
      <div className="flex items-center gap-3">
        <TeamBadge team={team} size={40} />
        <div className="min-w-0">
          <div className="truncate font-display text-[19px] leading-none text-ink uppercase">{teamLabel(team)}</div>
          <div className="mt-1 text-[10px] font-semibold tracking-[0.1em] text-ink-3 uppercase">Premier League</div>
        </div>
      </div>

      <div className="mt-4 flex gap-2.5">
        <StatBlock v={att} rank={season ? num(season, 'attack_rank') : null} label="Attack" />
        <StatBlock v={def} rank={season ? num(season, 'defence_rank') : null} label="Defence" />
      </div>

      <div className="mt-3.5 flex flex-col gap-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-semibold tracking-[0.08em] text-ink-2 uppercase">Set-piece threat</span>
          <span className="font-display text-sm" style={{ color: setPiece ? 'var(--accent)' : 'var(--ink-3)' }}>{setPiece ? 'High' : 'Low'}</span>
        </div>
        {form != null && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold tracking-[0.08em] text-ink-2 uppercase">Form · last 4</span>
            <span className="font-display text-sm text-accent tabular-nums">{form}</span>
          </div>
        )}
        {hasFix && (
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="shrink-0 font-semibold tracking-[0.08em] text-ink-2 uppercase">Next</span>
            <FixtureChips fixtureEase={fixtureEase ?? []} team={team} n={4} />
          </div>
        )}
      </div>
    </Tag>
  )
}

/** Projected xG for the two sides of a fixture, from our attack/defence ratings.
 *  Renders nothing until a next fixture is known for the team. */
export function TeamMatchup({
  team,
  ratingByTeam,
  fixtureEase,
}: {
  team: string
  ratingByTeam: Map<string, TeamRatingRow>
  fixtureEase: FixtureEaseRow[]
}) {
  const next = (fixtureEase || []).filter((f) => f.team === team).sort((a, b) => a.gw - b.gw)[0]
  if (!next) return null
  const opp = next.opponent
  const a = ratingByTeam.get(team)
  const b = ratingByTeam.get(opp)
  if (!a || !b) return null

  // Simple model: league-average xG (~1.45) scaled by attack vs opponent defence
  // (ratings are 0–100, 50 = average) with a small home bump.
  const BASE = 1.45
  const proj = (attk?: TeamRatingRow, defd?: TeamRatingRow, home?: boolean) => {
    const at = num(attk ?? {}, 'attack') ?? 50
    const df = num(defd ?? {}, 'defence') ?? 50
    const x = BASE * (0.5 + at / 100) * (1.5 - df / 100) * (home ? 1.1 : 0.92)
    return Math.max(0.2, x)
  }
  const home = next.venue === 'H'
  const xgFor = proj(a, b, home)
  const xgAgainst = proj(b, a, !home)
  const csPct = Math.round(Math.exp(-xgAgainst) * 100)

  return (
    <div className="rounded-2xl border border-line bg-surface-1/60 p-4 md:p-5">
      <div className="mb-4 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Gameweek {next.gw} · Matchup</div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 flex-col items-center gap-1.5 text-center">
          <TeamBadge team={team} size={34} />
          <div className="text-sm font-semibold text-ink">{teamLabel(team)}</div>
        </div>
        <div className="text-center">
          <div className="font-display text-[30px] leading-none text-accent tabular-nums">{xgFor.toFixed(1)}</div>
          <div className="text-[9px] tracking-[0.12em] text-ink-3 uppercase">proj xG</div>
        </div>
        <div className="text-center text-ink-3">
          <div className="font-display text-[30px] leading-none tabular-nums text-ink-2">{xgAgainst.toFixed(1)}</div>
          <div className="text-[9px] tracking-[0.12em] text-ink-3 uppercase">proj xG</div>
        </div>
        <div className="flex flex-1 flex-col items-center gap-1.5 text-center">
          <TeamBadge team={opp} size={34} />
          <div className="text-sm font-semibold text-ink">{teamLabel(opp)}</div>
        </div>
      </div>
      <div className="mt-3 text-center text-xs text-ink-2">
        <span className="rounded-full bg-good/12 px-2.5 py-1 font-semibold text-good">{teamLabel(team)} clean sheet {csPct}%</span>
      </div>
    </div>
  )
}
