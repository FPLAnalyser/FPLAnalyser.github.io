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

## A results card for a gameweek

```bash
node tools/social/card.mjs                        # latest GW, top 6 by points
node tools/social/card.mjs --format wide --top 6
node tools/social/card.mjs --players Saka,Raya,Thomas
```

Draws `site_data/<season>/actuals/gw<N>.json` — the file *Pull the actual
points* writes every fifteen minutes while the football is on — as a picture:
six players, each with minutes, xG, xA, defensive contribution and BPS, an
xG/xA bar scaled across the card, and the team xG under the scoreline. Into
`build/social/cards/`. `--format` is `square` (1200×1200, the default), `wide`
(1600×900) or `portrait` (1200×1500), all at 2x.

**The badges are what the appearance earned**, not just what it scored: goals,
assists, a clean sheet, a defensive threshold cleared, and the bonus. Without
the last three a card credits a 90-minute defender with nothing at all, which
is both wrong and the least interesting thing it could say. Two rules that are
easy to get wrong and are enforced in the code rather than left to whoever
picks the players:

- **A clean sheet only pays a keeper, a defender and a midfielder** (4, 4 and
  1). The API sets `clean_sheets` on the whole side, so a forward comes back
  with the flag set and no points from it — `CS_SCORES` filters him out.
- **The Def Con threshold is 10 for a defender and 12 for everyone else**, from
  `dc_rules.py`. The badge shows only when it was actually cleared, and the
  `DC/10` column turns green at the same moment.

Bonus is outlined in gold rather than filled in green because it is the one
badge that can still change — `pull-gw.yml` keeps writing until FPL closes the
gameweek, and the footer says `Provisional — bonus not final` until it does.

The xG/xA bar is two golds a value apart, and the `xG` and `xA` labels in the
stat strip are tinted to match, which is what lets the bar go without a legend
of its own. The first draft used `--chart-1` and `--chart-2`, the site's series
colours: correct for a graph inside the product, wrong for a picture meant to
be recognisable as this brand at thumbnail size on somebody else's timeline.

It does not need `npm run build`. The card is its own HTML rather than a
screenshot of the site, because the site has no page shaped like this and
adding one to serve a picture would be the tail wagging the dog. Colours, type
and the Def Con thresholds all come from the real thing, so it cannot drift
into inventing its own numbers.

**The scoreline is derived, not read.** A team's goals are its players' goals
plus the opposition's own goals, and the `opp` field is an array of strings
like `"COV(H)"` — an array because a gameweek can be a double, a string because
the venue is packed in. Reading it as a plain team code pairs nobody with
anybody and the card silently captions itself with the season instead of the
match. Doubles are left unpaired on purpose: two fixtures have no single
scoreline, so the header counts matches rather than picking one and calling it
the game.

**What it cannot show is shots.** The FPL API ships expected goals but not the
shots behind them, and the Understat pull only runs in *Refresh pre-season
squad data* — every shot map in `site_data` is last season's, first kick to
last. A shot count printed next to a live xG would be quoting two seasons at
once. `SHOT_KEYS` in the file is where one would join if in-season Understat
ever lands; until then the column simply does not render.

Early in a season the card is honest about being thin: with one match played it
has thirty-one names to choose from and says `Provisional — bonus not final`,
because `pull-gw.yml` writes that flag until FPL closes the gameweek and a
score can still be corrected days later.

## Running it by hand

`workflow_dispatch` on *Draft social posts* takes a candidate count and a
polish toggle. It opens an issue exactly as the scheduled run does, which makes
it the way to test a new finder against live data without waiting for 06:45.

## Where the rest of the copy lives

`docs/VIDEO.md` — the planner video for X, the YouTube cut and the three
Shorts, with the post copy for each. Launch messaging is
`docs/ROLLOUT_BRIEF.md`.
