import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { liveCodeFor, liveCodesVersion, subscribeLiveCodes } from '../lib/photoCodes'

// The Premier League moved current-season headshots to a season-versioned
// bucket with the bare code as the filename:
//   .../premierleague25/photos/players/<size>/<code>.png
// while the legacy bucket (…/premierleague/…/p<code>.png) still holds the OLD
// photo (e.g. a transferred player's previous club). So we try the new bucket
// first, then fall back to the legacy one.
const CDN = 'https://resources.premierleague.com'
const PHOTO_SIZES = ['250x250', '110x140'] as const

/** Candidate headshot URLs, current-season bucket first, then legacy. */
function photoUrls(code: number, sizes: readonly string[], ver?: string): string[] {
  const bust = ver ? `?v=${ver}` : ''
  const out: string[] = []
  for (const s of sizes) out.push(`${CDN}/premierleague25/photos/players/${s}/${code}.png${bust}`)
  for (const s of sizes) out.push(`${CDN}/premierleague/photos/players/${s}/p${code}.png${bust}`)
  return out
}

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
  // transfer) re-fetches the headshot instead of a browser-cached one.
  const ver = (window as unknown as { __photoVer?: string }).__photoVer
  const urls = resolved ? photoUrls(resolved, chain, ver) : []
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
