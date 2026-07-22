import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { liveCodeFor, liveCodesVersion, subscribeLiveCodes } from '../lib/photoCodes'

// Try the size the official FPL app uses first (most complete, incl. newly
// promoted clubs), then the legacy size, then a placeholder. Both are attempted
// so we get the union of whatever the CDN has for a player.
const PHOTO_SIZES = ['250x250', '110x140'] as const

/**
 * Premier League player headshot. Prefers the live FPL photo code for the
 * player's `element` (so transferred / new players show the current kit) and
 * falls back to the pipeline `code`. Tries the FPL-app image size then the
 * legacy one; `placeholder` renders when there's no code or every URL 404s.
 */
// Hero variant: try the big 440x700 cutout first, then the standard chain.
const HERO_SIZES = ['440x700', ...PHOTO_SIZES] as const

export function PlayerPhoto({
  element,
  code,
  className,
  style,
  placeholder,
  hero = false,
}: {
  element?: number | null
  code: number | null | undefined
  className?: string
  style?: CSSProperties
  placeholder: ReactNode
  /** Use the large 440x700 cutout chain (player-hero display). */
  hero?: boolean
}) {
  // Re-render when live codes arrive so a stale placeholder can retry.
  useSyncExternalStore(subscribeLiveCodes, liveCodesVersion, liveCodesVersion)
  const resolved = liveCodeFor(element, code)

  const [idx, setIdx] = useState(0)
  const prev = useRef(resolved)
  useEffect(() => {
    if (prev.current !== resolved) {
      prev.current = resolved
      setIdx(0) // new code → start the size chain again
    }
  }, [resolved])

  const chain = hero ? HERO_SIZES : PHOTO_SIZES
  if (!resolved || idx >= chain.length) return <>{placeholder}</>
  return (
    <img
      key={`${resolved}-${idx}`}
      loading="lazy"
      src={`https://resources.premierleague.com/premierleague/photos/players/${chain[idx]}/p${resolved}.png`}
      alt=""
      className={className}
      style={style}
      onError={() => setIdx((i) => i + 1)}
    />
  )
}
