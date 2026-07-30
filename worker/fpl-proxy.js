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
]

/** Origins allowed to read a response. Add a custom domain here when you have one. */
const ORIGINS = [
  'https://fplanalyser.co.uk',
  'https://www.fplanalyser.co.uk',
  'https://fplanalyser.github.io',
  'http://localhost:4173',
  'http://localhost:4177',
  'http://localhost:5173',
]

/** How long the edge may reuse a response. Manager picks change at most once a
 *  gameweek; a minute of cache turns a viral spike into a handful of origin
 *  hits and keeps us politely quiet against the FPL API. */
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
