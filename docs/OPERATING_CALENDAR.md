# Operating calendar

What runs on its own, what needs you, and by when. Dates are for 2026-27;
deadlines come from `site_data/2026-27/availability.json` (`events`), which the
06:00 refresh keeps current — check there rather than trusting this file if the
two disagree.

## What runs on its own

Nothing below needs a laptop open. All four are GitHub Actions on `main`.

| Time (UTC) | Workflow | What it does |
|---|---|---|
| 05:40 daily | Refresh pre-season squad data | Rebuilds `site_data/<season>/` from the FPL API — new signings, prices, ownership, fixtures, carried ratings. **Pre-season only; turn off after GW1.** |
| 06:00 daily | Refresh availability data | Injuries, suspensions, chance-of-playing, set-piece order, deadlines. Also mirrors any new crests and headshots. |
| 06:20 daily | Refresh odds data | Per-fixture goal expectancies from bookmaker odds. |
| every 15 min, 10:00–20:45 | Advance the gameweek | Moves the site on to the next gameweek 30 minutes after the current one's deadline, so people can plan the next one straight away instead of waiting for Monday. Nearly every run is one API call and an early exit. See below. |
| on every push | Deploy to GitHub Pages | Rebuilds and publishes. Fires on the three above as well as on your own pushes. Also mirrors the same build to a plain `github.io` address for networks that block the domain — dormant until you set it up, see below. |

The pre-season refresh carries last season's ratings forward every run. That is
correct now and wrong the moment real 2026-27 numbers exist, which is why it has
an off date below. (It no longer pins `provisional: true` — that clears itself
once FPL reports a gameweek current or finished.)

### Why "advance the gameweek" polls

A gameweek closes at its **deadline**, not at the final whistle: from that moment
the teams are locked and nothing the site says about it can be acted on. Its
fixtures are not finished until late on Monday. The whole weekend used to sit on
a gameweek nobody could change.

GitHub cron is a fixed UTC schedule and FPL deadlines are not — they move between
Friday and Saturday, shift for cup weeks, and get rewritten when a fixture is
postponed. There is no way to say "thirty minutes after the deadline", so the job
runs on a quarter-hour and the *data* decides: `advance_gameweek.py` reads the
deadlines, and writes only when the site is behind. A duplicate run, a run GitHub
delayed, and a run missed entirely all land in the same place.

The half hour of grace is deliberate rather than technical — see `SETTLE` in that
file. Set it to 0 for an instant switch.

## Before launch

| By | Job | Why it matters |
|---|---|---|
| **any time before Fri 21 Aug** | Twenty minutes on your own iPhone, every route, both themes | WebKit cannot be tested here — the Playwright download is blocked (`403 host not permitted`), so every measurement in this repo is Chromium. The one WebKit bug this site has had (invisible content) was invisible to Chromium too. |
| ~~before Fri 21 Aug~~ **done** | ~~Supply GW1 expected points for the twenty most-owned players who have none~~ | Supplied and wired in — the twenty carried 83% combined ownership and every one showed N/A. 181 fringe players still have none, which is the right place to stop. |
| **any time** | Finish standing up the mirror at `mirror03.github.io` — steps 2–4 in `docs/DOMAIN_CATEGORISATION.md`, plus a Worker redeploy | `fplanalyser.co.uk` is blocked as gambling on at least one corporate network, and the github.io address redirects to it, so the site is unreachable from that machine by either route. The pipeline is written and skips itself until you set `MIRROR_REPO`. The Worker redeploy is not optional — without it the mirror loads but every live call fails. |
| **Fri 21 Aug, 18:30 BST** | **GW1 deadline.** Nothing to do — the daily jobs cover it, and *Advance the gameweek* moves the site to GW2 half an hour later. | |

## The first real gameweek

This is the one genuinely manual moment in the season, and it only happens
once. Element ids reset every summer, so the first enrich of a new season
throws up ambiguous name joins that have to be resolved by eye.

| By | Job |
|---|---|
| **Mon 24 Aug** (after GW1 is played) | `python enrich_player_gw.py`, then work through `data/join_uncertain.csv`. Expect a burst — transfers in and three promoted squads. Add fixes to `data/player_overrides.csv`, re-run, then `python review_joins.py` and check `data/join_coverage_report.csv` reads above 95% joined minutes. |
| **Mon 24 Aug** | Run the rest of the chain: `./automation/run_pipeline.sh --no-push`, eyeball the log for `GATE FAIL`, then run it again without the flag. |
| **Mon 24 Aug** | **Disable "Refresh pre-season squad data"** in the Actions tab. It would otherwise overwrite the real ratings with carried-over ones the next morning. |
| **Mon 24 Aug**, after that run | `git rm automation/apply_conceded_and_saves.py`. It back-fills the goals-conceded deduction and floored save points into published ratings, which `fpl_analyser_rating.py` now models itself — so the first full pipeline run makes it dead weight, and leaving it invites someone to apply the correction twice. |

## Each gameweek after that

| When | Job |
|---|---|
| Monday or Tuesday after the last match | `./automation/run_pipeline.sh`. Roughly two minutes of compute plus the Understat and PL pulls. |
| Anything else | Nothing. Injuries, prices, ownership, odds and deadlines all refresh daily on their own, and the site moves to the next gameweek half an hour after each deadline. |

`join_uncertain.csv` will have the odd new row after a January transfer window;
everything else is unattended.

## What the site looks like when

- **Now → GW3.** Every rating is 2025-26 carried forward and labelled as such:
  267 players rated, 288 showing N/A. The pre-season banner says so.
- **From GW4** (Sat 12 Sep). `gw4_ok` needs three starts in the last four
  gameweeks, so a regular starter picks up a genuine 2026-27 four-week rating
  around here — including the new signings and promoted-club players who have
  nothing at all today.
- **From roughly GW10.** `season_ok` needs 900 minutes and 10 starts, so the
  full-season ratings become 2026-27's own rather than last year's. That is the
  point at which `provisional` comes off `meta.json`.

## Getting the weekly run automated too

The reprocess half already runs anywhere — 89 seconds, six steps, measured on a
machine that had never seen the data folder. Three things stand between that
and a scheduled job; they are written up under "Put the data pipeline on a
schedule" in `BACKLOG.md`. The short version: the repo's CSVs are last
season's, two 11MB intermediates should not be committed on every run, and the
join review above needs a human the first time each season.
