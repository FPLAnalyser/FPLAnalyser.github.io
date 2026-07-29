import { useState, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { teamBadgeUrl } from '../lib/util'

/** Small inline team badge that hides itself if the image fails to load. */
export function TeamBadge({ team, size = 14, className, fallback }: {
  team: string
  size?: number
  className?: string
  /** Shown when the crest cannot load. Crests come from the Premier League's
   *  image servers, so a blocked request, an offline reader or a club we have
   *  no code for all end up here. Without it the badge simply vanishes, which
   *  is fine beside a club name and not fine where the badge IS the label. */
  fallback?: ReactNode
}) {
  const [failed, setFailed] = useState(false)
  const url = teamBadgeUrl(team)
  if (!url || failed) return <>{fallback ?? null}</>
  return (
    <img
      loading="lazy"
      src={url}
      alt=""
      className={className}
      style={{ width: size, height: size, objectFit: 'contain' }}
      onError={() => setFailed(true)}
    />
  )
}

const POS_ICON: Record<string, IconName> = { GKP: 'hand', DEF: 'shield', MID: 'bolt', FWD: 'ball' }

export function PositionIcon({ pos, size = 13 }: { pos: string; size?: number }) {
  return <Icon name={POS_ICON[pos] || 'users'} size={size} />
}
