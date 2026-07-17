import { useNavigate } from 'react-router-dom'
import { TeamBadge } from './badges'

/** Clickable player name → navigates to the Players page for that player. */
export function PlayerNameCell({ name }: { name: string }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="text-left font-medium text-ink transition-colors hover:text-brand"
      onClick={(e) => {
        e.stopPropagation()
        navigate(`/player?name=${encodeURIComponent(name)}`)
      }}
    >
      {name}
    </button>
  )
}

export function PosBadge({ pos }: { pos: string }) {
  return (
    <span className="inline-block rounded bg-surface-3 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-ink-2">
      {pos}
    </span>
  )
}

export function TeamCell({ team }: { team: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-2">
      <TeamBadge team={team} size={14} />
      {team}
    </span>
  )
}
