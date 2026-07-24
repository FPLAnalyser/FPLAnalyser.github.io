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
  // Cache-bust by the data's build date so a fresh data pull (new kits after a
  // transfer) re-fetches the headshot instead of a browser-cached one. Each size
  // is tried versioned first, then plain — so if the CDN ever dislikes the query
  // param we still fall back to the working URL rather than a placeholder.
  const ver = (window as unknown as { __photoVer?: string }).__photoVer
  const base = (size: string) => `https://resources.premierleague.com/premierleague/photos/players/${size}/p${resolved}.png`
  const urls = chain.flatMap((size) => (ver ? [`${base(size)}?v=${ver}`, base(size)] : [base(size)]))
  if (!resolved || idx >= urls.length) return <>{placeholder}</>
  return (
    <img
      key={`${resolved}-${idx}`}
      loading="lazy"
      src={urls[idx]}
      alt=""
      className={className}
      style={style}
      onError={() => setIdx((i) => i + 1)}
    />
  )
}
