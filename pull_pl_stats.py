"""pull_pl_stats.py

Pulls per-player, per-fixture stats from the official Premier League
(Pulse Live / Opta) API — the source behind premierleague.com. JSON, no
Cloudflare, just an Origin header.

Stats taken (pl_ prefix, PL/Opta's own definitions):
  pl_touches_opp_box    <- touches_in_opp_box
  pl_crosses            <- total_cross
  pl_corners_taken      <- corner_taken
  pl_fk_crosses         <- freekick_cross      (free-kick deliveries)
  pl_fk_shots           <- att_freekick_total  (direct free-kick attempts)
  pl_chances_created    <- att_assist_openplay + att_assist_setplay
  pl_big_chances_created<- big_chance_created

IMPORTANT SEMANTICS: this API omits zero-valued stats. A stat missing from
a successful per-fixture payload means 0. A player with an empty payload
did not play -> no row. (Opposite of the FBref blanks situation.)

Caching: one JSON per fixture at cache/pl/fixtures/{fid}.json holding all
players' stats for that fixture + lineup metadata. Manifest per fixture ->
completed fixtures are never re-fetched. Resume-safe mid-fixture reruns
simply redo that one fixture.

Requests: ~40 per fixture (lineups incl. bench). Backfill ~380 fixtures
at 0.5s throttle ~= 2.5h. Weekly top-up: ~10 fixtures, ~3 minutes.

Usage:
  caffeinate -is python3 pull_pl_stats.py             # incremental
  python3 pull_pl_stats.py --max-new 20               # staged
  python3 pull_pl_stats.py --reparse                  # no network
"""
import argparse
import csv
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

from source_join.teams import resolve_team

BASE = "https://footballapi.pulselive.com/football"
SEASON_LABEL = "2025/26"
CACHE = Path("cache/pl")
FIX_CACHE = CACHE / "fixtures"
MANIFEST = CACHE / "manifest.json"
OUT = Path("data/pl_player_match.csv")
THROTTLE_S = 0.5

H = {"Origin": "https://www.premierleague.com",
     "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0.0.0 Safari/537.36")}

STAT_MAP = {
    "touches_in_opp_box": "pl_touches_opp_box",
    "total_cross_nocorner": "pl_crosses",   # open-play: corners counted separately
    "corner_taken": "pl_corners_taken",
    "freekick_cross": "pl_fk_crosses",
    "att_freekick_total": "pl_fk_shots",
    "big_chance_created": "pl_big_chances_created",
}
CHANCE_PARTS = ("att_assist_openplay", "att_assist_setplay")
OUT_STATS = list(STAT_MAP.values()) + ["pl_chances_created"]


def get(session, path, **params):
    for attempt in range(3):
        r = session.get(f"{BASE}/{path}", params=params, timeout=30)
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(8 * (attempt + 1))
            continue
        r.raise_for_status()
    raise RuntimeError(f"{path}: repeated {r.status_code}")


def load_manifest():
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text())
    return {"fixtures": {}}


def save_manifest(man):
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(man, indent=1))


def season_id(session) -> int:
    seasons = get(session, "competitions/1/compseasons", pageSize=10)
    for s in seasons["content"]:
        if s["label"] == SEASON_LABEL:
            return int(s["id"])
    raise RuntimeError(f"Season {SEASON_LABEL!r} not found: "
                       f"{[s['label'] for s in seasons['content']]}")


def completed_fixtures(session, sid: int) -> list:
    out, page = [], 0
    while True:
        data = get(session, "fixtures", comps=1, compSeasons=sid,
                   statuses="C", page=page, pageSize=100, sort="asc",
                   altIds="true")
        for f in data["content"]:
            millis = f.get("kickoff", {}).get("millis")
            kdate = (datetime.fromtimestamp(millis / 1000, tz=timezone.utc)
                     .date().isoformat()) if millis else ""
            out.append({
                "fid": int(f["id"]),
                "kickoff_date": kdate,
                "home": f["teams"][0]["team"]["name"],
                "away": f["teams"][1]["team"]["name"],
            })
        page += 1
        if page >= data["pageInfo"]["numPages"]:
            break
    return out


def fixture_players(session, fid: int) -> list:
    """[(player_id, display_name, team_name)] for everyone in the squads."""
    fd = get(session, f"fixtures/{fid}", altIds="true")
    players = []
    for tl in fd.get("teamLists") or []:
        team_name = (tl.get("teamId") is not None and next(
            (t["team"]["name"] for t in fd["teams"]
             if t["team"]["id"] == tl["teamId"]), None)) or None
        for group in ("lineup", "substitutes"):
            for p in tl.get(group) or []:
                players.append((int(p["id"]),
                                p.get("name", {}).get("display", ""),
                                team_name))
    return players


def fetch_fixture(session, fid: int) -> dict:
    """{pid: {'name':..., 'team':..., 'stats': {name: value}}} — players with
    empty stats payloads (did not play) are excluded."""
    result = {}
    for pid, name, team in fixture_players(session, fid):
        try:
            ps = get(session, f"stats/player/{pid}", fixtures=fid)
        except Exception as e:
            print(f"    ! skipping player {name or pid} ({e}) — "
                  f"will be picked up if fixture is re-fetched")
            time.sleep(THROTTLE_S)
            continue
        stats = {s["name"]: s["value"] for s in ps.get("stats", [])}
        if stats:                       # empty -> did not play
            result[str(pid)] = {"name": name, "team": team, "stats": stats}
        time.sleep(THROTTLE_S)
    return result


def rows_from_cache(man) -> list:
    rows = []
    for fid, meta in sorted(man["fixtures"].items(), key=lambda kv: int(kv[0])):
        f = FIX_CACHE / f"{fid}.json"
        if not f.exists():
            continue
        payload = json.loads(f.read_text())
        home = resolve_team(meta["home"])
        away = resolve_team(meta["away"])
        for pid, p in payload.items():
            stats = p["stats"]
            row = {
                "pl_player_id": pid,
                "pl_name": p["name"],
                "team": resolve_team(p["team"]) if p.get("team") else "",
                "kickoff_date": meta["kickoff_date"],
                "home": home, "away": away,
            }
            # omitted stat in a successful payload == 0 by API design
            for src, dst in STAT_MAP.items():
                row[dst] = int(stats.get(src, 0))
            row["pl_chances_created"] = int(sum(stats.get(k, 0)
                                               for k in CHANCE_PARTS))
            rows.append(row)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reparse", action="store_true")
    ap.add_argument("--max-new", type=int, default=None)
    args = ap.parse_args()

    FIX_CACHE.mkdir(parents=True, exist_ok=True)
    man = load_manifest()
    session = requests.Session()
    session.headers.update(H)

    if not args.reparse:
        sid = season_id(session)
        fixtures = completed_fixtures(session, sid)
        print(f"{len(fixtures)} completed fixtures in season {SEASON_LABEL}")
        # heal/refresh meta for fixtures already in the manifest
        for f in fixtures:
            key = str(f["fid"])
            if key in man["fixtures"]:
                man["fixtures"][key].update(
                    kickoff_date=f["kickoff_date"],
                    home=f["home"], away=f["away"])
        save_manifest(man)
        new = [f for f in fixtures if str(f["fid"]) not in man["fixtures"]]
        if args.max_new:
            new = new[: args.max_new]
        est = len(new) * 40 * (THROTTLE_S + 0.15) / 3600
        print(f"{len(new)} new fixtures to fetch (~{est:.1f}h)")
        for i, f in enumerate(new, 1):
            payload = fetch_fixture(session, f["fid"])
            if len(payload) < 22:
                print(f"  !! fixture {f['fid']} returned only {len(payload)} "
                      f"players — skipping manifest write, will retry next run")
                continue
            (FIX_CACHE / f"{f['fid']}.json").write_text(json.dumps(payload))
            man["fixtures"][str(f["fid"])] = {
                "kickoff_date": f["kickoff_date"],
                "home": f["home"], "away": f["away"],
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            }
            save_manifest(man)                      # resume-safe
            print(f"  [{i}/{len(new)}] {f['home']} v {f['away']} "
                  f"({len(payload)} players)")

    rows = rows_from_cache(man)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if rows:
        with open(OUT, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
    print(f"Wrote {len(rows)} player-match rows -> {OUT}")

    if rows:
        n_fix = len({(r["kickoff_date"], r["home"]) for r in rows})
        totals = {c: sum(r[c] for r in rows) for c in OUT_STATS}
        print(f"{n_fix} fixtures | league totals: {totals}")
        assert totals["pl_corners_taken"] > 5 * n_fix, \
            "Implausibly few corners — stat names drifted, refusing silence"
        assert totals["pl_chances_created"] > 10 * n_fix, \
            "Implausibly few chances created — stat names drifted"
        assert totals["pl_touches_opp_box"] > 20 * n_fix, \
            "Implausibly few box touches — stat names drifted"


if __name__ == "__main__":
    main()