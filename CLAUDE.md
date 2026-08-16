# Working on this repo

Short file on purpose. Only things that change what you do.

## Ship to `main` — but not everything

**Small, finished, verified work goes straight to `main`.** The site deploys
from `main` via *Deploy to GitHub Pages*; a fix sitting unmerged on a branch is
a fix that looks undone.

**Anything half-built goes on a branch and gets a preview.** This rule used to
have no exception, and it was written before anyone could reach the site. Now
they can, so a new page landing on `main` in pieces is a broken live site, not
an untidy repo.

Push the branch and *Publish preview* builds it to a separate Pages site —
new code against `main`'s live data, no analytics, `Disallow: /`, and a corner
badge naming the branch so it cannot be mistaken for production. Nothing in
that workflow can deploy to `fplanalyser.co.uk`. See `docs/PREVIEW.md`; it is
inert until `PREVIEW_REPO` is set.

Rebase the branch on `main` often — the scheduled refreshes commit to `main`
several times a day, and a branch that carries its own `site_data` conflicts on
every one. The preview build sidesteps this by taking `site_data` from `main`
regardless of what the branch holds, so a stale branch still previews against
today's odds.

`main` also receives scheduled data-refresh commits (odds, availability, images)
several times a day, so **fetch and rebase before pushing** rather than merging
— the history is linear and worth keeping that way.

Verify against the *refreshed* data after rebasing, not the data you tested
with earlier: `npm run typecheck`, `npm run build`, then load every route.

**Not `npx tsc --noEmit`.** The root `tsconfig.json` is `"files": []` plus
project references, so bare `tsc` resolves it, finds nothing to check and exits
0 — it will sit there reporting success over a file with an unterminated
function. Only `tsc -b`, which both scripts above use, follows the references.
Also note `$?` after a pipeline is the *last* command's status, so
`tsc | head; echo $?` reports head. Use `${PIPESTATUS[0]}` or don't pipe.

## Identity

The site is published anonymously and a lot of work went into keeping it that
way — the account was renamed, the domain moved, 204 commits were rewritten and
the WHOIS redacted. Do not undo it:

- **No personal names, birth years or personal email addresses** anywhere — not
  in source, comments, docs, commit messages, config defaults, or site copy.
  It has slipped through twice in a non-user-facing default path, so grep the
  **whole tree**, not just `src/`.
- Contact address is the role account **fpl.analyser1@gmail.com**.
- Commit as `FPL Analyser <224126997+FPLAnalyser@users.noreply.github.com>`.
- No Premier League or club trade marks as brand assets. No bookmaker links,
  affiliates or tipping — see `docs/DOMAIN_CATEGORISATION.md` for why that
  matters beyond the obvious.

## Verify by measuring

The recurring failure mode here has been confident reasoning that turned out to
be wrong: a rigged CORS test, a share-export "fix" that assumed leading slack
when the real cause was a fixed 0.5em glyph offset, an iOS render that was
never profiled under an iPhone user agent until it was (10.8s against 0.67s).

Produce the artefact and inspect it. Playwright is available; Chromium is at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Screenshot the page, read
the pixels, compare against the live thing. Say what you measured.

### Trace the data, never assume its route

Before changing a number on a screen, follow it **bottom up** — from the JSON
file, through the hook that loads it, through every transform, to the component
that prints it. Read the actual call sites. Do not reason from what a field is
named or from where it would obviously come from.

This has cost real time more than once:

- Custom fixture difficulty was wired into the `fdr` column of
  `fixture_ease.json`, because that is plainly the fixture difficulty. The
  Fixtures page does not use it. Difficulty there is computed from per-game
  xG/xGC baselines through `buildDiffScale`, and `fdr` is only a fallback for an
  opponent with no baseline. The whole feature moved nothing.
- Then the Fixtures page turned out to be building its **own** copy of those
  baselines rather than using the shared hook, so fixing the shared one still
  would not have moved the grid.
- The same class of error: editing a pitch card in `SquadBuilder.tsx` when the
  board actually rendering it was `SeasonPlanner.tsx`.

Two habits that catch it. `grep` every call site of the function you are about
to change and check what each one passes — four call sites of `xpForGw` were
silently dropping the shot-profiles argument, so the same player showed a
different xP on two pages. And when a number is wrong, print it from a probe
harness (esbuild a throwaway `.ts` against `site_data/`, or drive the built
bundle in Playwright) before theorising about why.

## Where things are

- `docs/OPERATING_CALENDAR.md` — what runs on its own, what needs the owner, by when
- `docs/BACKLOG.md` — what is deliberately not blocking launch, and why
- `docs/ROLLOUT_BRIEF.md` — the marketing/commercial brief
- `docs/DOMAIN_CATEGORISATION.md` — corporate filters, and the Gambling risk
- `docs/VIDEO.md` — what to upload where, with the copy
- `docs/SOCIAL.md` — the daily job that drafts posts from `site_data` and opens
  an issue to approve. Note its wording guard is a hard failure, not a lint:
  DOMAIN_CATEGORISATION above is why, and a post cannot be edited after it has
  been seen
- `tools/video/README.md` — films the built site and encodes it; the shot list
  is `tools/video/shots.mjs`. Note it keeps the words "odds" and "bookmaker"
  out of frame on purpose — see DOMAIN_CATEGORISATION above before reframing
  a shot
- `NEXT_PHASE_PLAN.md` — predates the React rebuild; history, not a plan
