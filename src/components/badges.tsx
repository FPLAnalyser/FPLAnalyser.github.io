import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { teamBadgeUrls } from '../lib/util'

/** Small inline team badge that hides itself if the image fails to load.
 *
 *  Walks the candidate list — our own mirror, then the Premier League's CDN —
 *  and gives up only when every one 404s. The mirror comes first because it is
 *  same-origin, and a canvas will only read back a same-origin image: served
 *  from the CDN the crest is on the page but absent from every share image the
 *  site produces.
 *
 *  An earlier attempt asked the CDN for the crest with `crossOrigin` set. That
 *  only works if the host sends the headers, which is not this site's call to
 *  make, and it fails in a way nobody can see — the badge looks perfect on
 *  screen and vanishes from the picture. */
export function TeamBadge({ team, size = 14, className, fallback }: {
  team: string
  size?: number
  className?: string
  /** Shown when the crest cannot load. A blocked request, an offline reader or
   *  a club we have no code for all end up here. Without it the badge simply
   *  vanishes, which is fine beside a club name and not fine where the badge
   *  IS the label. */
  fallback?: ReactNode
}) {
  const urls = teamBadgeUrls(team)
  const [idx, setIdx] = useState(0)
  const prev = useRef(team)
  useEffect(() => {
    if (prev.current !== team) { prev.current = team; setIdx(0) }
  }, [team])
  if (idx >= urls.length) return <>{fallback ?? null}</>
  return (
    <img
      loading="lazy"
      src={urls[idx]}
      alt=""
      className={className}
      style={{ width: size, height: size, objectFit: 'contain' }}
      onError={() => setIdx((i) => i + 1)}
    />
  )
}

const POS_ICON: Record<string, IconName> = { GKP: 'hand', DEF: 'shield', MID: 'bolt', FWD: 'ball' }

export function PositionIcon({ pos, size = 13 }: { pos: string; size?: number }) {
  return <Icon name={POS_ICON[pos] || 'users'} size={size} />
}
