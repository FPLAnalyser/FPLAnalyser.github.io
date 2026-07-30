import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { teamBadgeUrl } from '../lib/util'

/** Small inline team badge that hides itself if the image fails to load.
 *
 *  Asked for with CORS, for the same reason PlayerPhoto is: a cross-origin
 *  image can only be read back off a canvas if its response carried the
 *  headers, and a share image that can't read it draws nothing. Every crest
 *  was missing from every export because of this — a shared fixture card had
 *  two three-letter codes and no clubs. If the host turns out not to send the
 *  headers, the plain request still puts the badge on the page. */
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
  const [plain, setPlain] = useState(false)
  const url = teamBadgeUrl(team)
  const prev = useRef(url)
  useEffect(() => {
    if (prev.current !== url) { prev.current = url; setFailed(false); setPlain(false) }
  }, [url])
  if (!url || failed) return <>{fallback ?? null}</>
  return (
    <img
      key={plain ? 'plain' : 'cors'}
      loading="lazy"
      src={url}
      alt=""
      crossOrigin={plain ? undefined : 'anonymous'}
      className={className}
      style={{ width: size, height: size, objectFit: 'contain' }}
      // A CORS failure says nothing about whether the crest exists, so try the
      // same URL plainly before giving up on it.
      onError={() => (plain ? setFailed(true) : setPlain(true))}
    />
  )
}

const POS_ICON: Record<string, IconName> = { GKP: 'hand', DEF: 'shield', MID: 'bolt', FWD: 'ball' }

export function PositionIcon({ pos, size = 13 }: { pos: string; size?: number }) {
  return <Icon name={POS_ICON[pos] || 'users'} size={size} />
}
