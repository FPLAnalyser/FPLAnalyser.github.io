#!/usr/bin/env python3
"""
bootstrap_new_season.py — stand up the new FPL season BEFORE games are played,
by carrying last season's ratings onto the new player universe.

It reads the live FPL API (bootstrap-static + fixtures) and last season's built
site_data, joins players by their permanent `code` (FPL element ids change every
season; `code` does not), and writes site_data/<NEW_SEASON>/ with:
  - the new fixtures, teams, players, prices and ownership (from the API)
  - carried-over ratings for RETURNING players (shown as last season's, labelled)
  - nothing (→ N/A on the site) for new signings and promoted-team players

It marks the season "provisional" in seasons.json so the site shows a pre-season
banner and a "'25/26" tag on carried ratings. Needs only the public FPL API and
last season's site_data — no Understat, no Google Drive. Run it again any time to
refresh prices/ownership/fixtures; once real games are played, switch back to the
full pipeline (fpl_analyser_rating.py + build_site_data.py) to replace the
carry-over with genuine new-season ratings.

Usage (from the repo root):
  NEW_SEASON=2026-27 PREV_SEASON=2025-26 python3 bootstrap_new_season.py
"""
import datetime
import json
import os
import urllib.request

NEW = os.environ.get("NEW_SEASON", "2026-27")
PREV = os.environ.get("PREV_SEASON", "2025-26")
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site_data")
PREV_DIR = os.path.join(ROOT, PREV)
OUT_DIR = os.path.join(ROOT, NEW)
API = "https://fantasy.premierleague.com/api"
POS = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}

# Player fields always taken fresh from the new season (never carried over).
CONTEXT = {"element", "web_name", "team", "position", "price", "code", "selected_by_percent"}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "fpl-analyser-bootstrap"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def load(name):
    p = os.path.join(PREV_DIR, name + ".json")
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def dump(name, data):
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, name + ".json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


print(f"Bootstrapping {NEW} from {PREV} (carry-over) …")
boot = get(f"{API}/bootstrap-static/")
fixtures = get(f"{API}/fixtures/")
teams_by_id = {t["id"]: t for t in boot["teams"]}
events = boot["events"]
cur_gw = next((e["id"] for e in events if e.get("is_current")), None)
next_gw = next((e["id"] for e in events if e.get("is_next")), None)
print(f"  teams: {len(boot['teams'])}  players: {len(boot['elements'])}  next GW: {next_gw}")

# Last season ratings, indexed by permanent player code + old element id.
prev_ratings = load("ratings") or []
prev_by_code = {r["code"]: r for r in prev_ratings if r.get("code") is not None}
old_elem_to_code = {r["element"]: r["code"] for r in prev_ratings if r.get("element") is not None and r.get("code") is not None}

# 1. New-season ratings universe (carry ratings by code; leave new players blank).
new_ratings = []
code_to_new_elem = {}
carried = 0
for e in boot["elements"]:
    code = e.get("code")
    team = teams_by_id.get(e["team"], {}).get("short_name", "")
    row = {
        "element": e["id"],
        "code": code,
        "web_name": e["web_name"],
        "team": team,
        "position": POS.get(e["element_type"], ""),
        "price": round(e["now_cost"] / 10.0, 1),
        "selected_by_percent": float(e.get("selected_by_percent") or 0),
    }
    if code is not None:
        code_to_new_elem[code] = e["id"]
    prev = prev_by_code.get(code)
    if prev:
        for k, v in prev.items():
            if k not in CONTEXT:
                row[k] = v
        row["ratings_carried"] = True
        carried += 1
    new_ratings.append(row)
dump("ratings", new_ratings)
print(f"  ratings.json — {len(new_ratings)} players ({carried} carried, {len(new_ratings) - carried} new/NA)")

# 2. fixture_ease.json straight from the new fixtures (FPL's own difficulty).
fe = []
for fx in fixtures:
    if fx.get("event") is None:
        continue
    h = teams_by_id[fx["team_h"]]["short_name"]
    a = teams_by_id[fx["team_a"]]["short_name"]
    fe.append({"team": h, "gw": fx["event"], "opponent": a, "venue": "H", "fdr": fx["team_h_difficulty"]})
    fe.append({"team": a, "gw": fx["event"], "opponent": h, "venue": "A", "fdr": fx["team_a_difficulty"]})
dump("fixture_ease", fe)
print(f"  fixture_ease.json — {len(fe)} rows")

# 3. team_ratings.json — carry last season for returning clubs; promoted → absent (N/A).
current_teams = {t["short_name"] for t in boot["teams"]}
prev_tr = load("team_ratings") or []
dump("team_ratings", [r for r in prev_tr if r.get("team") in current_teams])

# 4. Re-key the element-keyed secondary tables onto the NEW element ids (drop
#    players who aren't in the new season; new players simply have no row).
def rekey(name):
    rows = load(name)
    if rows is None:
        return
    # Some tables are dict-shaped or not lists of row dicts — copy those as-is.
    if not (isinstance(rows, list) and rows and isinstance(rows[0], dict)):
        dump(name, rows)
        print(f"  {name}.json — copied as-is")
        return
    out = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        code = old_elem_to_code.get(r.get("element"))
        ne = code_to_new_elem.get(code) if code is not None else None
        if ne is None:
            continue
        r = dict(r)
        r["element"] = ne
        out.append(r)
    dump(name, out)
    print(f"  {name}.json — {len(out)} rows re-keyed")

for name in ("personas_4gw", "advanced_metrics", "season_to_date", "player_tiers",
             "replacement_pool", "persona_shifts", "price_risk", "player_form", "player_shots"):
    rekey(name)

# 5. Team / league tables carry as-is (filtered to current clubs where they carry a team).
for name in ("team_metrics", "scouting", "scouting_meta", "benchmarks", "shots_for", "shots_conceded"):
    data = load(name)
    if data is None:
        continue
    if isinstance(data, list) and data and isinstance(data[0], dict) and "team" in data[0]:
        data = [r for r in data if r.get("team") in current_teams]
    dump(name, data)

# 6. meta.json — new season, provisional, ratings carried from PREV.
dump("meta", {
    "generated_at": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    "current_gw": cur_gw, "next_gw": next_gw,
    "season": NEW, "provisional": True, "ratings_season": PREV,
})

# 7. seasons.json — add NEW (provisional) and make it current.
manifest_path = os.path.join(ROOT, "seasons.json")
manifest = {"current": NEW, "seasons": []}
if os.path.exists(manifest_path):
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)
seasons = {s["id"]: s for s in manifest.get("seasons", [])}
seasons[NEW] = {"id": NEW, "label": NEW.replace("-", "/"), "provisional": True, "ratings_season": PREV}
seasons.setdefault(PREV, {"id": PREV, "label": PREV.replace("-", "/")})
manifest = {"current": NEW, "seasons": sorted(seasons.values(), key=lambda s: s["id"], reverse=True)}
with open(manifest_path, "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

print(f"\nDone. Wrote {OUT_DIR} and set seasons.json current → {NEW} (provisional).")
print("Preview it via the season toggle, then commit & push site_data/ to go live.")
