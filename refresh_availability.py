#!/usr/bin/env python3
"""
refresh_availability.py — pull the live, perishable facts from the FPL API into
site_data/<current season>/availability.json.

The rest of the pipeline is a season-history build; this file is the news:
  · per-player availability — status (a/d/i/s/u/n), the news line FPL attaches
    ("Knee injury - Expected back 22 Aug"), and chance of playing next round
  · price and ownership as they stand this morning — both move daily, while
    the ratings build behind them is a season-history job; the site overlays
    these so budgets and the template read are never a week out of date
  · name and position for every player in the game, so a signing registered
    since the last ratings build still appears — unrated, but findable. This
    file is the only thing that runs daily; the ratings build is run by hand,
    and between the two the squad list would otherwise be as old as it is
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

def _fixture(f):
    """Kickoff plus, once played, the score.

    The scores are the cheapest data on the site: this endpoint is already
    being called for the kickoff times and they arrive in the same payload.
    Without them there is no way to draw form or a league table — and there is
    no deriving it from the player rows either, because goals_conceded is only
    recorded for keepers and defenders who played, so any club with a thin
    defensive sample comes out unbeaten."""
    row = {"gw": f["event"], "h": f["team_h"], "a": f["team_a"], "k": f["kickoff_time"]}
    if f.get("finished") and f.get("team_h_score") is not None:
        row["hs"] = f["team_h_score"]
        row["as"] = f["team_a_score"]
    return row


# Kickoff times matter because FPL's news dates name FIXTURES: "Expected back
# 22 Aug" means he plays the game ON 22 Aug, so the site must compare return
# dates against each team's kickoff in a gameweek, not the deadline before it.
#
# The helper is defined ABOVE this, and has to be: the module runs top to
# bottom, so a def underneath the comprehension that calls it is a NameError on
# the first line of real work. That is exactly what happened — the refresh died
# at 06:00 for two mornings running and the site quietly served the injuries,
# prices and ownership from the last morning it worked.
fixtures = [
    _fixture(f)
    for f in get(f"{API}/fixtures/")
    if f.get("event") and f.get("kickoff_time")
]

# id -> GKP/DEF/MID/FWD, straight from the payload rather than hard-coded, so
# a change at FPL's end cannot silently mislabel a whole position.
POSITIONS = {t["id"]: t["singular_name_short"] for t in boot["element_types"]}

players = []
for el in boot["elements"]:
    row = {
        "element": el["id"],
        "code": el["code"],
        "team": el["team"],
        # Name and position are the two fields that let the site render a
        # player it has never seen. Without them this feed could describe a
        # new signing — fit, £6.5m, Arsenal — but not introduce him, so nine
        # players sat in the FPL game and on no page of the site while this
        # job ran green every morning. They cost about 11KB across the file.
        "name": el["web_name"],
        "pos": POSITIONS.get(el["element_type"], ""),
        "status": el.get("status", "a"),
        # Price and ownership move every single day — prices settle around
        # 01:30 UTC and ownership drifts all week — while the ratings build
        # is a season-history job that runs far less often. Carrying them
        # here keeps the budget maths and the template read honest without
        # rebuilding the whole pipeline each morning.
        "price": round(el["now_cost"] / 10, 1),
        "own": float(el.get("selected_by_percent") or 0),
    }
    # Where the market is going on him this week. FPL publishes the transfer
    # counts and the price move it has already caused; it does NOT publish the
    # threshold for the next one, so we report what happened and let the
    # reader draw the line rather than inventing a countdown.
    for src, dst in (("transfers_in_event", "tin"), ("transfers_out_event", "tout"), ("cost_change_event", "dprice")):
        v = el.get(src)
        if v:
            row[dst] = v
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
owned = sum(p["own"] for p in players) / 100
print(f"{out_path}: {len(players)} players ({flagged} flagged unavailable/doubtful, "
      f"{pens} first-choice penalty takers), {len(events)} gameweek deadlines, "
      f"{len(fixtures)} fixtures")
played = sum(1 for f in fixtures if "hs" in f)
moved = sum(1 for p in players if p.get("dprice"))
print(f"  {played} fixtures with a score, {moved} players whose price moved this gameweek")
print(f"  prices £{min(p['price'] for p in players):.1f}m–£{max(p['price'] for p in players):.1f}m; "
      f"ownership sums to {owned:.1f} players, which is the squad size when the feed is sane")
