# The preview site

A full copy of the site built from any branch that is not `main`, published to a
separate GitHub Pages address. It exists so unfinished work can be looked at on
a real phone on a real network without being the live site.

Until `PREVIEW_REPO` is set, *Publish preview* skips itself and nothing changes.

---

## Why this shape and not another

**Why not just build locally?** `npm run dev` already works and the Worker
already allows `localhost:4173/4177/5173`, so local previews make live FPL calls
today. But the site is checked on a phone, on networks that are not this one,
and the one class of bug this project has actually shipped — content invisible
on WebKit — was invisible to Chromium too. A preview has to be reachable from
the device that finds those bugs.

**Why not Cloudflare Pages per-branch previews?** They are less setup and give a
URL per branch, which is genuinely nicer. The problem is `worker/fpl-proxy.js`:
its origin check is exact-match on purpose, because the relay runs on our
Cloudflare account and a wildcard like `*.pages.dev` would let anyone who can
deploy there route traffic through it. Per-branch URLs are only reachable behind
that wildcard. One fixed preview address keeps the exact-match check.

**Why a separate workflow file?** Adding a second branch to `deploy.yml`'s
trigger would put a dev build one `if:` typo away from `fplanalyser.co.uk`.
`preview.yml` cannot deploy to production and `deploy.yml` does not depend on it.

**Why does the data come from `main`?** The scheduled refreshes commit odds,
availability and squads to `main` several times a day. A branch carrying its own
copy conflicts on every rebase and is stale in between. The preview build checks
out `site_data` from `main` over whatever the branch holds, so you always see
**new code against live data** — which is the thing worth checking — and there
is never a data conflict to resolve.

---

## Setting it up

Use the **`mirror03` org you already have**, and this is about four minutes.

A second repo there is a *project* site — `mirror03.github.io/<repo>/` — which
is the same **origin** as the mirror. CORS matches scheme, host and port and
ignores the path, so `https://mirror03.github.io` is already in the Worker's
allowlist and **there is nothing to redeploy**. `vite.config.ts` sets
`base: './'` precisely so a project sub-path works.

1. **Create a public repo in `mirror03`** — any name, `fpl-preview` reads well.
   Not `mirror03.github.io`; that name is the mirror itself.

2. **Turn on Pages**: *Settings → Pages → Source: Deploy from a branch →
   `main` / `/ (root)`*.

3. **Reuse the mirror's token.** Edit the existing fine-grained PAT and add the
   new repo to its *selected repositories* — it already has Contents: Read and
   write and the right resource owner. Then `PREVIEW_TOKEN` is the same value as
   `MIRROR_TOKEN`.

4. **Add two settings** here (*Settings → Secrets and variables → Actions*):
   - variable `PREVIEW_REPO` = `mirror03/fpl-preview`
   - secret `PREVIEW_TOKEN` = that PAT

Push any branch. The run publishes and prints the URL.

### If you ever want it fully separate

A *user/org* site under its own new org (`<name>.github.io`) isolates the
preview completely — its own origin, its own storage, no relationship to the
mirror. It costs a new org, and a Worker redeploy with `PREVIEW_ORIGIN` set in
`worker/fpl-proxy.js` — which is **not optional**, or the preview loads and
every live FPL call fails CORS, looking like a broken build rather than a
missing origin. Only worth it if the shared-origin note below starts to bite.

---

## Why not just point previews at the mirror itself

Two reasons, and the first is fatal.

**The mirror is production.** It is how the site is reached from networks that
filter `fplanalyser.co.uk` — an office laptop, a school. Publishing a branch
there hands those people a half-built site with nothing to say it is not the
real one.

**It would not survive anyway.** The mirror job does `git init` then
`git push --force`, wiping the repo each build, and that runs on every push to
`main` plus the 05:40, 06:00 and 06:20 refreshes. A preview would be replaced
several times a day and oscillate with whatever landed last. The same goes for
a `preview/` subdirectory inside the mirror repo: the force-push takes it too,
and teaching the mirror job to preserve it couples the blocked-network access
route to a preview build, which is the wrong dependency.

## The shared-origin catch, and what handles it

Same origin means **one `localStorage`**, so a branch writing a broken
`fpl_planner` would land in the storage of whoever is using the mirror as their
real site — which is mostly you.

`src/lib/previewStorage.ts` prefixes every key the app owns with
`preview:<branch>:` on preview builds only, and is imported first in `main.tsx`
so it beats the first read. Verified against the built page: with
`fpl_planner` seeded as production, a preview write produced

```
fpl_planner                       = PRODUCTION-SQUAD   (untouched)
preview:feat-ladders:fpl_planner  = PREVIEW-SQUAD
```

It patches `Storage.prototype`, not the `localStorage` instance. Defining a
property on a Storage object does not shadow the method — it stores an entry —
so an instance-level patch silently does nothing and leaves junk keys named
`getItem` and `setItem` behind. That was the first attempt, and it took reading
the raw entries to notice.

---

## What a preview is not

- **Not counted.** `VITE_GOATCOUNTER` is deliberately not passed, so a preview
  records nothing and its privacy notice is true for the same reason a local
  build's is — it reads the same flag.
- **Not indexed.** The build writes `Disallow: /` and drops `sitemap.xml`. Half-
  built pages under a second domain would split the site's search identity and
  hand a crawler more odds-flavoured copy to categorise.
- **Not the custom domain.** `CNAME` is removed from the preview artefact; two
  Pages sites cannot both claim `fplanalyser.co.uk`.
- **Not confusable.** A corner badge names the branch on every page. It renders
  only when `VITE_PREVIEW` is set, so production ships no markup for it.
- **Not the mirror.** `mirror03.github.io` is production for people whose network
  blocks the domain, and must stay in step with it. Never point previews there.
