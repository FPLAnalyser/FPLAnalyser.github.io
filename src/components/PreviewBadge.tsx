import { Link } from 'react-router-dom'
import { useTweaks } from '../lib/tweaks'
/** A corner marker saying this build is not the live site.
 *
 *  Set at build time by .github/workflows/preview.yml, which passes the branch
 *  name as VITE_PREVIEW. Every other build — production, a local `npm run dev`,
 *  a fork — leaves it unset and renders nothing, so this costs the live site an
 *  undefined check and no markup.
 *
 *  Deliberately a small pinned pill rather than a full-width strip. The
 *  pre-season banner was a strip and it was the first thing every reader met on
 *  every route for a caveat the page already made; the lesson generalises. This
 *  needs to be unmissable to someone looking for it and ignorable to someone
 *  reading the page, which is a corner, not a header. */
const BRANCH = (import.meta.env.VITE_PREVIEW as string | undefined)?.trim()

/* Vite's define, so it is the moment THIS bundle was built. */
declare const __BUILD_TIME__: string

/* WHICH BUILD AM I LOOKING AT. Twice now a fix has been reported as missing
   when the server was serving it and the browser was serving something older
   — a service worker on a phone, an HTTP cache on a locked-down laptop — and
   there was no way to tell those two apart from the screen. The badge already
   names the branch; the time it was built costs eleven characters beside it
   and settles the question without opening /debug. */
const BUILT = (() => {
  try {
    const d = new Date(__BUILD_TIME__)
    return `${String(d.getUTCDate()).padStart(2, '0')} ${
      ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]
    } ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  } catch { return null }
})()

/** YOUR RATINGS ARE ON. Every projection on the page is running on them, so
 *  the page has to say so — a number nobody can tell is yours is a number
 *  that will be reported as the site's being wrong. */
export function TweakBadge() {
  const { count } = useTweaks()
  if (!count) return null
  return (
    <Link
      to="/my-ratings"
      title={`${count} club${count === 1 ? '' : 's'} re-rated by you — every projection on the site is using them`}
      className="fixed right-2 bottom-[calc(env(safe-area-inset-bottom)+80px)] z-50 rounded-full border border-info bg-info/15
                 px-2.5 py-1 text-[10px] font-semibold tracking-[.09em] text-info uppercase backdrop-blur-sm md:bottom-3"
    >
      Your ratings · {count}
    </Link>
  )
}

export function PreviewBadge() {
  if (!BRANCH) return null
  return (
    <div
      className="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)+80px)] left-2 z-50
                 rounded-full border border-accent bg-accent-soft px-2.5 py-1
                 text-[10px] font-semibold tracking-[.09em] text-accent uppercase
                 backdrop-blur-sm md:bottom-3"
      title={`Preview build of ${BRANCH}${BUILT ? `, built ${BUILT} UTC` : ''} — not the live site, and not counted in analytics`}
    >
      Preview · {BRANCH}
      {BUILT && <span className="ml-1.5 font-normal opacity-75">{BUILT}</span>}
    </div>
  )
}
