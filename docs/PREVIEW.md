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

Roughly ten minutes, once.

1. **Create the repo.** A new **public** repo named `<name>.github.io` under an
   account or org — it can be the same org as the mirror. It must be a *user or
   org* site (`<name>.github.io`), not a project site, or it inherits the custom
   domain redirect the mirror exists to escape (`docs/DOMAIN_CATEGORISATION.md`).

2. **Turn on Pages** in that repo: *Settings → Pages → Source: Deploy from a
   branch → `main` / `/ (root)`*.

3. **Make a token** that can push to it: a fine-grained PAT with **Contents:
   Read and write** on that repo. Its *Resource owner* must be whoever owns the
   repo — that cannot be changed after creation, so getting it wrong means
   reissuing.

4. **Add them to this repo** (*Settings → Secrets and variables → Actions*):
   - variable `PREVIEW_REPO` = `owner/name.github.io`
   - secret `PREVIEW_TOKEN` = the PAT

5. **Redeploy the Worker.** Set `PREVIEW_ORIGIN` in `worker/fpl-proxy.js` to
   `https://<name>.github.io` and paste the file into the Cloudflare editor
   (`worker/README.md`). **Not optional** — without it the preview loads and
   every live FPL call fails CORS, which looks like a broken build rather than a
   missing origin.

Then push any branch. The run publishes and prints the URL.

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
