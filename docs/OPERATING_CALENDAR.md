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
| on every push | Deploy to GitHub Pages | Rebuilds and publishes. Fires on the three above as well as on your own pushes. |

The pre-season refresh writes `provisional: true` and `ratings_season: 2025-26`
every run. That is correct now and wrong the moment real 2026-27 numbers exist,
which is why it has an off date below.

## Before launch

| By | Job | Why it matters |
|---|---|---|
| **any time before Fri 21 Aug** | Twenty minutes on your own iPhone, every route, both themes | WebKit cannot be tested here — the Playwright download is blocked (`403 host not permitted`), so every measurement in this repo is Chromium. The one WebKit bug this site has had (invisible content) was invisible to Chromium too. |
| **any time before Fri 21 Aug** | Name the third-party source of the promoted-club GW1 projections | `src/lib/promotedXp.ts` and the Legal page both credit "a third party". An uncredited credit is worse than none. |
| ~~before Fri 21 Aug~~ **done** | ~~Supply GW1 expected points for the twenty most-owned players who have none~~ | Supplied and wired in — the twenty carried 83% combined ownership and every one showed N/A. 181 fringe players still have none, which is the right place to stop. |
| **Fri 21 Aug, 18:30 BST** | **GW1 deadline.** Nothing to do — the daily jobs cover it. | |

## The first real gameweek

This is the one genuinely manual moment in the season, and it only happens
once. Element ids reset every summer, so the first enrich of a new season
throws up ambiguous name joins that have to be resolved by eye.

| By | Job |
|---|---|
| **Mon 24 Aug** (after GW1 is played) | `python enrich_player_gw.py`, then work through `data/join_uncertain.csv`. Expect a burst — transfers in and three promoted squads. Add fixes to `data/player_overrides.csv`, re-run, then `python review_joins.py` and check `data/join_coverage_report.csv` reads above 95% joined minutes. |
| **Mon 24 Aug** | Run the rest of the chain: `./automation/run_pipeline.sh --no-push`, eyeball the log for `GATE FAIL`, then run it again without the flag. |
| **Mon 24 Aug** | **Disable "Refresh pre-season squad data"** in the Actions tab. It would otherwise overwrite the real ratings with carried-over ones the next morning. |

## Each gameweek after that

| When | Job |
|---|---|
| Monday or Tuesday after the last match | `./automation/run_pipeline.sh`. Roughly two minutes of compute plus the Understat and PL pulls. |
| Anything else | Nothing. Injuries, prices, ownership, odds and deadlines all refresh daily on their own. |

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
