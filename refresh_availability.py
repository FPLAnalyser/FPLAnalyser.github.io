#!/usr/bin/env python3
"""
refresh_availability.py — pull the live, perishable facts from the FPL API into
site_data/<current season>/availability.json.

The rest of the pipeline is a season-history build; this file is the news:
  · per-player availability — status (a/d/i/s/u/n), the news line FPL attaches
    ("Knee injury - Expected back 22 Aug"), and chance of playing next round
  · set-piece duty as it stands TODAY — penalties_order etc. change with
    transfers and manager whim, and a snapshot from last season goes stale
    (Thiago moved from Brentford's #2 to #1 between seasons)
  · the gameweek deadlines, so the site can decide which gameweeks an
    "Expected back 22 Aug" actually rules a player out of

Run from the repo root. Needs nothing but the public API. A scheduled GitHub
Action (.github/workflows/refresh-availability.yml) runs it daily and commits
when anything changed; pushing to main redeploys the site.
"""
import datetime
import json
import os
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site_data")
API = "https://fantasy.premierleague.com/api"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "fpl-analyser-availability"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


# The API always describes the season FPL is running right now, which is the
# newest entry in seasons.json — not "current", which tracks the last season
# with a full stats build (they differ all pre-season).
with open(os.path.join(ROOT, "seasons.json"), encoding="utf-8") as f:
    season = json.load(f)["seasons"][0]["id"]
out_path = os.path.join(ROOT, season, "availability.json")

boot = get(f"{API}/bootstrap-static/")

events = [
    {"gw": e["id"], "deadline": e["deadline_time"], "finished": bool(e["finished"])}
    for e in boot["events"]
]

# Kickoff times matter because FPL's news dates name FIXTURES: "Expected back
# 22 Aug" means he plays the game ON 22 Aug, so the site must compare return
# dates against each team's kickoff in a gameweek, not the deadline before it.
fixtures = [
    {"gw": f["event"], "h": f["team_h"], "a": f["team_a"], "k": f["kickoff_time"]}
    for f in get(f"{API}/fixtures/")
    if f.get("event") and f.get("kickoff_time")
]

players = []
for el in boot["elements"]:
    row = {
        "element": el["id"],
        "code": el["code"],
        "team": el["team"],
        "status": el.get("status", "a"),
    }
    # Only ship the noisy fields when they carry information — keeps the file
    # small enough to fetch on a phone without thinking about it.
    if el.get("news"):
        row["news"] = el["news"]
    if el.get("news_added"):
        row["news_added"] = el["news_added"]
    if el.get("chance_of_playing_next_round") is not None:
        row["chance"] = el["chance_of_playing_next_round"]
    for src, dst in (
        ("penalties_order", "pen_order"),
        ("corners_and_indirect_freekicks_order", "corner_order"),
        ("direct_freekicks_order", "fk_order"),
    ):
        if el.get(src) is not None:
            row[dst] = el[src]
    players.append(row)

payload = {
    "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "events": events,
    "fixtures": fixtures,
    "players": players,
}
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

flagged = sum(1 for p in players if p["status"] != "a")
pens = sum(1 for p in players if p.get("pen_order") == 1)
print(f"{out_path}: {len(players)} players ({flagged} flagged unavailable/doubtful, "
      f"{pens} first-choice penalty takers), {len(events)} gameweek deadlines, "
      f"{len(fixtures)} fixtures")
