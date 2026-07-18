import { useState } from 'react'
import { Icon, type IconName } from './Icon'
import { teamBadgeUrl } from '../lib/util'

/** Small inline team badge that hides itself if the image fails to load. */
export function TeamBadge({ team, size = 14, className }: { team: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  const url = teamBadgeUrl(team)
  if (!url || failed) return null
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
