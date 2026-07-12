# New Season Reset Checklist — 2026-27

Work through this once the new season's fixtures and squads are published
(usually late June / early July). Items are ordered; each has a check you can
run before moving on. Allow a couple of evenings — the two backfill pulls are
slow but unattended.

## 1. New data folder

- [ ] Create the new season folder alongside the old one, e.g.
      `.../FPL/FPL_2026-27_historical`
- [ ] Point the pipeline at it: either update the `DATA_DIR` default in the
      scripts or set `FPL_DATA_DIR` in `automation/run_pipeline.sh`
- [ ] Keep the 2025-26 folder untouched — it's your historical archive

## 2. Fresh FPL base data

- [ ] Pull the new `season_summary.csv` (bootstrap-static: new player IDs,
      prices, teams — **player `element` IDs reset every season**)
- [ ] Pull the new `fixtures_enriched.csv` (new fixture list with FDR)
- [ ] `player_gw_history.csv` starts empty and grows each GW

**Check:** `season_summary.csv` has ~700 rows and the promoted teams appear;
`fixtures_enriched.csv` has 380 rows, all `finished=False`.

## 3. Team codes for promoted clubs

- [ ] Update `teamCodes` + `teamFullNames` in `js/util.js` — promoted teams
      need their PL badge codes (the `t{code}.png` id on resources.premierleague.com)
- [ ] Update any team lists in the pipeline if a short-name changed

**Check:** open the site's Teams page — all 20 badges render, none broken.

## 4. Understat + PL API cache reset

- [ ] New cache dirs (`cache/understat/`, `cache/pl/`) for the new season —
      don't delete the old ones, just start fresh alongside
- [ ] Confirm both sources have 2026-27 data live (they lag the season start
      by a few days): run each pull with `--max-new 2` as a probe
- [ ] Check Understat's endpoints still work (they changed format in late
      2025 — `pull_understat_data.py` has the API + HTML fallback)

**Check:** `data/understat_player_match.csv` and `data/pl_player_match.csv`
contain rows with 2026-27 dates.

## 5. Player join maps rebuild

The name-matching maps are keyed on FPL element IDs, which reset:

- [ ] Archive then clear `data/player_id_map_understat.csv` and
      `data/player_id_map_pl.csv`
- [ ] Run `enrich_player_gw.py` after GW1 and work through
      `data/join_uncertain.csv` — expect a burst of new-player ambiguities
      (transfers in, promoted-team squads)
- [ ] Add manual fixes to `data/player_overrides.csv` as needed
- [ ] Run `review_joins.py` and check `data/join_coverage_report.csv` —
      target >95% joined minutes per GW

## 6. Early-season data floors (nothing to do — just expect it)

Most enrichment stats need 180–450 valid minutes, so until roughly GW4-5:

- Scouting report: sparse, especially the l4/l6 windows
- Shot Quality / Creativity Depth / Finishing Skill ratings: mostly N/A
- Personas: season-window personas won't fire until ~GW4 (min 10 starts
  scales down but percentile gates need ≥10 valid players)
- Ratings fall back cleanly (season_ok needs 900 mins / 10 starts — the
  gw4 ratings carry the site early on)

The site shows N/A rather than breaking — that's by design.

## 7. First full pipeline run

- [ ] `./automation/run_pipeline.sh --no-push` after GW1 completes
- [ ] Eyeball the log: every step prints its GATE checks; no `GATE FAIL`
- [ ] Spot-check 3 players you watched over the weekend (goals, minutes,
      npxG present)
- [ ] Then run with push, and check the live site end-to-end

## 8. Automation on

- [ ] Edit paths in `automation/com.fplanalyser.pipeline.plist`
- [ ] `cp` to `~/Library/LaunchAgents/` and `launchctl load` it
      (instructions in the plist header)
- [ ] After the first scheduled run, check `automation/logs/` for the log

## Quick reference: the chain

```
pull_understat_data.py → pull_pl_stats.py → enrich_player_gw.py
→ rolling_calculations.py → fpl_analyser_rating.py → persona_assignment.py
→ advanced_metrics.py → scouting_percentiles.py → build_site_data.py
→ git commit + push (run_pipeline.sh does all of this)
```
