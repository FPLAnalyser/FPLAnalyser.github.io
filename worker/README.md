# FPL API relay (Cloudflare Worker)

## What a Worker is

A small piece of JavaScript that Cloudflare runs on their own servers whenever
someone hits a URL you own. There is no server to rent, patch or restart — you
upload the file, Cloudflare runs it. The free plan allows 100,000 requests a
day, which is far more than this site will use.

## Why we need one

Browsers refuse to read a response from another domain unless that domain sends
a header saying it is allowed. The FPL API sends no such header, so the site
cannot call it directly. The old workaround was a free public relay
(`corsproxy.io`), which meant:

- a stranger's server saw every visitor's FPL team ID, manager name and league
  names — a third party in your data path that you have no contract with, and
  that a privacy notice has to disclose;
- a rate limit and an uptime you do not control;
- a dependency that can disappear without notice.

This Worker is the same idea, owned by you. It is not a browser, so the CORS
rule does not apply to it: it fetches the FPL API server-to-server and returns
the answer with the header the browser is waiting for.

## Deploy it (about ten minutes, no card needed)

1. Create a free account at <https://dash.cloudflare.com/sign-up>.
2. **Compute (Workers)** → **Create** → **Create Worker**. Name it
   `fpl-analyser-api`, deploy the starter.
3. **Edit code**, delete what is there, paste `fpl-proxy.js` from this folder,
   **Deploy**.
4. Copy the URL it gives you — something like
   `https://fpl-analyser-api.<your-subdomain>.workers.dev`.
5. Set it as a build variable so the site uses it. In the repo:
   **Settings → Secrets and variables → Actions → Variables → New variable**,
   name `VITE_FPL_PROXY`, value the Worker URL with **no trailing slash**.
6. Re-run the deploy workflow.

Test it in a browser before wiring it up — this should return JSON:

```
https://fpl-analyser-api.<your-subdomain>.workers.dev/api/entry/1/
```

and this should return a 403, which is the point:

```
https://fpl-analyser-api.<your-subdomain>.workers.dev/api/anything-else/
```

## Before you go live

- `ORIGINS` is already current: `fplanalyser.co.uk`, its `www` form, the
  `github.io` address it redirects from, and localhost for development. Add to
  it only if the site gains another address — and redeploy the Worker when you
  do, because the list lives in the Worker, not in the site.
- Leave `ALLOW` alone unless you add a new FPL endpoint. It is what stops the
  Worker becoming an open proxy for anyone who finds the URL.

## Once it is running

Nothing further to change in the site. `/legal` already branches on whether
`VITE_FPL_PROXY` is set: with it, the privacy notice says the relay is ours
and no other company is involved; without it, the notice names the public
proxy, because a notice that hid it would be false.

That branch doubles as the check that the deploy worked. Open `/legal` →
Privacy → "When something does leave your browser". If it still names a public
relay, the build did not pick the variable up.
