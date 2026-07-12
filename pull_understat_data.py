"""pull_understat_data.py  (v2 — Understat JSON API)

Understat removed the embedded datesData/rostersData/shotsData script blobs
in late 2025 and replaced them with JSON endpoints. This version uses the
API first and falls back to legacy HTML scraping if an endpoint is missing.

Data taken from Understat (and nothing else):
  - npxG (single source of truth — never FBref)
  - xGChain, xGBuildup per player per match
  - shots: zone (six-yard / penalty area / out of box, from X/Y coords),
    type (foot / head), on-target
  - per-shot rows (x, y, xG, result, situation) tagged with both the
    shooting team and the conceding team, for shot-map visualisations

Caching: one JSON per match under cache/understat/matches/{match_id}.json
plus manifest.json. Completed matches never change -> never re-fetched.

Usage:
  python3 pull_understat_data.py            # incremental
  python3 pull_understat_data.py --reparse  # re-parse cache, no network
"""
import argparse
import codecs
import csv
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

from source_join.teams import resolve_team

BASE = "https://understat.com"
LEAGUE = "EPL"
SEASON = "2025"                      # Understat labels 2025-26 as 2025
CACHE = Path("cache/understat")
MATCH_CACHE = CACHE / "matches"
MANIFEST = CACHE / "manifest.json"
OUT = Path("data/understat_player_match.csv")
SHOTS_OUT = Path("data/understat_shots.csv")
THROTTLE_S = 1.5

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/126.0.0.0 Safari/537.36"),
    "Accept": "application/json, text/javascript, */*",
    "Accept-Language": "en-GB,en;q=0.9",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://understat.com/",
}

# Understat pitch coords are 0-1 along length (X, 1 = opposition goal line)
# and 0-1 across width (Y). Standard 105m x 68m geometry:
SIX_YARD_X = 1 - 5.5 / 105          # 0.9476
SIX_YARD_Y = (34 - 9.16) / 68, (34 + 9.16) / 68
PEN_AREA_X = 1 - 16.5 / 105         # 0.8429
PEN_AREA_Y = (34 - 20.16) / 68, (34 + 20.16) / 68


def classify_zone(x: float, y: float) -> str:
    if x >= SIX_YARD_X and SIX_YARD_Y[0] <= y <= SIX_YARD_Y[1]:
        return "six_yard"
    if x >= PEN_AREA_X and PEN_AREA_Y[0] <= y <= PEN_AREA_Y[1]:
        return "penalty_area"
    return "out_of_box"


# ------------------------- fetching (API first) ------------------------- #
def _extract_embedded_json(html: str, var: str):
    """Legacy fallback: var/let/const {var} = JSON.parse('...') in page HTML."""
    m = re.search(
        rf"(?:var|let|const)\s+{var}\s*=\s*JSON\.parse\(\s*(['\"])(.*?)\1\s*\)",
        html, re.S)
    if not m:
        raise ValueError(f"{var} not found in HTML")
    return json.loads(codecs.decode(m.group(2), "unicode_escape"))


def fetch_season_matches(session):
    """New JSON API: getLeagueData/{league}/{season} -> {'dates': [...]}."""
    url = f"{BASE}/getLeagueData/{LEAGUE}/{SEASON}"
    r = session.get(url, timeout=30)
    r.raise_for_status()
    try:
        data = r.json()
    except ValueError:
        CACHE.mkdir(parents=True, exist_ok=True)
        (CACHE / "debug_league.html").write_text(r.text)
        raise RuntimeError(
            f"{url} did not return JSON — response saved to "
            f"cache/understat/debug_league.html, inspect and report back")
    dates = data.get("dates") or data.get("datesData") or []
    if not dates:
        CACHE.mkdir(parents=True, exist_ok=True)
        (CACHE / "debug_league.json").write_text(json.dumps(data, indent=1))
        raise RuntimeError(
            f"No 'dates' key in API response — top-level keys were "
            f"{sorted(data.keys())}; full payload saved to "
            f"cache/understat/debug_league.json")
    return [m for m in dates if m.get("isResult")]


def _normalise_match_payload(data: dict) -> dict:
    """Accepts either the new API payload or legacy-shaped dicts and returns
    {'rosters': {'h': {...}, 'a': {...}}, 'shots': {'h': [...], 'a': [...]}}."""
    rosters = data.get("rosters") or data.get("rostersData")
    shots = data.get("shots") or data.get("shotsData")
    if rosters is None or shots is None:
        raise ValueError(f"match payload missing rosters/shots — top-level "
                         f"keys: {sorted(data.keys())}")
    return {"rosters": rosters, "shots": shots}


def fetch_match(session, match_id: str) -> dict:
    """Try JSON API first, fall back to legacy HTML page."""
    r = session.get(f"{BASE}/getMatchData/{match_id}", timeout=30)
    if r.status_code == 200:
        try:
            return _normalise_match_payload(r.json())
        except (ValueError, KeyError):
            pass  # fall through to HTML

    r = session.get(f"{BASE}/match/{match_id}", timeout=30)
    r.raise_for_status()
    try:
        return {
            "rosters": _extract_embedded_json(r.text, "rostersData"),
            "shots": _extract_embedded_json(r.text, "shotsData"),
        }
    except ValueError:
        CACHE.mkdir(parents=True, exist_ok=True)
        (CACHE / f"debug_match_{match_id}.html").write_text(r.text)
        raise RuntimeError(
            f"Match {match_id}: neither getMatchData API nor embedded HTML "
            f"worked — page saved to cache/understat/debug_match_{match_id}"
            f".html; paste its first 50 lines back to your assistant")


# ------------------------------ manifest -------------------------------- #
def load_manifest():
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text())
    return {"matches": {}}


def save_manifest(man):
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(man, indent=1))


# ------------------------------- parsing -------------------------------- #
def parse_match(match_id: str, meta: dict, payload: dict):
    """-> list of per-player rows for this match."""
    home = resolve_team(meta["h"]["title"])
    away = resolve_team(meta["a"]["title"])
    kickoff = str(meta["datetime"])[:10]

    rows = {}
    for side, team in (("h", home), ("a", away)):
        roster = payload["rosters"][side]
        # roster may be a dict keyed by id, or a list
        entries = roster.values() if isinstance(roster, dict) else roster
        for p in entries:
            rows[str(p["player_id"])] = {
                "understat_match_id": match_id,
                "kickoff_date": kickoff,
                "home": home, "away": away,
                "understat_id": str(p["player_id"]),
                "understat_name": p["player"],
                "team": team,
                "us_minutes": int(p.get("time", 0) or 0),
                "us_npxg": None,   # filled from non-penalty shot xG below
                "us_xg_chain": float(p.get("xGChain", 0) or 0),
                "us_xg_buildup": float(p.get("xGBuildup", 0) or 0),
                "us_shots": 0, "us_sot": 0,
                "us_shots_six_yard": 0, "us_shots_penalty_area": 0,
                "us_shots_out_of_box": 0,
                "us_shots_foot": 0, "us_shots_head": 0,
                "_npxg_acc": 0.0,
            }

    on_target = {"Goal", "SavedShot"}
    for side in ("h", "a"):
        for s in payload["shots"][side]:
            pid = str(s["player_id"])
            if pid not in rows:
                continue
            row = rows[pid]
            row["us_shots"] += 1
            if s["result"] in on_target:
                row["us_sot"] += 1
            row[f"us_shots_{classify_zone(float(s['X']), float(s['Y']))}"] += 1
            st = s.get("shotType", "")
            if st in ("RightFoot", "LeftFoot"):
                row["us_shots_foot"] += 1
            elif st == "Head":
                row["us_shots_head"] += 1
            # npxG = sum of shot xG excluding penalties (Understat's own defn)
            if s.get("situation") != "Penalty":
                row["_npxg_acc"] += float(s["xG"])

    out = []
    for row in rows.values():
        row["us_npxg"] = round(row.pop("_npxg_acc"), 4)
        out.append(row)
    return out


def parse_match_shots(match_id: str, meta: dict, payload: dict):
    """-> list of per-shot rows, one per shot, tagged with both the
    shooting team and the conceding team (powers shot-map visualisations).

    Understat's X is always normalised to the shooting side's attacking
    direction (X=1 is the target goal), so every row here is already in the
    conceding team's own defensive frame regardless of home/away.
    """
    home = resolve_team(meta["h"]["title"])
    away = resolve_team(meta["a"]["title"])
    kickoff = str(meta["datetime"])[:10]
    team_of = {"h": home, "a": away}
    conceded_by_of = {"h": away, "a": home}
    conceding_venue_of = {"h": "A", "a": "H"}  # venue of the CONCEDING team

    rows = []
    for side in ("h", "a"):
        for s in payload["shots"][side]:
            x, y = float(s["X"]), float(s["Y"])
            rows.append({
                "understat_match_id": match_id,
                "kickoff_date": kickoff,
                "venue": conceding_venue_of[side],
                "minute": int(s.get("minute", 0) or 0),
                "team": team_of[side],
                "conceded_by": conceded_by_of[side],
                "player": s.get("player", ""),
                "understat_id": str(s.get("player_id", "")),
                "x": round(x, 4), "y": round(y, 4),
                "zone": classify_zone(x, y),
                "xg": round(float(s.get("xG", 0) or 0), 4),
                "result": s.get("result", ""),
                "situation": s.get("situation", ""),
                "shot_type": s.get("shotType", ""),
            })
    return rows


# --------------------------------- main ---------------------------------- #
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reparse", action="store_true",
                    help="re-parse cached JSON only; no network")
    args = ap.parse_args()

    MATCH_CACHE.mkdir(parents=True, exist_ok=True)
    man = load_manifest()
    session = requests.Session()
    session.headers.update(HEADERS)

    if not args.reparse:
        finished = fetch_season_matches(session)
        new = [m for m in finished if str(m["id"]) not in man["matches"]]
        print(f"{len(finished)} finished matches, {len(new)} new to fetch")
        for i, m in enumerate(new, 1):
            mid = str(m["id"])
            payload = fetch_match(session, mid)
            (MATCH_CACHE / f"{mid}.json").write_text(
                json.dumps({"meta": m, "payload": payload}))
            man["matches"][mid] = {
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "date": str(m["datetime"])[:10],
                "home": m["h"]["title"], "away": m["a"]["title"],
            }
            save_manifest(man)          # resume-safe: save after every match
            print(f"  [{i}/{len(new)}] {m['h']['title']} v {m['a']['title']}")
            time.sleep(THROTTLE_S)

    # parse everything from cache
    all_rows = []
    all_shots = []
    for f in sorted(MATCH_CACHE.glob("*.json")):
        blob = json.loads(f.read_text())
        all_rows.extend(parse_match(f.stem, blob["meta"], blob["payload"]))
        all_shots.extend(parse_match_shots(f.stem, blob["meta"], blob["payload"]))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    if all_rows:
        with open(OUT, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(all_rows[0].keys()))
            w.writeheader()
            w.writerows(all_rows)
    print(f"Wrote {len(all_rows)} player-match rows -> {OUT}")

    SHOTS_OUT.parent.mkdir(parents=True, exist_ok=True)
    if all_shots:
        with open(SHOTS_OUT, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(all_shots[0].keys()))
            w.writeheader()
            w.writerows(all_shots)
    print(f"Wrote {len(all_shots)} shot rows -> {SHOTS_OUT}")

    # validation gate: fail loudly rather than write silently-partial data
    if all_rows:
        matches = {r["understat_match_id"] for r in all_rows}
        per_match = len(all_rows) / max(len(matches), 1)
        assert 22 <= per_match <= 40, \
            f"Suspicious players-per-match average ({per_match:.1f}) — parser drift?"

    if all_shots:
        matches = {r["understat_match_id"] for r in all_shots}
        per_match_shots = len(all_shots) / max(len(matches), 1)
        assert 10 <= per_match_shots <= 60, \
            f"Suspicious shots-per-match average ({per_match_shots:.1f}) — parser drift?"


if __name__ == "__main__":
    main()