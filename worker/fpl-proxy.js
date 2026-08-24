/**
 * FPL API relay — a Cloudflare Worker.
 *
 * WHY THIS EXISTS
 * The FPL API sends no CORS headers, so a browser refuses to read its
 * responses from our origin. The site previously borrowed a free public relay
 * (corsproxy.io, allorigins.win) to get around that, which meant a stranger's
 * server sat in the middle of every request — seeing visitors' FPL team IDs,
 * manager names and league names — and could rate-limit or vanish at any time.
 *
 * A Worker is our own code running on Cloudflare's edge. It is not a browser,
 * so CORS does not apply to it; it fetches the FPL API server-to-server and
 * hands the result back with the one header the browser is waiting for.
 *
 * NOT AN OPEN PROXY. An unrestricted relay is abuse bait — someone finds it and
 * routes their own traffic (or something worse) through your account. Two locks:
 * only paths matching ALLOW are fetched, and only our own origins are told they
 * may read the response.
 */

/** Exactly the FPL endpoints the site calls. Anything else is refused. */
const ALLOW = [
  /^\/api\/bootstrap-static\/$/,
  /^\/api\/entry\/\d+\/$/,
  /^\/api\/entry\/\d+\/history\/$/,
  /^\/api\/entry\/\d+\/event\/\d+\/picks\/$/,
  /^\/api\/leagues-classic\/\d+\/standings\/$/,
  // Live scores for a gameweek in progress. The scheduled job stores the same
  // endpoint's answer as the durable record; this is so the page can show it
  // while the football is on rather than waiting for the next commit.
  /^\/api\/event\/\d+\/live\/$/,
]

/** The preview site, if one exists — set this to the Pages origin you created
 *  for it (see docs/PREVIEW.md) and redeploy, or leave it empty.
 *
 *  It is a named constant rather than another line in the list below because
 *  the empty case has to be safe: '' is filtered out, so an unconfigured
 *  preview matches nothing rather than matching every origin whose header is
 *  missing. */
const PREVIEW_ORIGIN = ''

/** Origins allowed to read a response. Add a custom domain here when you have one.
 *
 *  Exact match, deliberately — no wildcards, no suffix tests. This relay runs on
 *  our Cloudflare account, so an origin check that admits `*.pages.dev` or
 *  `*.github.io` would let anyone who can deploy to those hosts route their
 *  traffic through it. That is also why the preview site is a fixed address
 *  rather than per-branch URLs: per-branch previews are only reachable behind a
 *  wildcard, and the wildcard is the thing worth avoiding. */
const ORIGINS = [
  'https://fplanalyser.co.uk',
  'https://www.fplanalyser.co.uk',
  'https://fplanalyser.github.io',
  // The github.io mirror, for networks that filter the custom domain. Same
  // build, different origin — so it needs listing here or every live call from
  // it fails CORS. See docs/DOMAIN_CATEGORISATION.md.
  'https://mirror03.github.io',
  PREVIEW_ORIGIN,
  'http://localhost:4173',
  'http://localhost:4177',
  'http://localhost:5173',
].filter(Boolean)

/** How long the edge may reuse a response. Manager picks change at most once a
 *  gameweek; a minute of cache turns a viral spike into a handful of origin
 *  hits and keeps us politely quiet against the FPL API.
 *
 *  Live scores get the same minute, and should. Points appear on the FPL
 *  endpoint within a minute or two of the thing that caused them, so a
 *  sixty-second edge cache costs the reader nothing they could perceive and is
 *  the difference between one origin request a minute and one per viewer per
 *  poll on a Saturday afternoon. */
const EDGE_TTL = 60

function cors(origin) {
  const allowed = ORIGINS.includes(origin) ? origin : ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') ?? ''
    const headers = cors(origin)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers })

    // The path we were called with IS the FPL path: /api/entry/123/ etc.
    const url = new URL(request.url)
    const path = url.pathname
    if (!ALLOW.some((re) => re.test(path))) {
      return new Response(JSON.stringify({ error: 'Path not allowed' }), {
        status: 403,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }

    const target = 'https://fantasy.premierleague.com' + path
    try {
      const upstream = await fetch(target, {
        headers: { Accept: 'application/json', 'User-Agent': 'fpl-analyser' },
        cf: { cacheTtl: EDGE_TTL, cacheEverything: true },
      })
      if (!upstream.ok) {
        return new Response(JSON.stringify({ error: 'Upstream error', status: upstream.status }), {
          status: upstream.status === 404 ? 404 : 502,
          headers: { ...headers, 'Content-Type': 'application/json' },
        })
      }
      const body = await upstream.text()
      return new Response(body, {
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${EDGE_TTL}`,
        },
      })
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Fetch failed', detail: String(e) }), {
        status: 502,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    }
  },
}
