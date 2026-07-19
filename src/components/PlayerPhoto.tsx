import { useState, type CSSProperties, type ReactNode } from 'react'

// Try the size the official FPL app uses first (most complete, incl. newly
// promoted clubs like Sunderland), then the legacy size, then a placeholder.
// Both are attempted so we get the union of whatever the CDN has for a player.
const PHOTO_SIZES = ['250x250', '110x140'] as const

/**
 * Premier League player headshot with a size-fallback chain. `placeholder` is
 * rendered when there's no code or every size 404s, so callers keep full
 * control of the empty state (icon, blank box, etc.).
 */
export function PlayerPhoto({
  code,
  className,
  style,
  placeholder,
}: {
  code: number | null | undefined
  className?: string
  style?: CSSProperties
  placeholder: ReactNode
}) {
  const [idx, setIdx] = useState(0)
  if (!code || idx >= PHOTO_SIZES.length) return <>{placeholder}</>
  return (
    <img
      key={idx}
      loading="lazy"
      src={`https://resources.premierleague.com/premierleague/photos/players/${PHOTO_SIZES[idx]}/p${code}.png`}
      alt=""
      className={className}
      style={style}
      onError={() => setIdx((i) => i + 1)}
    />
  )
}
