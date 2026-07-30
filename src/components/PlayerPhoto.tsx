import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { liveCodeFor, liveCodesVersion, subscribeLiveCodes } from '../lib/photoCodes'

// Headshots live in a season-versioned bucket with the bare code as the
// filename:
//   .../premierleague25/photos/players/<size>/<code>.png
// and the unversioned legacy path (…/premierleague/…/p<code>.png) holds an
// older set. Measured rather than assumed — see photo_bucket_check.py, which
// asks the host directly and reads Last-Modified back:
//
//   premierleague25  250x250  403   (the bucket does not carry that size)
//   premierleague25  110x140  200   shot August 2025  <- newest that exists
//   premierleague    250x250  200   shot August 2024
//
// Two things follow. Every SIZE in the versioned bucket has to be tried before
// the legacy path, because the first one 403s and stopping there drops you a
// whole season. And a 403 is not a failure here, it is "not at this address" —
// reading it as one is what put 2024 photos on the site.
const CDN = 'https://resources.premierleague.com'
// Only the bucket that actually answers. premierleague26/27 return 502 — they
// don't exist yet — and putting a 502 in front of every visitor's headshot
// buys a stalled round-trip for nothing. The nightly mirror carries the
// forward-looking guess instead, where one slow request a day costs no one
// anything; when this season's photos appear they arrive via the mirror.
const SEASON_BUCKETS = ['premierleague25'] as const
const PHOTO_SIZES = ['250x250', '110x140'] as const

/** Candidate headshot URLs.
 *
 *  Our own mirror first (see mirror_assets.py). A same-origin image is the
 *  only kind a canvas will read back, so this is what puts the players in the
 *  share images — asking the Premier League's CDN through CORS only works if
 *  it chooses to send the headers, and it is not our call. The mirror is also
 *  one fewer third-party request on every page.
 *
 *  The CDN chain stays behind it, unchanged, for anyone the nightly mirror
 *  hasn't picked up yet — a player signed this morning shows on the page
 *  straight away and joins the mirror overnight. */
function photoUrls(code: number, sizes: readonly string[], ver?: string): string[] {
  const bust = ver ? `?v=${ver}` : ''
  const out: string[] = [`${import.meta.env.BASE_URL}img/players/${code}.webp`]
  for (const bucket of SEASON_BUCKETS) {
    for (const s of sizes) out.push(`${CDN}/${bucket}/photos/players/${s}/${code}.png${bust}`)
  }
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
  // Whether this URL has fallen back to a plain, non-CORS request.
  //
  // Headshots are asked for through CORS the first time, because that is the
  // only way their pixels can be read back off a canvas — and an export that
  // cannot read them draws a hole. Requesting them plainly for the page and
  // then again with CORS at export time does not work: the browser hands the
  // second request the first one's cached response, which carries no CORS
  // headers, so the check fails even where the host would have allowed it.
  // That is why the photos kept disappearing from saved images.
  //
  // If the host turns out not to send the headers at all, the CORS request
  // errors and we re-request plainly so the photo still shows on the page;
  // it is marked so the export can put the monogram there instead.
  const [plain, setPlain] = useState(false)
  const prev = useRef(resolved)
  useEffect(() => {
    if (prev.current !== resolved) {
      prev.current = resolved
      setIdx(0) // new code → start the size chain again
      setPlain(false)
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
      key={`${resolved}-${idx}-${plain ? 'plain' : 'cors'}`}
      loading="lazy"
      src={urls[idx]}
      alt=""
      crossOrigin={plain ? undefined : 'anonymous'}
      data-nocors={plain ? '' : undefined}
      className={className}
      style={style}
      onError={() => {
        // A CORS failure says nothing about whether the image exists, so try
        // the same URL plainly before giving up on it and moving down the list.
        if (!plain) setPlain(true)
        else { setPlain(false); setIdx((i) => i + 1) }
      }}
    />
  )
}
