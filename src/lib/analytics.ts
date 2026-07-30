/* ════════════════════════════════════════════════════════════════════════
   How many people came, and which pages they read.

   GoatCounter. No cookies, nothing written to the visitor's device, no
   profile, no cross-site anything — which is the only kind of counting that
   fits a site whose whole pitch is that it does not track you, and the only
   kind that does not drag a consent banner in with it under PECR.

   ── Why this is not one script tag ──────────────────────────────────────

   The app is hash-routed: every page is `/#/preview`, `/#/players`. The part
   after the `#` is a *fragment*, and a fragment is never sent to a server —
   it is resolved by the browser and nothing else. So a drop-in analytics
   beacon, which reports `location.pathname`, would faithfully record every
   visit to every page in the site as a visit to `/`, and the per-page numbers
   this exists to produce would all be zero.

   So automatic counting is switched off (`no_onload`) and the path is sent by
   hand on each route change, with the hash unpicked into something readable.

   ── Off unless configured ───────────────────────────────────────────────

   VITE_GOATCOUNTER holds the endpoint. Unset — which is every local build and
   every fork — and nothing is loaded and no request is made, the same way the
   tip jar stays invisible without VITE_SUPPORT_URL. A privacy claim that is
   only true in production is not one worth making.
   ════════════════════════════════════════════════════════════════════════ */

const ENDPOINT = (import.meta.env.VITE_GOATCOUNTER as string | undefined)?.trim()

/** True when the site is actually counting. The /legal page reads this, so the
 *  privacy notice describes the build the reader is looking at rather than the
 *  one that happened to be written about. */
export const countsVisits = !!ENDPOINT && /^https:\/\//.test(ENDPOINT)

interface GoatCounter {
  count: (v: { path: string; title?: string; event?: boolean }) => void
  no_onload?: boolean
}
type W = Window & { goatcounter?: GoatCounter }

let loading: Promise<void> | null = null

/** Fetch the counter once, with automatic counting disabled. */
function load(): Promise<void> {
  if (loading) return loading
  loading = new Promise<void>((resolve) => {
    // Set before the script runs — it reads this on load to decide whether to
    // count the landing page itself, which for us would be the `/` we are
    // trying not to record.
    ;(window as W).goatcounter = { no_onload: true } as GoatCounter
    const s = document.createElement('script')
    s.async = true
    s.dataset.goatcounter = ENDPOINT
    s.src = 'https://gc.zgo.at/count.js'
    // Resolve either way. A blocked or failed counter must never be something
    // the rest of the page waits on or notices.
    s.addEventListener('load', () => resolve(), { once: true })
    s.addEventListener('error', () => resolve(), { once: true })
    document.head.appendChild(s)
  })
  return loading
}

/** `/preview?player=302` → `/preview`.
 *
 *  The query string is thrown away deliberately. It carries the reader's own
 *  state — the team ID they typed into My Team, the players they put
 *  side by side — and none of that is ours to send anywhere. Counting which
 *  pages get read does not require knowing who read what. */
function tidy(pathname: string): string {
  const p = (pathname || '/').split('?')[0].split('#')[0]
  return p === '' ? '/' : p
}

/** Record one page view. Safe to call before the script has loaded, on a build
 *  with no endpoint, and on a device where the request fails. */
export async function countPage(pathname: string, title?: string): Promise<void> {
  if (!countsVisits) return
  try {
    await load()
    ;(window as W).goatcounter?.count({ path: tidy(pathname), title })
  } catch {
    /* counting is never worth an error in front of a reader */
  }
}
