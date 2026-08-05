# Working on this repo

Short file on purpose. Only things that change what you do.

## Ship to `main`

**Push straight to `main`.** The site deploys from `main` via *Deploy to GitHub
Pages*; anything on a feature branch is invisible to the owner, who checks the
live site. Work sitting unmerged on a branch is work that looks undone.

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

## Where things are

- `docs/OPERATING_CALENDAR.md` — what runs on its own, what needs the owner, by when
- `docs/BACKLOG.md` — what is deliberately not blocking launch, and why
- `docs/ROLLOUT_BRIEF.md` — the marketing/commercial brief
- `docs/DOMAIN_CATEGORISATION.md` — corporate filters, and the Gambling risk
- `NEXT_PHASE_PLAN.md` — predates the React rebuild; history, not a plan
