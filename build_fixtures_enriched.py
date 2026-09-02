#!/usr/bin/env python3
"""build_fixtures_enriched.py — write fixtures_enriched.csv for the season the
site is actually on.

WHY THIS EXISTS. Three scripts read fixtures_enriched.csv — enrich_player_gw.py
to match a match to a gameweek, fpl_analyser_rating.py for the next-four
adjustment, and build_site_data.py to build the entire fixture grid — and until
now NOTHING IN THE REPO WROTE IT. It was carried over by hand from last season
and quietly went stale.

WHAT THAT COST, on 2026-09-02. The file still held 2025-26's 380 fixtures, all
of them played. build_site_data.py read every gameweek as locked, found no
upcoming fixtures and wrote an empty fixture_ease.json — which blanks the
Fixtures page, the Squad Builder and every projection on the site at once,
because an xP is a player matched to a fixture in that file. The run was only
harmless because it was a --no-push dry run. build_site_data.py now refuses to
write an empty grid; this is the other half, the thing that keeps it full.

SAFE TO RUN AT ANY TIME. It reads the FPL API and writes the file, and the API
is the authority on fixtures — kickoff times move, matches get postponed, and a
rerun simply picks up wherever they landed. Nothing is merged with what was
there before, because a fixture that has vanished from the API is a fixture
that no longer exists.

  python3 build_fixtures_enriched.py
  python3 build_fixtures_enriched.py --dry-run     # report, write nothing
  python3 build_fixtures_enriched.py --out PATH    # somewhere other than ./
"""
import argparse
import csv
import json
import os
import sys
import urllib.request

API = "https://fantasy.premierleague.com/api"
ROOT = os.path.dirname(os.path.abspath(__file__))

COLUMNS = [
    "fixture_id", "gw", "kickoff_time", "finished",
    "home_team", "away_team", "home_team_id", "away_team_id",
    "home_score", "away_score", "home_fdr", "away_fdr",
    "home_team_full", "away_team_full",
]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "fpl-analyser-fixtures"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would be written, write nothing")
    ap.add_argument("--out", default=os.path.join(ROOT, "fixtures_enriched.csv"))
    args = ap.parse_args()

    # Same rule as every other script here: the season the site is on is the
    # newest entry in seasons.json, not the one labelled "current".
    with open(os.path.join(ROOT, "site_data", "seasons.json"), encoding="utf-8") as f:
        season = json.load(f)["seasons"][0]
    print(f"Building fixtures_enriched.csv for {season['label']}")

    boot = get(f"{API}/bootstrap-static/")
    fixtures = get(f"{API}/fixtures/")
    teams = {t["id"]: t for t in boot["teams"]}

    rows = []
    for fx in fixtures:
        h, a = teams.get(fx.get("team_h")), teams.get(fx.get("team_a"))
        if not h or not a:
            continue
        rows.append({
            "fixture_id": fx.get("id"),
            # FPL leaves `event` null on a postponed fixture with no new date.
            # Written through as blank rather than dropped: the consumers are
            # already NaN-safe on this column, and a fixture that exists with
            # no gameweek is true, where a fixture that has silently vanished
            # from the grid is not.
            "gw": fx.get("event") if fx.get("event") is not None else "",
            "kickoff_time": fx.get("kickoff_time") or "",
            "finished": "True" if fx.get("finished") else "False",
            "home_team": h["short_name"], "away_team": a["short_name"],
            "home_team_id": h["id"], "away_team_id": a["id"],
            "home_score": fx.get("team_h_score") if fx.get("team_h_score") is not None else "",
            "away_score": fx.get("team_a_score") if fx.get("team_a_score") is not None else "",
            "home_fdr": fx.get("team_h_difficulty", ""),
            "away_fdr": fx.get("team_a_difficulty", ""),
            "home_team_full": h["name"], "away_team_full": a["name"],
        })

    if not rows:
        sys.exit("The API returned no fixtures — refusing to write an empty file.")

    gws = sorted({r["gw"] for r in rows if r["gw"] != ""})
    played = sum(1 for r in rows if r["finished"] == "True")
    upcoming = len(rows) - played
    print(f"  {len(rows)} fixtures over GW{min(gws)}–GW{max(gws)}")
    print(f"  {played} played, {upcoming} still to come")
    if not upcoming:
        # The exact state that emptied the grid. Worth saying out loud rather
        # than leaving the next person to work it out from a blank Fixtures
        # page: in-season it means the API is serving the wrong season.
        print("  !! every fixture in this file has been played. In-season that is")
        print("     wrong, and build_site_data.py will refuse to build a grid.")

    if args.dry_run:
        print(f"\nwould write {len(rows)} rows to {args.out}")
        return 0

    with open(args.out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)
    print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
