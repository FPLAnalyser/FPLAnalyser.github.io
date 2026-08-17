# Drafting posts from the data

Every morning at 06:45 UTC, twenty-five minutes after the last data refresh
commits, a job reads `site_data` and opens a GitHub issue containing two or
three candidate posts. You read it on a phone, copy the one you like, post it.

```bash
node tools/social/draft.mjs                 # print to stdout
node tools/social/draft.mjs --count 5       # more candidates
node tools/social/draft.mjs --polish        # + a Claude rewrite pass
```

Nothing here publishes. That is the design, not a missing feature — see
**Why it drafts instead of posting** below.

## What it can say

Five finders, in `tools/social/stories.mjs`. Each returns the same shape, so
ranking and composing do not care which produced what.

| Story | Reads | Says |
|-------|-------|------|
| `price-rise` / `price-drop` | `price_risk.json` | who the transfer market is about to reprice, and by how much |
| `fixture-run` | `fixture_ease.json` | the kindest and hardest six-week runs, with the averages |
| `value` | `ratings.json` | best expected points per million |
| `differential` | `ratings.json` | a player the model rates and the crowd has not found |
| `persona` | `persona_shifts.json` | someone whose role has changed |

This is the part a generic FPL account cannot do. The scheduled refreshes
commit fresh numbers to `main` several times a day; by 06:45 there is a fact in
there nobody else has worked out yet. Adding a finder is one function returning
`{id, kind, score, headline, lines[], route, facts}` and one entry in `FINDERS`.

`score` is a 0–1 estimate of how interesting a story is *today*, so a quiet
morning surfaces a fixture run and a dramatic one surfaces the price moves. The
job also reads the last five issues and demotes anything drafted recently — a
feed that repeats itself reads as automated whatever the numbers are worth.

**Two filters keep the picks honest.** Players need 1,200 minutes before their
per-game numbers count, or the value pick is whoever had a hot fortnight off
the bench at £4.5m. And the differential ceiling is 8% ownership, because at
anything higher it is a template piece with a differential's reputation.

Pre-season, every per-game figure is carried from last season — `meta.json`
says `provisional: true` — and the copy says *"in 2025/26"* rather than
implying it is current form.

## The wording guard

`tools/social/wording.mjs` fails the whole run — non-zero exit, no issue — if a
draft contains **odds, bookmaker, betting, bet, wager, accumulator, punt,
stake** or any of their relatives.

`docs/DOMAIN_CATEGORISATION.md` explains why this is a hard failure rather than
a lint warning: a crawler finding "clean-sheet odds" is the plausible route to
a **Gambling** classification, which is blocked far harder and in far more
places than being uncategorised. The generator reads `odds.json` for nothing,
but several of the numbers it does read are downstream of market-implied
probabilities, so a phrasing that explains where a figure comes from is one
plausible sentence away from naming the input. A page can be edited after
publishing. A post that has been seen cannot be unseen.

The same guard checks for leaked identities (`CLAUDE.md`) and counts length the
way X does — **every link is 23 characters** regardless of its real length.

## The optional AI step

`--polish` hands each draft to Claude for wording only, and is skipped entirely
unless `ANTHROPIC_API_KEY` is set.

It is the only part of the pipeline that can hallucinate, so it is the only
part with a guard that does not rely on anyone reading the output. A rewrite is
accepted only if **every number in it also appears in the draft it came from**,
it clears the same wording guard, it keeps the link, and it still fits.

The numeric check is the one that matters. An invented statistic reads exactly
like a real one — that is what makes it dangerous, and what makes proof-reading
the wrong control for it. Set comparison catches it every time and costs
nothing. Anything that fails is discarded and the template draft ships instead:
a slightly stiffer sentence is a much better failure than a smooth false one.

Cost is negligible — a few hundred tokens per post on `claude-opus-5` at
$5/$25 per million.

## Why it drafts instead of posting

Publishing on a timer with nobody reading first is one bad morning of data away
from saying something wrong to everyone at once, and at launch the follower
count is worth less than the credibility. Approval costs about ten seconds.

The economics also favour it: X's free API tier is write-only and capped at a
few hundred posts a month, and paid tiers start at a few hundred dollars.
Copying a block into the composer costs nothing and skips the OAuth 1.0a
signing entirely.

If you do want it publishing unattended later, the pieces are in place —
`build/social/drafts.json` carries each post as a string with its story id,
character count and facts. Add the API call; keep the guard in front of it.

**X allows automation.** What gets accounts suspended is duplicative posting,
automated engagement (mass follows, auto-likes, auto-replies to strangers), and
running several accounts posting the same thing. One account posting one
genuinely different thing a day is squarely inside the developer policy.

## Screenshots for a thread

```bash
npm run build && node tools/social/screens.mjs
```

Five clean 16:9 shots of the planner into `build/social/shots/` — the whole
card, the bars, the grid re-read as DC%, the transfer seams, and the risk
panel. 1440×810 at 2x, which is exactly 16:9, so the timeline crops nothing.

**Not video stills.** `render.mjs` burns a caption and a pointer into every
frame, which is right for a video and wrong in a thread: the tweet above the
image is already the caption, and a second one inside the picture makes it read
as a screenshot of a video rather than of the product.

The framings are the ones the planner cut already proved legible — same
anchors, same zooms, same reasons — so `tools/video/README.md` § Zooming
explains the mechanics. Two things it gets wrong if you copy a framing
carelessly: the site's nav is sticky and about 70px deep, so a shot that
scrolls a card header up to meet it half-hides the header and reads as a
rendering bug; and toggle state survives between shots, so a shot that wants
fixture codes has to select `Fix` itself rather than inherit whatever the
previous one left.

## Running it by hand

`workflow_dispatch` on *Draft social posts* takes a candidate count and a
polish toggle. It opens an issue exactly as the scheduled run does, which makes
it the way to test a new finder against live data without waiting for 06:45.

## Where the rest of the copy lives

`docs/VIDEO.md` — the planner video for X, the YouTube cut and the three
Shorts, with the post copy for each. Launch messaging is
`docs/ROLLOUT_BRIEF.md`.
